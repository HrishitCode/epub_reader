"use client"

import { useSearchParams, useRouter } from 'next/navigation'
import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { ReactReader, ReactReaderStyle } from 'react-reader'
import { updateProgress, getProgress, upsertWordLookup, saveHighlight } from '../lib/supabase/queries'
import { getUserId } from '../lib/supabase/queries'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rendition = any

// ── Themes ───────────────────────────────────────────────────────────────────
type Theme = "sepia" | "dark"

const THEMES = {
  sepia: {
    bg:          "#f4f1ea",
    text:        "#3d2b1f",
    barBg:       "#ece8df",
    barBorder:   "#d4cfc6",
    arrow:       "#a89880",
    mutedText:   "#7a6652",
    popoverBg:   "#fffdf8",
    epubBg:      "#f4f1ea",
    epubText:    "#3d2b1f",
    epubLink:    "#7a6652",
  },
  dark: {
    bg:          "#1c1c1e",
    text:        "#e8e0d0",
    barBg:       "#2c2c2e",
    barBorder:   "#3c3c3e",
    arrow:       "#a89880",
    mutedText:   "#9a9080",
    popoverBg:   "#2c2c2e",
    epubBg:      "#1c1c1e",
    epubText:    "#e8e0d0",
    epubLink:    "#a89880",
  },
}

// ── CSS injected into the epub iframe ────────────────────────────────────────
function buildEpubCss(pageHeightPx: number, pageWidthPx: number, t: typeof THEMES.sepia) {
  const safeHeight    = Math.floor(pageHeightPx * 0.97)
  const effectiveWidth = pageWidthPx * 0.8
  const maxH1Px       = Math.floor(effectiveWidth / (10 * 0.55))
  const clampedH1     = Math.min(maxH1Px, 48)

  return `
    html, body {
      background: ${t.epubBg} !important;
      color: ${t.epubText} !important;
    }
    a { color: ${t.epubLink}; }
    h1, h2, h3, h4, h5, h6 { break-inside: avoid; page-break-inside: avoid; }
    h1 {
      font-size: ${clampedH1}px !important;
      letter-spacing: 0.04em !important;
      word-spacing: 0.1em !important;
      line-height: 1.4 !important;
    }
    img, svg {
      max-width: 100% !important;
      object-fit: contain;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    figure, .cover, [class*="cover"], [id*="cover"] {
      break-inside: avoid;
      page-break-inside: avoid;
      overflow: hidden;
    }
    img, svg, figure, .cover, [class*="cover"], [id*="cover"] {
      max-height: ${safeHeight}px !important;
    }
  `
}

// ── Dictionary ────────────────────────────────────────────────────────────────
type DictEntry = {
  word: string
  phonetic?: string
  meanings: { partOfSpeech: string; definitions: { definition: string }[] }[]
}

const DICT_CACHE_PREFIX = "dict_v1_"

async function fetchDefinition(word: string): Promise<DictEntry | null> {
  const cacheKey = DICT_CACHE_PREFIX + word.toLowerCase()
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) return JSON.parse(cached) as DictEntry
  } catch { /* private mode */ }

  try {
    const res = await fetch(`/api/define?word=${encodeURIComponent(word)}`)
    if (!res.ok) return null
    const entry: DictEntry | null = await res.json()
    if (entry) {
      try { localStorage.setItem(cacheKey, JSON.stringify(entry)) } catch { /* storage full */ }
    }
    return entry
  } catch { return null }
}

