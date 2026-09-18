import { describe, expect, it } from "vitest";

import {
  insufficientFundsEmail,
  passwordResetEmail,
} from "~/server/mail/templates";
import {
  fromAddress,
  sendMail,
  transportOptions,
} from "~/server/mail/transport";

const config = {
  host: "smtp.example.org",
  port: 587,
  user: "robot@example.org",
  pass: "secret",
  from: "zm@example.org",
};

/**
 * Contract: the nodemailer options keep the configured host and port and
 * never use a `service` preset, which would silently override the host.
 */
describe("transportOptions", () => {
  it("respects host and port, with TLS", () => {
    const options = transportOptions(config);

    expect(options).toMatchObject({
      host: "smtp.example.org",
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: "robot@example.org", pass: "secret" },
    });
    expect(options).not.toHaveProperty("service");
    expect(transportOptions({ ...config, port: 465 }).secure).toBe(true);
  });

  it("sends from 'ZM Notifications'", () => {
    expect(fromAddress(config)).toBe("ZM Notifications <zm@example.org>");
  });
});

describe("sendMail", () => {
  const mail = {
    to: "a@example.com",
    subject: "s",
    html: "<p>h</p>",
    text: "h",
  };

  it("reports sent, rejected and failed, and never throws", async () => {
    const ok = { sendMail: async () => ({ rejected: [] }) };
    const rejected = {
      sendMail: async () => ({ rejected: ["a@example.com"] }),
    };
    const broken = {
      sendMail: async () => {
        throw new Error("smtp down");
      },
    };

    expect(await sendMail(mail, { config, transporter: ok as never })).toBe(
      "sent",
    );
    expect(
      await sendMail(mail, { config, transporter: rejected as never }),
    ).toBe("rejected");
    expect(await sendMail(mail, { config, transporter: broken as never })).toBe(
      "failed",
    );
    expect(await sendMail(mail, { config: null })).toBe("skipped");
  });
});

describe("email rendering", () => {
  it("puts the key facts of every section into the insufficient-funds mail", async () => {
    const mail = await insufficientFundsEmail("en", [
      {
        accountName: "Main card",
        date: "2026-03-16",
        plannedAmount: -150_000,
        currentBalance: 100_000,
        shortage: -50_000,
        currencySign: "₴",
      },
    ]);

    expect(mail.subject).toBe("Insufficient funds for planned transactions");
    for (const fact of [
      "Main card",
      "16.03.2026",
      "-1 500.00 ₴",
      "1 000.00 ₴",
      "-500.00 ₴",
    ]) {
      expect(mail.text).toContain(fact);
      expect(mail.html).toContain(fact);
    }
  });

  it("renders in the recipient's locale", async () => {
    const mail = await insufficientFundsEmail("uk", []);

    expect(mail.subject).toBe("Недостатньо коштів для запланованих транзакцій");
  });

  it("puts the reset link into the password reset mail", async () => {
    const mail = await passwordResetEmail("en", {
      name: "Olena",
      url: "https://zm.example.org/api/auth/reset-password/abc?callbackURL=%2Fauth%2Freset",
    });

    expect(mail.text).toContain("Olena");
    expect(mail.text).toContain(
      "https://zm.example.org/api/auth/reset-password/abc",
    );
  });
});
