// Shared app-wide theme (library + notebook).
//
// Colours live as CSS variables in globals.css, switched by the `data-theme`
// attribute on <html>. A blocking script in layout.tsx sets that attribute
// from localStorage BEFORE first paint, so every page — hard load or client
// navigation — renders in the right theme on its first frame (no flash).
//
// Components use PALETTE below: the same `var(...)` strings regardless of
// theme, so server HTML and client render always match (no hydration errors).
//
// The reader (home/page.tsx) keeps its own hex palette because it injects
// real colour values into the epub iframe, which can't see our CSS variables.
export type Theme = "sepia" | "dark"

export const THEME_STORAGE_KEY = "reader_theme"

// Token → CSS variable. Identical output for both themes; the browser
// resolves the actual colour from html[data-theme] at paint time.
export const PALETTE = {
  bg:           "var(--bg)",
  card:         "var(--card)",
  surface:      "var(--surface)",
  border:       "var(--border)",
  text:         "var(--text)",
  muted:        "var(--muted)",
  faint:        "var(--faint)",
  primaryBg:    "var(--primary-bg)",
  primaryText:  "var(--primary-text)",
  coverBg:      "var(--cover-bg)",
  danger:       "var(--danger)",
  dangerBorder: "var(--danger-border)",
} as const

export type ThemePalette = typeof PALETTE

export function readTheme(): Theme {
  try { return (localStorage.getItem(THEME_STORAGE_KEY) as Theme) ?? "sepia" }
  catch { return "sepia" }
}

// Flip the live theme: update <html data-theme> (CSS repaints instantly)
// and persist the choice for the pre-paint script on future loads.
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* ignore */ }
}

// Runs in a blocking <script> before first paint — keep it tiny and inline-safe.
export const THEME_INIT_SCRIPT =
  `try{document.documentElement.dataset.theme=localStorage.getItem("${THEME_STORAGE_KEY}")==="dark"?"dark":"sepia"}catch(e){}`
