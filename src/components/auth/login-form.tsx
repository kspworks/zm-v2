"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { FormError } from "~/components/app/form-error";
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
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "~/components/ui/input-otp";
import { Spinner } from "~/components/ui/spinner";
import { authClient } from "~/lib/auth/client";
import { type AuthErrorCode, authErrorFromStatus } from "~/lib/auth-routing";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

type Step = "credentials" | "totp" | "backup";

type Props = {
  callbackUrl: string;
  initialError: AuthErrorCode | null;
  canResetPassword: boolean;
  /** Set while no active admin exists, i.e. on a fresh install */
  adminInviteHref: string | null;
};

export function LoginForm({
  callbackUrl,
  initialError,
  canResetPassword,
  adminInviteHref,
}: Props) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [step, setStep] = useState<Step>("credentials");
  const [error, setError] = useState<AuthErrorCode | null>(initialError);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const form = useForm({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: "", password: "" },
  });

  const signIn = form.handleSubmit(async ({ email, password }) => {
    setError(null);
    setSubmitting(true);

    try {
      const { data, error: failure } = await authClient.signIn.email({
        email,
        password,
      });

      if (failure) {
        setError(authErrorFromStatus(failure.status));
        return;
      }

      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        setStep("totp");
        return;
      }

      router.replace(callbackUrl);
      router.refresh();
    } catch {
      setError("ServiceUnavailable");
    } finally {
      setSubmitting(false);
    }
  });

  const verify = async (value: string) => {
    if (submitting) {
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const { error: failure } =
        step === "backup"
          ? await authClient.twoFactor.verifyBackupCode({ code: value.trim() })
          : await authClient.twoFactor.verifyTotp({ code: value });

      if (failure) {
        setError(authErrorFromStatus(failure.status));
        setCode("");
        return;
      }

      // a spent backup code means the authenticator is probably gone
      router.replace(step === "backup" ? "/settings?reenrol=1" : callbackUrl);
      router.refresh();
    } catch {
      setError("ServiceUnavailable");
    } finally {
      setSubmitting(false);
    }
  };

  const startOver = () => {
    setStep("credentials");
    setCode("");
    setError(null);
  };

  const errorAlert = error ? (
    <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
    </Alert>
  ) : null;

  if (step === "credentials") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("login.title")}</CardTitle>
          <CardDescription>{t("login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" onSubmit={signIn} noValidate>
            <FieldGroup>
              {errorAlert}
              <Controller
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="email">{t("login.email")}</FieldLabel>
                    <Input
                      {...field}
                      id="email"
                      type="email"
                      autoComplete="username"
                      autoFocus
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
                    <div className="flex items-center justify-between">
                      <FieldLabel htmlFor="password">
                        {t("login.password")}
                      </FieldLabel>
                      {canResetPassword ? (
                        <Link
                          href="/auth/reset"
                          className="text-muted-foreground text-sm underline-offset-4 hover:underline"
                        >
                          {t("login.forgotPassword")}
                        </Link>
                      ) : null}
                    </div>
                    <Input
                      {...field}
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      aria-invalid={fieldState.invalid}
                    />
                    <FormError error={fieldState.error} />
                  </Field>
                )}
              />
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? <Spinner /> : null}
                {t("login.submit")}
              </Button>
              {adminInviteHref ? (
                <Link
                  href={adminInviteHref}
                  className="text-center text-muted-foreground text-sm underline underline-offset-4 hover:text-foreground"
                >
                  {t("login.setUpAdmin")}
                </Link>
              ) : null}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("login.codeTitle")}</CardTitle>
        <CardDescription>
          {step === "totp"
            ? t("login.codeSubtitle")
            : t("login.backupSubtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            void verify(code);
          }}
        >
          <FieldGroup>
            {errorAlert}
            {step === "totp" ? (
              <Field className="items-center">
                <FieldLabel htmlFor="totp" className="sr-only">
                  {t("login.code")}
                </FieldLabel>
                <InputOTP
                  id="totp"
                  maxLength={6}
                  inputMode="numeric"
                  pattern="^[0-9]*$"
                  autoComplete="one-time-code"
                  autoFocus
                  value={code}
                  onChange={setCode}
                  onComplete={(value: string) => void verify(value)}
                  containerClassName="justify-center"
                >
                  <InputOTPGroup>
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <InputOTPSlot key={index} index={index} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="backup">
                  {t("login.backupCode")}
                </FieldLabel>
                <Input
                  id="backup"
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || code.trim().length < 6}
            >
              {submitting ? <Spinner /> : null}
              {t("login.verify")}
            </Button>
            <div className="flex flex-col items-center gap-1 text-sm">
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => {
                  setCode("");
                  setError(null);
                  setStep(step === "totp" ? "backup" : "totp");
                }}
              >
                {step === "totp"
                  ? t("login.useBackupCode")
                  : t("login.useTotp")}
              </Button>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="text-muted-foreground"
                onClick={startOver}
              >
                {t("login.startOver")}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
