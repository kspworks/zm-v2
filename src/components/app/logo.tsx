import { cn } from "~/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex size-8 items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground text-sm tracking-tight",
        className,
      )}
    >
      ZM
    </span>
  );
}
