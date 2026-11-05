import type SMTPTransport from "nodemailer/lib/smtp-transport";

import type { MailConfig } from "~/server/config";

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