// ── Selection action bar ──────────────────────────────────────────────────────
function SelectionBar({ text, onDefine, onSave, onNote, onCopy, onDismiss }: {
  text: string
  onDefine: () => void
  onSave: () => void
  onNote: () => void
  onCopy: () => void
  onDismiss: () => void
}) {
  return (
    <div style={{
      position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
      zIndex: 9998, display: "flex", alignItems: "center", gap: 0,
      background: "#2d2017", borderRadius: 10,
      boxShadow: "0 4px 20px rgba(0,0,0,0.35)", overflow: "hidden",
    }}>
      <span style={{
        padding: "10px 14px", fontSize: "0.8rem", color: "#c4ab8e",
        fontFamily: "Georgia, serif", maxWidth: 120,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        borderRight: "1px solid #4a3520",
      }}>"{text}"</span>
      <button onClick={onDefine} style={barBtn}>📖 Define</button>
      <button onClick={onSave}   style={{ ...barBtn, borderLeft: "1px solid #4a3520" }}>🔖 Save</button>
      <button onClick={onNote}   style={{ ...barBtn, borderLeft: "1px solid #4a3520" }}>✏️ Note</button>
      <button onClick={onCopy}   style={{ ...barBtn, borderLeft: "1px solid #4a3520" }}>Copy</button>
      <button onClick={onDismiss} style={{ ...barBtn, borderLeft: "1px solid #4a3520", color: "#c4ab8e" }}>✕</button>
    </div>
  )
}

const barBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: "10px 12px", fontSize: "0.82rem", color: "#f4f1ea",
  fontFamily: "Georgia, serif", whiteSpace: "nowrap",
}

// ── Note modal ────────────────────────────────────────────────────────────────
function NoteModal({ text, theme, onSave, onCancel }: {
  text: string
  theme: typeof THEMES.sepia
  onSave: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState("")
  return (
    <div onClick={onCancel} style={{
      position: "fixed", inset: 0, zIndex: 10000,
      background: "rgba(0,0,0,0.35)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      padding: "0 0 24px",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: theme.popoverBg, border: `1px solid ${theme.barBorder}`,
        borderRadius: 14, padding: "20px 20px 16px", width: "92%", maxWidth: 480,
        boxShadow: "0 8px 32px rgba(0,0,0,0.25)", fontFamily: "Georgia, serif",
      }}>
        {/* Selected passage */}
        <p style={{
          margin: "0 0 14px", fontSize: "0.88rem", color: theme.arrow,
          fontStyle: "italic", lineHeight: 1.6,
          borderLeft: `3px solid ${theme.arrow}`, paddingLeft: 12,
        }}>
          "{text}"
        </p>

        {/* Note input */}
        <textarea
          autoFocus
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Write your note…"
          rows={4}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "10px 12px", fontSize: "0.92rem",
            border: `1px solid ${theme.barBorder}`, borderRadius: 8,
            background: theme.bg, color: theme.text,
            fontFamily: "Georgia, serif", resize: "none", outline: "none",
            lineHeight: 1.6,
          }}
        />

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, marginTop: 12, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            background: "none", border: `1px solid ${theme.barBorder}`,
            borderRadius: 8, padding: "8px 18px", cursor: "pointer",
            color: theme.mutedText, fontFamily: "Georgia, serif", fontSize: "0.88rem",
          }}>Cancel</button>
          <button onClick={() => onSave(note)} style={{
            background: "#3d2b1f", border: "none", borderRadius: 8,
            padding: "8px 18px", cursor: "pointer",
            color: "#f4f1ea", fontFamily: "Georgia, serif", fontSize: "0.88rem",
          }}>Save note</button>
        </div>
      </div>
    </div>
  )
}

