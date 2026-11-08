"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import { useSwitchLocale } from "~/components/app/language-switcher";
import { PageHeader } from "~/components/app/page-header";
import { BackupCodes } from "~/components/auth/backup-codes";
import { TotpEnrolment } from "~/components/auth/totp-enrolment";
import { ExportCard } from "~/components/settings/export-card";
import { HistoryCard } from "~/components/settings/history-card";
import { ImportCard } from "~/components/settings/import-card";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { usePrimaryCurrency } from "~/hooks/use-primary-currency";
import { useToastError } from "~/hooks/use-toast-error";
import { isLocale, LOCALES } from "~/i18n/config";
import { MIN_PASSWORD_LENGTH } from "~/lib/validators/auth";
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

function PrimaryCurrencyCard() {
  const t = useTranslations("settings");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const toastError = useToastError();
  const currencies = useQuery(trpc.accounts.currencies.queryOptions());
  const primary = usePrimaryCurrency();

  const set = useMutation(
    trpc.me.setPrimaryCurrency.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries(trpc.me.primaryCurrency.pathFilter()),
      onError: toastError,
    }),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("primaryCurrency")}</CardTitle>
        <CardDescription>{t("primaryCurrencyHint")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Select
          value={primary.currencyId ?? ""}
          onValueChange={(currencyId) => set.mutate({ currencyId })}
        >
          <SelectTrigger
            aria-label={t("primaryCurrency")}
            className="w-full sm:w-64"
          >
            <SelectValue placeholder={t("primaryCurrencyAuto")} />
          </SelectTrigger>
          <SelectContent>
            {currencies.data?.map((currency) => (
              <SelectItem key={currency.id} value={currency.id}>
                {currency.code} {currency.sign}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}

/**
 * Password, authenticator and backup codes behind one check: the password and
 * a code are asked once, then any of the three changes can be made.
 */
function SecurityPanel() {
  const t = useTranslations("settings");
  const trpc = useTRPC();
  const toastError = useToastError();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [newCode, setNewCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

  const clearCheck = () => {
    setPassword("");
    setCode("");
  };
  // an authenticator code works once; the re-enrolment also takes a backup code
  const checked = !!password && /^\d{6}$/.test(code.trim());
  const checkedOrBackup = !!password && code.trim().length >= 6;

  const change = useMutation(
    trpc.settings.changePassword.mutationOptions({
      onSuccess: () => {
        toast.success(t("passwordChanged"));
        clearCheck();
        setNext("");
      },
      onError: toastError,
    }),
  );
  const start = useMutation(
    trpc.settings.startReenrol.mutationOptions({
      onSuccess: clearCheck,
      onError: toastError,
    }),
  );
  const confirm = useMutation(
    trpc.settings.confirmReenrol.mutationOptions({
      onSuccess: (result) => {
        toast.success(t("reenrolled"));
        setCodes(result.backupCodes);
        start.reset();
        setNewCode("");
      },
      onError: (error) => {
        setNewCode("");
        toastError(error);
      },
    }),
  );
  const regenerate = useMutation(
    trpc.settings.backupCodes.mutationOptions({
      onSuccess: (result) => {
        setCodes(result.backupCodes);
        clearCheck();
      },
      onError: toastError,
    }),
  );

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("checkTitle")}</CardTitle>
          <CardDescription>{t("checkHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" onSubmit={submitWith(() => undefined)}>
            <FieldGroup>
              <TextField
                id="check-password"
                label={t("currentPassword")}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
              />
              <TextField
                id="check-code"
                label={t("codeOrBackup")}
                autoComplete="one-time-code"
                value={code}
                onChange={setCode}
              />
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

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
                currentPassword: password,
                newPassword: next,
                code: code.trim(),
              }),
            )}
          >
            <FieldGroup>
              <TextField
                id="pw-new"
                label={t("newPassword")}
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={setNext}
              />
              <Button
                type="submit"
                className="self-start"
                disabled={
                  change.isPending ||
                  !checked ||
                  next.length < MIN_PASSWORD_LENGTH
                }
              >
                {change.isPending ? <Spinner /> : null}
                {t("changePassword")}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("authenticator")}</CardTitle>
          <CardDescription>{t("authenticatorHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {start.data ? (
            <form
              method="post"
              className="flex flex-col gap-4"
              onSubmit={submitWith(() => confirm.mutate({ code: newCode }))}
            >
              <TotpEnrolment
                qrDataUrl={start.data.qrDataUrl}
                manualKey={start.data.manualKey}
                otpUri={start.data.otpUri}
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
            <Button
              className="self-start"
              disabled={start.isPending || !checkedOrBackup}
              onClick={() => start.mutate({ password, code: code.trim() })}
            >
              {start.isPending ? <Spinner /> : null}
              {t("reenrol")}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("backupCodes")}</CardTitle>
          <CardDescription>{t("backupHint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {codes ? (
            <>
              <p className="text-sm font-medium">{t("newCodes")}</p>
              <BackupCodes codes={codes} />
            </>
          ) : (
            <Button
              className="self-start"
              disabled={regenerate.isPending || !checked}
              onClick={() => regenerate.mutate({ password, code: code.trim() })}
            >
              {regenerate.isPending ? <Spinner /> : null}
              {t("regenerate")}
            </Button>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/** Language and theme, which were two levels deep in the user menu */
function AppearanceCard() {
  const t = useTranslations();
  const locale = useLocale();
  const { theme, setTheme } = useTheme();
  const { switchLocale, pending } = useSwitchLocale(true);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.appearance")}</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="settings-language">
              {t("common.language")}
            </FieldLabel>
            <Select
              value={locale}
              disabled={pending}
              onValueChange={(value) => {
                if (isLocale(value)) {
                  void switchLocale(value);
                }
              }}
            >
              <SelectTrigger id="settings-language" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`locales.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="settings-theme">
              {t("common.theme")}
            </FieldLabel>
            <Select value={theme ?? "dark"} onValueChange={setTheme}>
              <SelectTrigger id="settings-theme" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["system", "light", "dark"] as const).map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(`theme.${option}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

const TABS = ["general", "security", "data"] as const;

export function SettingsView({ reenrolPrompt }: { reenrolPrompt: boolean }) {
  const t = useTranslations("settings");
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(TABS).withDefault(
      reenrolPrompt ? "security" : "general",
    ),
  );

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
        <Tabs
          value={tab}
          onValueChange={(value) => void setTab(value as (typeof TABS)[number])}
        >
          <TabsList className="w-full">
            {TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {t(`tabs.${value}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="general" className="flex flex-col gap-6 pt-4">
            <PrimaryCurrencyCard />
            <AppearanceCard />
          </TabsContent>
          <TabsContent value="security" className="flex flex-col gap-6 pt-4">
            <SecurityPanel />
          </TabsContent>
          <TabsContent value="data" className="flex flex-col gap-6 pt-4">
            <ExportCard />
            <ImportCard />
            <HistoryCard />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
