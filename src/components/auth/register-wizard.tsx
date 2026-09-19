"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { AlertCircleIcon, CheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { z } from "zod";
import { FormError } from "~/components/app/form-error";
import { BackupCodes } from "~/components/auth/backup-codes";
import { TotpEnrolment } from "~/components/auth/totp-enrolment";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { useErrorMessage } from "~/hooks/use-error-message";
import { signInWithTicket } from "~/lib/auth/client";
import { HOME_PATH } from "~/lib/auth-routing";
import { cn } from "~/lib/utils";
import { registrationDetailsSchema } from "~/lib/validators/auth";
import { useTRPC } from "~/trpc/react";

type Details = z.infer<typeof registrationDetailsSchema>;

const STEPS = ["stepDetails", "stepAuthenticator", "stepBackup"] as const;

function Steps({ current }: { current: number }) {
  const t = useTranslations("auth.register");

  return (
    <ol className="flex items-center gap-2 text-xs">
      {STEPS.map((step, index) => (
        <li key={step} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full border font-medium",
              index < current &&
                "border-primary bg-primary text-primary-foreground",
              index === current && "border-primary text-foreground",
              index > current && "text-muted-foreground",
            )}
          >
            {index < current ? <CheckIcon className="size-3.5" /> : index + 1}
          </span>
          <span
            className={cn(
              "truncate",
              index === current ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {t(step)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function RegisterWizard({
  inviteId,
  isAdmin,
}: {
  inviteId: string;
  isAdmin: boolean;
}) {
  const t = useTranslations("auth.register");
  const tc = useTranslations("common");
  const trpc = useTRPC();
  const router = useRouter();
  const errorMessage = useErrorMessage();

  const [details, setDetails] = useState<Details | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const form = useForm<Details>({
    resolver: zodResolver(registrationDetailsSchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  const makeQr = useMutation(trpc.invites.makeOtpQR.mutationOptions());
  const register = useMutation(trpc.invites.register.mutationOptions());

  const step = backupCodes ? 2 : makeQr.data ? 1 : 0;

  const submitDetails = form.handleSubmit(async (values) => {
    await makeQr
      .mutateAsync({ id: inviteId, ...values })
      .then(() => setDetails(values))
      .catch(() => undefined);
  });

  const submitCode = async (value: string) => {
    if (!details || register.isPending) {
      return;
    }

    await register
      .mutateAsync({ id: inviteId, ...details, code: value })
      .then((result) => {
        setBackupCodes(result.backupCodes);
        setTicket(result.ticket);
      })
      .catch(() => setCode(""));
  };

  const finish = async () => {
    if (!ticket) {
      return;
    }

    setFinishing(true);
    await signInWithTicket(ticket).catch(() => undefined);
    router.replace(HOME_PATH);
    router.refresh();
  };

  const failure = makeQr.error ?? register.error;

  return (
    <Card>
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="text-xl">
            {isAdmin ? t("adminTitle") : t("title")}
          </CardTitle>
          {step === 1 ? (
            <CardDescription>{t("scanTitle")}</CardDescription>
          ) : null}
          {step === 2 ? (
            <CardDescription>{t("backupTitle")}</CardDescription>
          ) : null}
        </div>
        <Steps current={step} />
      </CardHeader>

      <CardContent>
        {failure && step < 2 ? (
          <Alert variant="destructive" className="mb-4">
            <AlertCircleIcon />
            <AlertDescription>{errorMessage(failure)}</AlertDescription>
          </Alert>
        ) : null}

        {step === 0 ? (
          <form method="post" id="details" onSubmit={submitDetails} noValidate>
            <FieldGroup>
              <Controller
                control={form.control}
                name="name"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="name">{t("name")}</FieldLabel>
                    <Input
                      {...field}
                      id="name"
                      autoComplete="name"
                      autoFocus
                      aria-invalid={fieldState.invalid}
                    />
                    <FormError error={fieldState.error} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
                    <Input
                      {...field}
                      id="email"
                      type="email"
                      autoComplete="username"
                      aria-invalid={fieldState.invalid}
                    />
                    <FormError error={fieldState.error} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
                    <Input
                      {...field}
                      id="password"
                      type="password"
                      autoComplete="new-password"
                      aria-invalid={fieldState.invalid}
                    />
                    <FormError error={fieldState.error} />
                  </Field>
                )}
              />
            </FieldGroup>
          </form>
        ) : null}

        {step === 1 && makeQr.data ? (
          <form
            method="post"
            id="authenticator"
            onSubmit={(event) => {
              event.preventDefault();
              void submitCode(code);
            }}
          >
            <TotpEnrolment
              qrDataUrl={makeQr.data.qrDataUrl}
              manualKey={makeQr.data.manualKey}
              code={code}
              onCodeChange={setCode}
              onComplete={(value) => void submitCode(value)}
            />
          </form>
        ) : null}

        {step === 2 && backupCodes ? (
          <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">{t("backupHint")}</p>
            <BackupCodes codes={backupCodes} />
            <Field orientation="horizontal">
              <Checkbox
                id="saved"
                checked={saved}
                onCheckedChange={(value) => setSaved(value === true)}
              />
              <FieldLabel htmlFor="saved" className="font-normal">
                {t("backupConfirm")}
              </FieldLabel>
            </Field>
          </div>
        ) : null}
      </CardContent>

      <CardFooter className="flex justify-between gap-2">
        {step === 1 ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              makeQr.reset();
              register.reset();
              setCode("");
            }}
          >
            {tc("back")}
          </Button>
        ) : (
          <span />
        )}

        {step === 0 ? (
          <Button type="submit" form="details" disabled={makeQr.isPending}>
            {makeQr.isPending ? <Spinner /> : null}
            {tc("next")}
          </Button>
        ) : null}

        {step === 1 ? (
          <Button
            type="submit"
            form="authenticator"
            disabled={register.isPending || code.length !== 6}
          >
            {register.isPending ? <Spinner /> : null}
            {t("register")}
          </Button>
        ) : null}

        {step === 2 ? (
          <Button
            type="button"
            disabled={!saved || finishing}
            onClick={() => void finish()}
          >
            {finishing ? <Spinner /> : null}
            {t("finish")}
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  );
}
