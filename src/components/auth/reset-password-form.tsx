"use client";

import { AlertCircleIcon, CheckCircle2Icon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

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
import { Field, FieldGroup, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { authClient } from "~/lib/auth/client";
import { type AuthErrorCode, authErrorFromStatus } from "~/lib/auth-routing";

export function ResetPasswordForm({
  token,
  invalid,
}: {
  token: string | null;
  invalid: boolean;
}) {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);

  const back = (
    <Button variant="link" asChild>
      <Link href="/auth/login">{t("forgot.backToLogin")}</Link>
    </Button>
  );

  if (invalid) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertDescription>{t("reset.invalid")}</AlertDescription>
      </Alert>
    );
  }

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("forgot.title")}</CardTitle>
          <CardDescription>{t("forgot.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <Alert>
              <CheckCircle2Icon />
              <AlertDescription>{t("forgot.sent")}</AlertDescription>
            </Alert>
          ) : (
            <form
              method="post"
              id="forgot-form"
              onSubmit={async (event) => {
                event.preventDefault();
                setPending(true);
                setError(null);
                const { error: failure } =
                  await authClient.requestPasswordReset({
                    email,
                    redirectTo: "/auth/reset",
                  });
                setPending(false);

                // the same answer whether or not the address exists
                if (failure?.status === 429 || (failure?.status ?? 0) >= 500) {
                  setError(authErrorFromStatus(failure?.status));
                } else {
                  setDone(true);
                }
              }}
            >
              <FieldGroup>
                {error ? (
                  <Alert variant="destructive">
                    <AlertCircleIcon />
                    <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                  </Alert>
                ) : null}
                <Field>
                  <FieldLabel htmlFor="forgot-email">
                    {t("forgot.email")}
                  </FieldLabel>
                  <Input
                    id="forgot-email"
                    type="email"
                    autoComplete="username"
                    autoFocus
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </Field>
              </FieldGroup>
            </form>
          )}
        </CardContent>
        <CardFooter className="justify-between">
          {back}
          {done ? null : (
            <Button
              type="submit"
              form="forgot-form"
              disabled={pending || !email}
            >
              {pending ? <Spinner /> : null}
              {t("forgot.submit")}
            </Button>
          )}
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("reset.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {done ? (
          <Alert>
            <CheckCircle2Icon />
            <AlertDescription>{t("reset.done")}</AlertDescription>
          </Alert>
        ) : (
          <form
            method="post"
            id="reset-form"
            onSubmit={async (event) => {
              event.preventDefault();
              setPending(true);
              setError(null);
              // the code rides along with better-auth's reset request and is
              // checked by the server before the password changes
              const { error: failure } = await authClient.$fetch(
                "/reset-password",
                {
                  method: "POST",
                  body: { token, newPassword: password, code: code.trim() },
                },
              );
              setPending(false);

              if (failure) {
                setError(authErrorFromStatus(failure.status));
              } else {
                setDone(true);
              }
            }}
          >
            <FieldGroup>
              {error ? (
                <Alert variant="destructive">
                  <AlertCircleIcon />
                  <AlertDescription>{t(`errors.${error}`)}</AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <FieldLabel htmlFor="reset-password">
                  {t("reset.password")}
                </FieldLabel>
                <Input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="reset-code">{t("reset.code")}</FieldLabel>
                <Input
                  id="reset-code"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </Field>
            </FieldGroup>
          </form>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        {back}
        {done ? null : (
          <Button
            type="submit"
            form="reset-form"
            disabled={pending || password.length < 6 || code.trim().length < 6}
          >
            {pending ? <Spinner /> : null}
            {t("reset.submit")}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
