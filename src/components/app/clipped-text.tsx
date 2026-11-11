"use client";

import { useRef, useState } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/ui/tooltip";

/**
 * Whether the text is cut off: a line clamp hides the wrapped lines below,
 * and a single unbreakable word runs out to the side. The pixel of slack
 * absorbs subpixel rounding.
 */
const isClipped = (node: HTMLElement | null) =>
  !!node &&
  (node.scrollHeight > node.clientHeight + 1 ||
    node.scrollWidth > node.clientWidth + 1);

/**
 * A paragraph that clamps or truncates through its `className`, with its full
 * text in a tooltip only while it is actually cut off. It is measured when the
 * tooltip is about to open, so it follows the current width without watching
 * every row for resizes.
 */
export function ClippedText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => setOpen(next && isClipped(ref.current))}
    >
      <TooltipTrigger asChild>
        <p ref={ref} className={className}>
          {children}
        </p>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm whitespace-pre-wrap">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
