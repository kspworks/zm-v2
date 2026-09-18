import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { UsersView } from "~/components/admin/users-view";
import { getCurrentUser } from "~/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("users");

  return { title: t("title") };
}

export default async function UsersPage() {
  const user = await getCurrentUser();

  if (user?.role !== "admin") {
    notFound();
  }

  return <UsersView currentUserId={user.id} />;
}
