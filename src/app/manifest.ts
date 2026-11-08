import type { MetadataRoute } from "next";

/** Lets phones install ZM to the home screen and open it without browser UI */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ZM",
    short_name: "ZM",
    description: "Personal budget manager",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
