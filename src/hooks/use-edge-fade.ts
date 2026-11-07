"use client";

import { useEffect, useState } from "react";

const FADE = "3rem";

/**
 * Fades the edges of a horizontal scroller that has more content past them,
 * so it is clear there is something to scroll to. `left: false` keeps the
 * start crisp, for a table with a sticky first column.
 */
export const useEdgeFade = ({ left: fadeLeft = true } = {}) => {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    if (!node) {
      return;
    }

    const update = () => {
      const max = node.scrollWidth - node.clientWidth;

      setEdges({
        left: fadeLeft && node.scrollLeft > 1,
        right: node.scrollLeft < max - 1,
      });
    };

    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);

    return () => {
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [node, fadeLeft]);

  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "black"}, black ${FADE}, black calc(100% - ${FADE}), ${edges.right ? "transparent" : "black"})`
      : undefined;

  return {
    ref: setNode,
    style: mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined,
  };
};
