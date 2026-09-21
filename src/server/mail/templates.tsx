import type { ReactElement } from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  render,
  Section,
  Text,
} from "react-email";

import type { Locale } from "~/i18n/config";
import { formatDisplayDate } from "~/lib/dates";
import { formatMoney } from "~/lib/money";
import { getServerTranslator } from "~/server/lib/i18n";

const body = {
  backgroundColor: "#f5f5f4",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  color: "#171717",
};
const card = {
  backgroundColor: "#ffffff",
  borderRadius: "12px",
  padding: "24px",
  margin: "24px auto",
  maxWidth: "520px",
};
const muted = { color: "#737373", fontSize: "13px" };
const row = { margin: "4px 0", fontSize: "14px" };

export type ShortageSection = {
  accountName: string;
  date: string;
  plannedAmount: number;
  currentBalance: number;
  shortage: number;
  currencySign: string;
};

const renderBoth = async (element: ReactElement) => ({
  html: await render(element),
  text: await render(element, { plainText: true }),
});

/**
 * The components below are async so they can translate themselves; that keeps
 * them mountable by the `email dev` preview server (see "emails/"), which needs
 * a plain element, not the rendered `{ subject, html, text }` payload.
 */
export const InsufficientFundsEmail = async ({
  locale,
  sections,
}: {
  locale: Locale;
  sections: ShortageSection[];
}) => {
  const t = await getServerTranslator(locale);

  return (
    <Html lang={locale}>
      <Head />
      <Body style={body}>
        <Container style={card}>
          <Heading as="h2" style={{ fontSize: "18px" }}>
            {t("mail.insufficientFunds.subject")}
          </Heading>
          <Text>{t("mail.insufficientFunds.intro")}</Text>
          {sections.map((section) => (
            <Section
              key={`${section.accountName}-${section.date}`}
              style={{ borderTop: "1px solid #e5e5e5", paddingTop: "8px" }}
            >
              <Text style={row}>
                <b>{t("mail.insufficientFunds.account")}:</b>{" "}
                {section.accountName}
              </Text>
              <Text style={row}>
                {t("mail.insufficientFunds.date")}:{" "}
                {formatDisplayDate(section.date)}
              </Text>
              <Text style={row}>
                {t("mail.insufficientFunds.plannedAmount")}:{" "}
                {formatMoney(section.plannedAmount, section.currencySign)}
              </Text>
              <Text style={row}>
                {t("mail.insufficientFunds.currentBalance")}:{" "}
                {formatMoney(section.currentBalance, section.currencySign)}
              </Text>
              <Text style={{ ...row, color: "#dc2626" }}>
                {t("mail.insufficientFunds.amountShortage")}:{" "}
                {formatMoney(section.shortage, section.currencySign)}
              </Text>
            </Section>
          ))}
          <Hr />
          <Text style={muted}>{t("mail.footer")}</Text>
        </Container>
      </Body>
    </Html>
  );
};

export const insufficientFundsEmail = async (
  locale: Locale,
  sections: ShortageSection[],
) => {
  const t = await getServerTranslator(locale);

  return {
    subject: t("mail.insufficientFunds.subject"),
    ...(await renderBoth(
      <InsufficientFundsEmail locale={locale} sections={sections} />,
    )),
  };
};

export const PasswordResetEmail = async ({
  locale,
  name,
  url,
}: {
  locale: Locale;
  name: string;
  url: string;
}) => {
  const t = await getServerTranslator(locale);

  return (
    <Html lang={locale}>
      <Head />
      <Body style={body}>
        <Container style={card}>
          <Heading as="h2" style={{ fontSize: "18px" }}>
            {t("mail.passwordReset.subject")}
          </Heading>
          <Text>{t("mail.passwordReset.greeting", { name })}</Text>
          <Text>{t("mail.passwordReset.body")}</Text>
          <Button
            href={url}
            style={{
              backgroundColor: "#171717",
              color: "#ffffff",
              borderRadius: "8px",
              padding: "10px 16px",
              fontSize: "14px",
            }}
          >
            {t("mail.passwordReset.button")}
          </Button>
          <Text style={muted}>{url}</Text>
          <Text style={muted}>{t("mail.passwordReset.ignore")}</Text>
        </Container>
      </Body>
    </Html>
  );
};

export const passwordResetEmail = async (
  locale: Locale,
  { name, url }: { name: string; url: string },
) => {
  const t = await getServerTranslator(locale);

  return {
    subject: t("mail.passwordReset.subject"),
    ...(await renderBoth(
      <PasswordResetEmail locale={locale} name={name} url={url} />,
    )),
  };
};
