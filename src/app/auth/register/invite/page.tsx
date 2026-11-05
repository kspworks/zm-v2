import { Effect } from "effect";
import { AlertCircleIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { RegisterWizard } from "~/components/auth/register-wizard";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { runServer } from "~/server/effect/runtime";
import { validateInvite } from "~/server/services/invites";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.register");

  return { title: t("title") };
}

export default async function RegisterInvitePage({
  searchParams,
}: PageProps<"/auth/register/invite">) {
  const t = await getTranslations("auth.register");
  const { id } = await searchParams;
  const inviteId = typeof id === "string" ? id.trim() : "";

  const invite = inviteId
    ? await runServer(
        validateInvite(inviteId).pipe(
          Effect.catchTag("Forbidden", () => Effect.succeed(null)),
        ),
      )
    : null;

  if (!invite) {
    return (
      <Alert variant="destructive">
        <AlertCircleIcon />
        <AlertTitle>{t("title")}</AlertTitle>
        <AlertDescription>{t("invalidInvite")}</AlertDescription>
      </Alert>
    );
  }

  return <RegisterWizard inviteId={inviteId} isAdmin={invite.isAdmin} />;
}
