import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
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
      <SidebarInset className="min-w-0">{children}</SidebarInset>
    </SidebarProvider>
  );
}
