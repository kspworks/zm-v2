"use client";

import { useMutation } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "~/components/app/page-header";
import { BackupCodes } from "~/components/auth/backup-codes";
import { TotpEnrolment } from "~/components/auth/totp-enrolment";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { useToastError } from "~/hooks/use-toast-error";
import { useTRPC } from "~/trpc/react";

function TextField({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  inputMode,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
  inputMode?: "numeric";
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

const submitWith = (action: () => void) => (event: FormEvent) => {
  event.preventDefault();
  action();
};

function PasswordCard() {
  const t = useTranslations("settings");
  const trpc = useTRPC();
  const toastError = useToastError();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [code, setCode] = useState("");

  const change = useMutation(
    trpc.settings.changePassword.mutationOptions({
      onSuccess: () => {
        toast.success(t("passwordChanged"));
        setCurrent("");
        setNext("");
        setCode("");
      },
      onError: toastError,
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("password")}</CardTitle>
        <CardDescription>{t("passwordHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          method="post"
          onSubmit={submitWith(() =>
            change.mutate({
              currentPassword: current,
              newPassword: next,
              code,
            }),
          )}
        >
          <FieldGroup>
            <TextField
              id="pw-current"
              label={t("currentPassword")}
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={setCurrent}
            />
            <TextField
              id="pw-new"
              label={t("newPassword")}
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={setNext}
            />
            <TextField
              id="pw-code"
              label={t("code")}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={setCode}
            />
            <Button
              type="submit"
              className="self-start"
              disabled={
                change.isPending || next.length < 6 || code.length !== 6
              }
            >
              {change.isPending ? <Spinner /> : null}
              {t("changePassword")}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function AuthenticatorCard() {
  const t = useTranslations("settings");
  const trpc = useTRPC();
  const toastError = useToastError();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newCode, setNewCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  const start = useMutation(
    trpc.settings.startReenrol.mutationOptions({ onError: toastError }),
  );
  const confirm = useMutation(
    trpc.settings.confirmReenrol.mutationOptions({
      onSuccess: (result) => {
        toast.success(t("reenrolled"));
        setCodes(result.backupCodes);
        start.reset();
        setPassword("");
        setCode("");
        setNewCode("");
      },
      onError: (error) => {
        setNewCode("");
        toastError(error);
      },
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("authenticator")}</CardTitle>
        <CardDescription>{t("authenticatorHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {codes ? (
          <>
            <p className="font-medium text-sm">{t("newCodes")}</p>
            <BackupCodes codes={codes} />
          </>
        ) : start.data ? (
          <form
            method="post"
            className="flex flex-col gap-4"
            onSubmit={submitWith(() => confirm.mutate({ code: newCode }))}
          >
            <TotpEnrolment
              qrDataUrl={start.data.qrDataUrl}
              manualKey={start.data.manualKey}
              code={newCode}
              onCodeChange={setNewCode}
              onComplete={(value) => confirm.mutate({ code: value })}
            />
            <Button
              type="submit"
              className="self-center"
              disabled={confirm.isPending || newCode.length !== 6}
            >
              {confirm.isPending ? <Spinner /> : null}
              {t("confirm")}
            </Button>
          </form>
        ) : (
          <form
            method="post"
            onSubmit={submitWith(() => start.mutate({ password, code }))}
          >
            <FieldGroup>
              <TextField
                id="re-password"
                label={t("currentPassword")}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
              />
              <TextField
                id="re-code"
                label={t("codeOrBackup")}
                autoComplete="one-time-code"
                value={code}
                onChange={setCode}
              />
              <Button
                type="submit"
                className="self-start"
                disabled={
                  start.isPending || !password || code.trim().length < 6
                }
              >
                {start.isPending ? <Spinner /> : null}
                {t("reenrol")}
              </Button>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function BackupCodesCard() {
  const t = useTranslations("settings");
  const trpc = useTRPC();
  const toastError = useToastError();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const regenerate = useMutation(
    trpc.settings.backupCodes.mutationOptions({
      onSuccess: () => {
        setPassword("");
        setCode("");
      },
      onError: toastError,
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("backupCodes")}</CardTitle>
        <CardDescription>{t("backupHint")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {regenerate.data ? (
          <BackupCodes codes={regenerate.data.backupCodes} />
        ) : (
          <form
            method="post"
            onSubmit={submitWith(() => regenerate.mutate({ password, code }))}
          >
            <FieldGroup>
              <TextField
                id="bc-password"
                label={t("currentPassword")}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
              />
              <TextField
                id="bc-code"
                label={t("code")}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={setCode}
              />
              <Button
                type="submit"
                className="self-start"
                disabled={
                  regenerate.isPending || !password || code.length !== 6
                }
              >
                {regenerate.isPending ? <Spinner /> : null}
                {t("regenerate")}
              </Button>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsView({ reenrolPrompt }: { reenrolPrompt: boolean }) {
  const t = useTranslations("settings");

  return (
    <>
      <PageHeader title={t("title")} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
        {reenrolPrompt ? (
          <Alert>
            <InfoIcon />
            <AlertDescription>{t("reenrolPrompt")}</AlertDescription>
          </Alert>
        ) : null}
        <AuthenticatorCard />
        <PasswordCard />
        <BackupCodesCard />
      </div>
    </>
  );
}
