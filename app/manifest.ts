import type { MetadataRoute } from "next"

// Served at /manifest.webmanifest — makes the app installable (Add to Home
// Screen) so it opens fullscreen like a native reading app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "My Library",
    short_name: "Library",
    description: "Your personal reading space — books, notes, and words.",
    start_url: "/library",
    display: "standalone",
    background_color: "#f4f1ea",
    theme_color: "#f4f1ea",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // Full-bleed background → safe for maskable (rounded/squircle) crops
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
