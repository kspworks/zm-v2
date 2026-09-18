import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    // never during "next build", which also evaluates this hook
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      const { migrateOnBoot } = await import("~/server/migrate-on-boot");
      await migrateOnBoot();
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
