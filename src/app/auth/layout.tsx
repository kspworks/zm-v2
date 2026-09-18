import { LanguageSwitcher } from "~/components/app/language-switcher";
import { Logo } from "~/components/app/logo";

export default function AuthLayout({ children }: LayoutProps<"/auth">) {
  return (
    <div className="relative flex min-h-svh flex-col bg-muted/40">
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Logo />
        <LanguageSwitcher />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
