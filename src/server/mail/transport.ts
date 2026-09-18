import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";

import { type MailConfig, mailConfig } from "~/server/config";
import { reportError } from "~/server/lib/report";

/**
 * Explicit host and port, TLS. Never a nodemailer `service` preset: it
 * silently overrides the configured host.
 */
export const transportOptions = (
  config: MailConfig,
): SMTPTransport.Options => ({
  host: config.host,
  port: config.port,
  secure: config.port === 465,
  requireTLS: config.port !== 465,
  auth: { user: config.user, pass: config.pass },
});

export const fromAddress = (config: MailConfig) =>
  `ZM Notifications <${config.from}>`;

export type SendResult = "sent" | "rejected" | "failed" | "skipped";

export type Mail = { to: string; subject: string; html: string; text: string };

type Transporter = Pick<
  ReturnType<typeof nodemailer.createTransport>,
  "sendMail"
>;

let cached: { key: string; transporter: Transporter } | undefined;

const transporterFor = (config: MailConfig): Transporter => {
  const key = `${config.host}:${config.port}:${config.user}`;

  if (cached?.key !== key) {
    cached = {
      key,
      transporter: nodemailer.createTransport(transportOptions(config)),
    };
  }

  return cached.transporter;
};

/** Sends one mail; never throws, reports failures and returns the outcome */
export const sendMail = async (
  mail: Mail,
  {
    config = mailConfig(),
    transporter,
  }: { config?: MailConfig | null; transporter?: Transporter } = {},
): Promise<SendResult> => {
  if (!config) {
    return "skipped";
  }

  try {
    const info = await (transporter ?? transporterFor(config)).sendMail({
      from: fromAddress(config),
      ...mail,
    });

    return info.rejected.length > 0 ? "rejected" : "sent";
  } catch (error) {
    reportError(error, "mail");

    return "failed";
  }
};
