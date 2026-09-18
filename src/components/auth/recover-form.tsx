"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircleIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { BackupCodes } from "~/components/auth/backup-codes";
import { TotpEnrolment } from "~/components/auth/totp-enrolment";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { Spinner } from "~/components/ui/spinner";
import { useErrorMessage } from "~/hooks/use-error-message";
import { signInWithTicket } from "~/lib/auth/client";
import { useTRPC } from "~/trpc/react";

/** Walks through the steps an admin-issued recovery link covers */
export function RecoverForm({ token }: { token: string }) {
  const t = useTranslations("recover");
  const trpc = useTRPC();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [newPassword, setNewPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [code, setCode] = useState("");

  const link = useQuery({
    ...trpc.recovery.validate.queryOptions({ token }),
    retry: false,
  });
  const scope = link.data?.scope;
  const needsTwoFactor = scope === "twoFactor" || scope === "both";

  const startEnrolment = useMutation(
    trpc.recovery.startEnrolment.mutationOptions(),
  );
  const complete = useMutation(trpc.recovery.complete.mutationOptions());

  if (link.isPending) {
    return <Skeleton className="h-80 w-full" />;
  }

  if (link.isError || !link.data) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>{t("title")}</AlertTitle>
        <AlertDescription>{t("invalid")}</AlertDescription>
      </Alert>
    );
  }

  if (complete.data) {
    const { backupCodes, ticket } = complete.data;

    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("title")}</CardTitle>
          <CardDescription>
            {ticket ? t("done") : t("passwordDone")}
          </CardDescription>
        </CardHeader>
        {backupCodes ? (
          <CardContent>
            <BackupCodes codes={backupCodes} />
          </CardContent>
        ) : null}
        <CardFooter className="justify-end">
          {ticket ? (
            <Button
              onClick={async () => {
                await signInWithTicket(ticket).catch(() => undefined);
                router.replace("/transactions");
                router.refresh();
              }}
            >
              {t("continue")}
            </Button>
          ) : (
            <Button asChild>
              <Link href="/auth/login">{t("toLogin")}</Link>
            </Button>
          )}
        </CardFooter>
      </Card>
    );
  }

  const failure = complete.error ?? startEnrolment.error;
  const qr = startEnrolment.data;
  const ready =
    (scope === "twoFactor"
      ? currentPassword.length > 0
      : newPassword.length >= 6) &&
    (!needsTwoFactor || code.length === 6);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("title")}</CardTitle>
        <CardDescription>
          {t("for", { name: link.data.name, email: link.data.email })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          method="post"
          id="recover-form"
          onSubmit={(event) => {
            event.preventDefault();
            complete.mutate({
              token,
              newPassword: scope === "twoFactor" ? null : newPassword,
              currentPassword: scope === "twoFactor" ? currentPassword : null,
              code: needsTwoFactor ? code : null,
            });
          }}
        >
          <FieldGroup>
            {failure ? (
              <Alert variant="destructive">
                <AlertCircleIcon />
                <AlertDescription>{errorMessage(failure)}</AlertDescription>
              </Alert>
            ) : null}
            {scope === "twoFactor" ? (
              <Field>
                <FieldLabel htmlFor="recover-current">
                  {t("currentPassword")}
                </FieldLabel>
                <Input
                  id="recover-current"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="recover-new">
                  {t("newPassword")}
                </FieldLabel>
                <Input
                  id="recover-new"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
              </Field>
            )}
            {needsTwoFactor ? (
              <Field>
                <FieldLabel>{t("authenticator")}</FieldLabel>
                {qr ? (
                  <TotpEnrolment
                    qrDataUrl={qr.qrDataUrl}
                    manualKey={qr.manualKey}
                    code={code}
                    onCodeChange={setCode}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="self-start"
                    disabled={startEnrolment.isPending}
                    onClick={() => startEnrolment.mutate({ token })}
                  >
                    {startEnrolment.isPending ? <Spinner /> : null}
                    {t("authenticator")}
                  </Button>
                )}
              </Field>
            ) : null}
          </FieldGroup>
        </form>
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          type="submit"
          form="recover-form"
          disabled={!ready || complete.isPending || (needsTwoFactor && !qr)}
        >
          {complete.isPending ? <Spinner /> : null}
          {t("finish")}
        </Button>
      </CardFooter>
    </Card>
  );
}
