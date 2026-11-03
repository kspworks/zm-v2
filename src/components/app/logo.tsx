import { cn } from "~/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "bg-primary text-primary-foreground inline-flex size-8 items-center justify-center rounded-lg text-sm font-semibold tracking-tight",
        className,
      )}
    >
      ZM
    </span>
  );
}
