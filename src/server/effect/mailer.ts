import { Context, Effect, Layer } from "effect";
import nodemailer from "nodemailer";

import type { MailConfig } from "~/server/config";
import { AppConfig } from "~/server/effect/app-config";
import { reportError } from "~/server/lib/report";
import {
  fromAddress,
  type Mail,
  type SendResult,
  transportOptions,
} from "~/server/mail/transport";

export type Transporter = Pick<
  ReturnType<typeof nodemailer.createTransport>,
  "sendMail"
>;

/**
 * Outgoing mail. `send` never fails: it reports a transport error and returns
 * "failed", and returns "skipped" when SMTP is not configured.
 */
export class Mailer extends Context.Service<
  Mailer,
  {
    readonly configured: boolean;
    send(mail: Mail): Effect.Effect<SendResult>;
  }
>()("zm/server/effect/Mailer") {
  static readonly make = (
    config: MailConfig | null,
    transporter?: Transporter,
  ) => {
    if (!config) {
      return Mailer.of({
        configured: false,
        send: () => Effect.succeed("skipped"),
      });
    }

    const smtp =
      transporter ?? nodemailer.createTransport(transportOptions(config));

    return Mailer.of({
      configured: true,
      send: Effect.fn("Mailer.send")(function* (mail: Mail) {
        return yield* Effect.tryPromise(() =>
          smtp.sendMail({ from: fromAddress(config), ...mail }),
        ).pipe(
          Effect.map(
            (info): SendResult =>
              info.rejected.length > 0 ? "rejected" : "sent",
          ),
          Effect.catch((error) =>
            Effect.sync((): SendResult => {
              reportError(error.cause, "mail");

              return "failed";
            }),
          ),
        );
      }),
    });
  };

  static readonly layer = Layer.effect(
    Mailer,
    Effect.map(AppConfig, ({ mail }) => Mailer.make(mail)),
  );

  /** A mailer over a fake transporter, for tests */
  static readonly layerWith = (
    config: MailConfig | null,
    transporter?: Transporter,
  ) => Layer.succeed(Mailer, Mailer.make(config, transporter));
}
