import type { Metadata, Viewport } from "next"
import "./globals.css"
import RegisterSW from "./register-sw"
import { THEME_INIT_SCRIPT } from "./lib/theme"

export const metadata: Metadata = {
  title: "My Book Reader",
  appleWebApp: {
    capable: true,            // fullscreen when launched from iOS home screen
    title: "My Library",
    statusBarStyle: "default",
  },
}

export const viewport: Viewport = {
  themeColor: "#f4f1ea",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // suppressHydrationWarning: data-theme is set by the pre-paint script
    // below, so the server-rendered <html> attribute intentionally differs.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking on purpose — sets data-theme from localStorage before
            first paint so dark mode never flashes sepia. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <RegisterSW />
        {children}
      </body>
    </html>
  )
}