// ── Definition popover ────────────────────────────────────────────────────────
function DefinitionPopover({ entry, onClose, theme }: {
  entry: DictEntry | "loading" | "not-found"; onClose: () => void; theme: typeof THEMES.sepia
}) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
      padding: "0 0 24px", background: "rgba(0,0,0,0.25)",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: theme.popoverBg, border: `1px solid ${theme.barBorder}`,
        borderRadius: 12, padding: "20px 24px", maxWidth: 420, width: "90%",
        maxHeight: "50vh", overflowY: "auto",
        boxShadow: "0 8px 32px rgba(0,0,0,0.28)", fontFamily: "Georgia, serif",
      }}>
        {entry === "loading" && <p style={{ color: theme.arrow, fontSize: "0.95rem" }}>Looking up…</p>}
        {entry === "not-found" && <>
          <p style={{ color: theme.text, fontWeight: "bold", marginBottom: 4 }}>Not found</p>
          <p style={{ color: theme.arrow, fontSize: "0.9rem" }}>No dictionary entry for this word.</p>
        </>}
        {entry !== "loading" && entry !== "not-found" && <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: theme.text }}>{entry.word}</span>
            {entry.phonetic && <span style={{ fontSize: "0.85rem", color: theme.arrow }}>{entry.phonetic}</span>}
            <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none",
              cursor: "pointer", color: theme.arrow, fontSize: "1.1rem" }}>✕</button>
          </div>
          {entry.meanings.slice(0, 2).map((m, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <span style={{ fontSize: "0.75rem", color: "#fff", background: "#a89880",
                borderRadius: 4, padding: "2px 6px", marginBottom: 4, display: "inline-block" }}>
                {m.partOfSpeech}
              </span>
              <ol style={{ margin: "6px 0 0 16px", padding: 0 }}>
                {m.definitions.slice(0, 2).map((d, j) => (
                  <li key={j} style={{ fontSize: "0.9rem", color: theme.text, lineHeight: 1.6, marginBottom: 4 }}>
                    {d.definition}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </>}
      </div>
    </div>
  )
}

// ── Main Reader ───────────────────────────────────────────────────────────────
function Reader() {
  const searchParams = useSearchParams()
  const router       = useRouter()
  const bookUrl      = searchParams.get("bookUrl")
  const bookIdParam  = searchParams.get("bookId")
  const bookId       = bookIdParam ? parseInt(bookIdParam, 10) : null

  // ── Theme — persisted to localStorage ──────────────────────────────────────
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem("reader_theme") as Theme) ?? "sepia" }
    catch { return "sepia" }
  })
  const t = THEMES[theme]

  const toggleTheme = () => {
    const next: Theme = theme === "sepia" ? "dark" : "sepia"
    setTheme(next)
    try { localStorage.setItem("reader_theme", next) } catch { /* ignore */ }
    // Re-inject CSS into the iframe with new colours
    if (renditionRef.current) renditionRef.current.themes.override("color", t.epubText)
  }

  // ── Progress — localStorage (fast) + Supabase (cross-device) ───────────────
  const progressKey  = bookUrl  ? `progress_${bookUrl}` : null
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Start with 0; we'll update from localStorage/Supabase in a useEffect
  const [location, setLocation] = useState<string | number>(0)
  const [locationReady, setLocationReady] = useState(false)

  // ── Other state ─────────────────────────────────────────────────────────────
  const [bookData,     setBookData]     = useState<ArrayBuffer | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [page,         setPage]         = useState("")
  const [fullscreen,   setFullscreen]   = useState(false)
  const [popover,      setPopover]      = useState<DictEntry | "loading" | "not-found" | null>(null)
  const [selectedText, setSelectedText] = useState<string | null>(null)
  const [noteMode,     setNoteMode]     = useState(false)  // NoteModal open

  const renditionRef   = useRef<Rendition | null>(null)
  const containerRef   = useRef<HTMLDivElement>(null)
  const userIdRef      = useRef<string | null>(null)

  // Fetch userId once on mount — needed for word lookup saving
  useEffect(() => { getUserId().then(id => { userIdRef.current = id }).catch(() => {}) }, [])

  // ── Load saved progress ─────────────────────────────────────────────────────
  useEffect(() => {
    async function loadProgress() {
      // 1. localStorage first — instant, works offline
      let saved: string | number = 0
      if (progressKey) {
        try { saved = localStorage.getItem(progressKey) ?? 0 } catch { /* ignore */ }
      }
      // 2. Supabase — may have more recent progress from another device
      if (bookId) {
        const remote = await getProgress(bookId)
        if (remote) saved = remote   // remote wins (most recently synced)
      }
      setLocation(saved)
      setLocationReady(true)
    }
    loadProgress()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, progressKey])

  // ── Fetch epub ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!bookUrl) { router.push("/library"); return }
    fetch(bookUrl)
      .then(res => res.arrayBuffer())
      .then(data => { setBookData(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [bookUrl, router])

  // ── Sync browser fullscreenchange → React state (handles Escape key) ────────
  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  // ── Fullscreen toggle — uses native API so browser chrome hides on mobile ───
  const toggleFullscreen = async () => {
    if (!fullscreen) {
      try { await containerRef.current?.requestFullscreen() } catch { /* not supported */ }
      setFullscreen(true)
    } else {
      try { if (document.fullscreenElement) await document.exitFullscreen() } catch { /* ignore */ }
      setFullscreen(false)
    }
  }

  // ── Rendition callback ──────────────────────────────────────────────────────
  const getRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition

    rendition.hooks.content.register((contents: any) => {
      const doc = contents.document
      if (!doc) return

      // Inject theme CSS using real container dimensions
      const container   = rendition.manager?.container
      const pageH: number = container?.clientHeight ?? window.innerHeight
      const pageW: number = container?.clientWidth  ?? window.innerWidth
      const existing = doc.getElementById("reader-theme")
      if (existing) existing.remove()
      const style = doc.createElement("style")
      style.id = "reader-theme"
      style.innerHTML = buildEpubCss(pageH, pageW, THEMES[
        (() => { try { return (localStorage.getItem("reader_theme") as Theme) ?? "sepia" } catch { return "sepia" as Theme } })()
      ])
      doc.head.appendChild(style)

      // Selection → action bar
      let debounceTimer: ReturnType<typeof setTimeout>
      doc.addEventListener("selectionchange", () => {
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          const sel  = contents.window.getSelection()
          const text = sel?.toString().trim() ?? ""
          setSelectedText(text.length > 0 ? text : null)
        }, 300)
      })
    })

    rendition.on("relocated", (loc: any) => {
      const { displayed } = loc.start
      setPage(`${displayed.page} / ${displayed.total}`)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Save progress handler ───────────────────────────────────────────────────
  const handleLocationChanged = (epubcfi: string) => {
    setLocation(epubcfi)
    // localStorage — immediate
    if (progressKey) {
      try { localStorage.setItem(progressKey, epubcfi) } catch { /* ignore */ }
    }
    // Supabase — debounced (don't hammer DB on every swipe)
    if (bookId) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => updateProgress(bookId, epubcfi), 2000)
    }
  }

  // ── Re-inject CSS when theme changes ────────────────────────────────────────
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return
    // Force a re-render of the current page so the hook fires again with new colours
    rendition.views().forEach((view: any) => {
      try {
        const doc = view.document
        if (!doc) return
        const existing = doc.getElementById("reader-theme")
        if (existing) existing.remove()
        const style = doc.createElement("style")
        style.id = "reader-theme"
        const container = rendition.manager?.container
        const pageH: number = container?.clientHeight ?? window.innerHeight
        const pageW: number = container?.clientWidth  ?? window.innerWidth
        style.innerHTML = buildEpubCss(pageH, pageW, THEMES[theme])
        doc.head.appendChild(style)
      } catch { /* ignore */ }
    })
  }, [theme])

  // ── Derived styles ──────────────────────────────────────────────────────────
  const readerStyles = {
    ...ReactReaderStyle,
    readerArea:  { ...ReactReaderStyle.readerArea,  backgroundColor: t.bg },
    arrow:       { ...ReactReaderStyle.arrow,       color: t.arrow, zIndex: 201 },
    arrowHover:  { color: t.text },
    tocBackground: t.barBg,
  }

  // ── Render: loading / error states ──────────────────────────────────────────
  if (loading || !locationReady) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: t.bg }}>
        <p style={{ color: t.arrow, fontFamily: "Georgia, serif", fontSize: "1.1rem" }}>
          Opening book…
        </p>
      </div>
    )
  }

  if (!bookData) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: "100vh", gap: 16, background: t.bg }}>
        <p style={{ color: t.text, fontFamily: "Georgia, serif" }}>Could not load book.</p>
        <button onClick={() => router.push("/library")}
          style={{ color: t.text, textDecoration: "underline", background: "none",
            border: "none", cursor: "pointer", fontFamily: "Georgia, serif" }}>
          ← Back to library
        </button>
      </div>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    // containerRef is the fullscreen target — the entire reader, not just the epub area
    <div ref={containerRef} style={{
      height: "100svh", display: "flex", flexDirection: "column", background: t.bg,
    }}>

      {/* Top bar — hidden in fullscreen */}
      {!fullscreen && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 20px", background: t.barBg,
          borderBottom: `1px solid ${t.barBorder}`, flexShrink: 0,
        }}>
          <button onClick={() => router.push("/library")}
            style={{ fontFamily: "Georgia, serif", fontSize: "0.85rem",
              color: t.mutedText, background: "none", border: "none", cursor: "pointer" }}>
            ← Library
          </button>

          {page && (
            <span style={{ fontFamily: "Georgia, serif", fontSize: "0.8rem", color: t.mutedText }}>
              {page}
            </span>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {/* Dark / sepia toggle */}
            <button onClick={toggleTheme} title={theme === "sepia" ? "Switch to dark mode" : "Switch to sepia mode"}
              style={{ background: "none", border: "none", cursor: "pointer",
                fontSize: "1.1rem", lineHeight: 1, padding: "2px 4px" }}>
              {theme === "sepia" ? "🌙" : "☀️"}
            </button>
            {/* Fullscreen */}
            <button onClick={toggleFullscreen} title="Full screen"
              style={{ background: "none", border: "none", cursor: "pointer",
                color: t.mutedText, fontSize: "1.1rem", lineHeight: 1, padding: "2px 4px" }}>
              ⛶
            </button>
          </div>
        </div>
      )}

      {/* Floating exit-fullscreen button */}
      {fullscreen && (
        <button onClick={toggleFullscreen} title="Exit full screen"
          style={{
            position: "fixed", top: 12, right: 14, zIndex: 300,
            background: "rgba(61,43,31,0.6)", color: "#f4f1ea",
            border: "none", borderRadius: 8, cursor: "pointer",
            fontSize: "1rem", padding: "6px 10px", lineHeight: 1,
            backdropFilter: "blur(4px)",
          }}>
          ✕
        </button>
      )}

      {/* Reader */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <ReactReader
          url={bookData as unknown as string}
          location={location}
          locationChanged={handleLocationChanged}
          getRendition={getRendition}
          readerStyles={readerStyles}
          epubOptions={{ allowScriptedContent: true, replacements: "none" }}
        />
      </div>

      {/* Selection bar */}
      {selectedText && !popover && !noteMode && (
        <SelectionBar
          text={selectedText}
          onDefine={async () => {
            const word = selectedText.trim().split(/\s+/)[0].replace(/[^a-zA-Z'-]/g, "")
            setSelectedText(null)
            setPopover("loading")
            const entry = await fetchDefinition(word)
            setPopover(entry ?? "not-found")
            if (entry && bookId && userIdRef.current) {
              upsertWordLookup(userIdRef.current, bookId, word, entry).catch(() => {})
            }
          }}
          onSave={() => {
            if (bookId && userIdRef.current) {
              saveHighlight(userIdRef.current, bookId, selectedText).catch(() => {})
            }
            setSelectedText(null)
          }}
          onNote={() => setNoteMode(true)}
          onCopy={() => { navigator.clipboard.writeText(selectedText).catch(() => {}); setSelectedText(null) }}
          onDismiss={() => setSelectedText(null)}
        />
      )}

      {/* Note modal */}
      {noteMode && selectedText && (
        <NoteModal
          text={selectedText}
          theme={t}
          onSave={(note) => {
            if (bookId && userIdRef.current) {
              saveHighlight(userIdRef.current, bookId, selectedText, note).catch(() => {})
            }
            setNoteMode(false)
            setSelectedText(null)
          }}
          onCancel={() => setNoteMode(false)}
        />
      )}

      {/* Definition popover */}
      {popover && <DefinitionPopover entry={popover} onClose={() => setPopover(null)} theme={t} />}

    </div>
  )
}

export default function ReaderPage() {
  return (
    <Suspense fallback={
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: THEMES.sepia.bg }}>
        <p style={{ color: THEMES.sepia.arrow, fontFamily: "Georgia, serif", fontSize: "1.1rem" }}>
          Opening book…
        </p>
      </div>
    }>
      <Reader />
    </Suspense>
  )
}
