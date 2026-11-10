import type { ComponentProps } from "react"
import { cn } from "cn"

/** A placeholder block; the shimmer is the `skeleton` utility in globals.css */
function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("skeleton rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
