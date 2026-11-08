import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppSidebar } from "~/components/app/app-sidebar";
import { LocaleCookieSync } from "~/components/app/locale-cookie-sync";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";
import { LOGIN_PATH } from "~/lib/auth-routing";
import { getCurrentUser } from "~/server/auth/session";
import { buildId } from "~/server/config";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  if (!user) {
    // the cookie existed (the proxy let us through) but the session is dead
    redirect(LOGIN_PATH);
  }

  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const isAdmin = user.role === "admin";

  const t = await getTranslations("nav");

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-4 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t("skip")}
      </a>
      <LocaleCookieSync profileLocale={user.locale === "en" ? "en" : "uk"} />
      <AppSidebar
        isAdmin={isAdmin}
        isDevBuild={!buildId()}
        user={{
          name: user.name,
          email: user.email,
          build: isAdmin
            ? { id: buildId() ?? null, env: process.env.NODE_ENV ?? "" }
            : null,
        }}
      />
      {/* room for the fixed bottom nav */}
      <SidebarInset
        id="main"
        tabIndex={-1}
        className="min-w-0 outline-none max-md:pb-[calc(3.5rem+env(safe-area-inset-bottom))]"
      >
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
