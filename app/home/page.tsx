"use client"

import { useSearchParams, useRouter } from 'next/navigation'
import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { ReactReader, ReactReaderStyle } from 'react-reader'
import { updateProgress, getProgress, getBookStartIndex, upsertWordLookup, saveHighlight, getBookHighlightCfis } from '../lib/supabase/queries'
import { getUserId } from '../lib/supabase/queries'

// SVG styles for the in-book highlight overlay (epub.js annotations layer)
const HIGHLIGHT_STYLE = { fill: "#e9b44c", "fill-opacity": "0.3", "mix-blend-mode": "multiply" }

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
      /* padding-bottom stops epub.js clipping the last line when column height
         has subpixel rounding error or safe-area insets are involved */
      padding-bottom: 1.8em !important;
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
  phonetics?: { text?: string; audio?: string }[]
  meanings: { partOfSpeech: string; definitions: { definition: string }[] }[]
}

// First phonetic entry with a non-empty audio URL. The API sometimes returns
// protocol-relative URLs ("//ssl.gstatic.com/…") — normalise to https.
function audioUrl(entry: DictEntry): string | null {
  const raw = entry.phonetics?.find(p => p.audio && p.audio.length > 0)?.audio
  if (!raw) return null
  return raw.startsWith("//") ? `https:${raw}` : raw
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
            {audioUrl(entry) && (
              <button
                onClick={() => { new Audio(audioUrl(entry)!).play().catch(() => {}) }}
                title="Play pronunciation"
                style={{ background: "none", border: "none", cursor: "pointer",
                  color: theme.arrow, fontSize: "1rem", padding: 0, lineHeight: 1 }}>
                🔊
              </button>
            )}
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

  // ── Font size — percentage, persisted to localStorage ──────────────────────
  const [fontSize, setFontSize] = useState<number>(() => {
    try { return parseInt(localStorage.getItem("reader_font_size") ?? "100", 10) || 100 }
    catch { return 100 }
  })
  // Ref so getRendition (created once) can read the current value
  const fontSizeRef = useRef(fontSize)

  const changeFontSize = (delta: number) => {
    setFontSize(prev => {
      const next = Math.min(160, Math.max(70, prev + delta))
      fontSizeRef.current = next
      try { localStorage.setItem("reader_font_size", String(next)) } catch { /* ignore */ }
      try { renditionRef.current?.themes.fontSize(`${next}%`) } catch { /* ignore */ }
      return next
    })
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

  // ── Scrubber — drag to seek WITHIN the current chapter ─────────────────────
  // The slider's full width maps to just the current chapter (left = first page,
  // right = last page), matching the per-chapter "page X / N" indicator above.
  //   progressPct: whole-book position 0..1 from the latest relocated event.
  //   chapterRange: {start,end} = the current chapter's whole-book pct bounds.
  //   seekable: true once epub.js has generated locations (cfiFromPercentage works).
  //   scrubValue: 0..1000 (chapter fraction) while dragging; null when idle so the
  //     thumb follows the real position again. Decoupling lets the thumb track the
  //     finger live while the actual page jump is debounced until the drag settles.
  const [progressPct,  setProgressPct]  = useState(0)
  const [seekable,     setSeekable]     = useState(false)
  const [scrubValue,   setScrubValue]   = useState<number | null>(null)
  const [chapterRange, setChapterRange] = useState<{ start: number; end: number } | null>(null)
  const seekTimerRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Map of spine index → {start,end} whole-book pct bounds, built once after
  // locations generate. Ref-mirrored so debounced handlers read the latest.
  const chapterBoundsRef = useRef<Map<number, { start: number; end: number }>>(new Map())
  const chapterRangeRef  = useRef<{ start: number; end: number } | null>(null)
  const currentIndexRef  = useRef<number | null>(null)
  // Set chapter range in state + ref together
  const applyChapterRange = (r: { start: number; end: number } | null) => {
    chapterRangeRef.current = r
    setChapterRange(r)
  }

  const renditionRef   = useRef<Rendition | null>(null)
  const containerRef   = useRef<HTMLDivElement>(null)
  const userIdRef      = useRef<string | null>(null)
  // Always holds the current CFI — resize callbacks can't see the latest
  // `location` state through their closure, so we read it from this ref.
  const locationRef    = useRef<string | number>(0)
  // Whole-book progress 0..1 from the latest relocated event (needs locations)
  const pctRef         = useRef<number | null>(null)
  // CFI range of the current text selection (from epub.js's "selected" event)
  const selectedCfiRef = useRef<string | null>(null)

  // Fetch userId once on mount — needed for word lookup saving
  useEffect(() => { getUserId().then(id => { userIdRef.current = id }).catch(() => {}) }, [])

  // ── Load saved progress ─────────────────────────────────────────────────────
  useEffect(() => {
    async function loadProgress() {
      // 1. localStorage first — instant, works offline
      let saved: string | number | null = null
      if (progressKey) {
        try { saved = localStorage.getItem(progressKey) } catch { /* ignore */ }
      }
      // 2. Supabase — may have more recent progress from another device
      if (bookId) {
        const remote = await getProgress(bookId)
        if (remote) saved = remote   // remote wins (most recently synced)
      }
      // 3. No saved progress anywhere → open at the detected body start so the
      //    reader skips front matter (cover/praise/copyright/TOC) on first open.
      //    A spine index (number) is a valid epub.js display target.
      let start: string | number = saved ?? 0
      if (saved == null && bookId) {
        start = await getBookStartIndex(bookId)
      }
      setLocation(start)
      locationRef.current = start
      setLocationReady(true)
    }
    loadProgress()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, progressKey])

  // ── Fetch epub ──────────────────────────────────────────────────────────────
  // epub.js opens an ArrayBuffer as an in-memory zip archive. Books that would
  // crash its render pipeline (missing spine files → `new Path(undefined)`) are
  // rejected at upload time by validateEpub(), so anything that reaches here is
  // structurally sound.
  useEffect(() => {
    if (!bookUrl) { router.push("/library"); return }
    fetch(bookUrl)
      .then(res => res.arrayBuffer())
      .then(data => { setBookData(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [bookUrl, router])

  // ── Tell epub.js to re-paginate after any container resize ─────────────────
  // epub.js bakes column layout at init time. Any container size change
  // (fullscreen toggle, orientation, browser bar appearing) needs a resize()
  // call so it re-measures and re-flows the current page cleanly.
  const triggerRenditionResize = useCallback(() => {
    // Two passes: immediate (catches most cases) + 350 ms later (after CSS
    // transitions and browser chrome animations finish)
    // resize() re-measures the container and recalculates the column layout,
    // but it does NOT re-flow content already painted in the current view —
    // that's why the page only looked right again after a fresh chapter loaded.
    // Re-displaying the current location forces epub.js to re-render the visible
    // section against the corrected dimensions.
    const run = () => {
      const rendition = renditionRef.current
      if (!rendition) return
      try { rendition.resize() } catch { /* ignore */ }
      const cfi = locationRef.current
      if (typeof cfi === "string" && cfi.length > 0) {
        try { rendition.display(cfi) } catch { /* ignore */ }
      }
    }
    run()
    setTimeout(run, 350)
  }, [])

  // ── Sync browser fullscreenchange → React state (handles Escape key) ────────
  useEffect(() => {
    const handler = () => {
      setFullscreen(!!document.fullscreenElement)
      triggerRenditionResize()
    }
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [triggerRenditionResize])

  // ── ResizeObserver — catches fullscreen, orientation, browser-bar changes ───
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => triggerRenditionResize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [triggerRenditionResize])

  // ── Fullscreen toggle — uses native API so browser chrome hides on mobile ───
  const toggleFullscreen = async () => {
    if (!fullscreen) {
      try { await containerRef.current?.requestFullscreen() } catch { /* not supported */ }
      setFullscreen(true)
    } else {
      try { if (document.fullscreenElement) await document.exitFullscreen() } catch { /* ignore */ }
      setFullscreen(false)
    }
    // resize fires via ResizeObserver + fullscreenchange listener above
  }

  // ── Rendition callback ──────────────────────────────────────────────────────
  const getRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition

    // Apply the persisted font size before the first page paints
    try { rendition.themes.fontSize(`${fontSizeRef.current}%`) } catch { /* ignore */ }

    // Track the CFI range of the current selection — epub.js emits "selected"
    // (debounced) whenever text is selected inside the iframe. Saved alongside
    // the highlight so it can be repainted in-book on future opens.
    rendition.on("selected", (cfiRange: string) => { selectedCfiRef.current = cfiRange })

    // Repaint this book's saved highlights. annotations.highlight() registers
    // the CFI on the annotations layer, so epub.js paints it whenever the
    // containing section renders — safe to call before first display.
    if (bookId) {
      getUserId()
        .then(uid => getBookHighlightCfis(uid, bookId))
        .then(cfis => {
          for (const cfi of cfis) {
            try { rendition.annotations.highlight(cfi, {}, undefined, "hl", HIGHLIGHT_STYLE) }
            catch { /* stale CFI from an older epub copy — skip */ }
          }
        })
        .catch(() => {})
    }

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
          if (text.length === 0) selectedCfiRef.current = null
          setSelectedText(text.length > 0 ? text : null)
        }, 300)
      })
    })

    // Generate locations so relocated events carry a whole-book percentage
    // (without this, loc.start.percentage is always 0). Runs async in the
    // background; progress saves just omit pct until it's ready.
    rendition.book?.ready
      ?.then(() => rendition.book.locations.generate(1000))
      .then(() => {
        // Locations are ready → cfiFromPercentage() now works, so the scrubber
        // can seek. Seed the thumb from the current page so it doesn't sit at 0.
        setSeekable(true)
        try {
          const cfi = locationRef.current
          if (typeof cfi === "string" && cfi.length > 0) {
            const p = rendition.book.locations.percentageFromCfi(cfi)
            if (typeof p === "number" && p > 0) setProgressPct(p)
          }
        } catch { /* ignore */ }

        // Build per-chapter (spine section) percentage bounds. Locations are
        // uniform by character count, so location index i sits at pct i/(len-1);
        // we just need the min/max location index that falls in each section.
        // book.spine.get(cfi) resolves a CFI to its Section (and .index).
        try {
          const locations = rendition.book.locations
          const len: number = locations.length?.() ?? 0
          if (len > 1) {
            const minMax = new Map<number, { min: number; max: number }>()
            for (let i = 0; i < len; i++) {
              const locCfi = locations.cfiFromLocation(i)
              if (typeof locCfi !== "string") continue
              let sp: number | undefined
              try { sp = rendition.book.spine.get(locCfi)?.index } catch { sp = undefined }
              if (sp == null) continue
              const mm = minMax.get(sp)
              if (!mm) minMax.set(sp, { min: i, max: i })
              else mm.max = i
            }
            const bounds = new Map<number, { start: number; end: number }>()
            minMax.forEach((mm, sp) => {
              bounds.set(sp, { start: mm.min / (len - 1), end: Math.min(1, mm.max / (len - 1)) })
            })
            chapterBoundsRef.current = bounds
            // Seed the current chapter's range now (relocated may have already
            // fired before the map existed).
            const idx = currentIndexRef.current
            if (idx != null) applyChapterRange(bounds.get(idx) ?? null)
          }
        } catch { /* per-chapter scoping unavailable — slider stays disabled */ }
      })
      .catch(() => { /* percentage stays unavailable for this book */ })

    rendition.on("relocated", (loc: any) => {
      const { displayed } = loc.start
      setPage(`${displayed.page} / ${displayed.total}`)
      const pct = loc.start.percentage
      // Keep the scrubber in sync with wherever we actually landed — including
      // chapter jumps from the TOC. (pctRef keeps the >0 guard so a spurious 0
      // never overwrites saved progress, but the visible bar tracks every move.)
      if (typeof pct === "number") {
        if (pct > 0) pctRef.current = pct
        setProgressPct(pct)
      }
      // Re-scope the slider to the chapter we're now in.
      const idx: number | null = typeof loc.start.index === "number" ? loc.start.index : null
      currentIndexRef.current = idx
      if (idx != null && chapterBoundsRef.current.size > 0) {
        applyChapterRange(chapterBoundsRef.current.get(idx) ?? null)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Save progress handler ───────────────────────────────────────────────────
  const handleLocationChanged = (epubcfi: string) => {
    // A navigation just landed (page turn, scrub seek, or a chapter picked from
    // the TOC). Kill any pending scrub seek so it can't fire afterwards and yank
    // us back to the dragged spot, and drop the drag override so the scrubber
    // snaps to the real position instead of freezing where it was dragged.
    if (seekTimerRef.current) { clearTimeout(seekTimerRef.current); seekTimerRef.current = null }
    setScrubValue(null)
    setLocation(epubcfi)
    locationRef.current = epubcfi
    // localStorage — immediate
    if (progressKey) {
      try { localStorage.setItem(progressKey, epubcfi) } catch { /* ignore */ }
    }
    // Supabase — debounced (don't hammer DB on every swipe)
    if (bookId) {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(
        () => updateProgress(bookId, epubcfi, pctRef.current ?? undefined), 2000)
    }
  }

  // ── Scrubber seek ───────────────────────────────────────────────────────────
  // value is 0..1000 = fraction THROUGH THE CURRENT CHAPTER. We map it into the
  // chapter's whole-book pct bounds, then cfiFromPercentage → a CFI. We seek by
  // driving the SAME controlled `location` prop react-reader uses for the TOC and
  // page arrows — NOT rendition.display() directly — so a later TOC pick can't be
  // fought by a stale direct display. Returns the whole-book pct it sought to.
  const seekTo = (value: number): number | null => {
    const locations = renditionRef.current?.book?.locations
    const range = chapterRangeRef.current
    if (!locations || !range || range.end <= range.start) return null
    try {
      const pct = range.start + (value / 1000) * (range.end - range.start)
      const cfi = locations.cfiFromPercentage(pct)
      if (cfi) { setLocation(cfi); locationRef.current = cfi; return pct }
    } catch { /* ignore */ }
    return null
  }

  // Fired on every slider change (pointer drag or keyboard). The thumb follows
  // `value` immediately; the actual jump is debounced so we only navigate once
  // the drag settles, then we clear scrubValue so the thumb tracks the real page.
  const handleScrub = (value: number) => {
    setScrubValue(value)
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current)
    seekTimerRef.current = setTimeout(() => {
      seekTimerRef.current = null
      const pct = seekTo(value)
      if (pct != null) setProgressPct(pct)  // optimistic — relocated confirms shortly
      setScrubValue(null)
    }, 140)
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
    tocBackground: { background: t.barBg } as React.CSSProperties,
  }

  // ── Scrubber position (scoped to the current chapter) ───────────────────────
  // The slider spans only the current chapter: 0 = first page, 1000 = last page.
  // chapterFrac maps the whole-book progressPct into that local 0..1 window.
  const chapterSpan  = chapterRange ? chapterRange.end - chapterRange.start : 0
  const canScrub     = seekable && chapterSpan > 0
  const chapterFrac  = canScrub
    ? Math.min(1, Math.max(0, (progressPct - chapterRange!.start) / chapterSpan))
    : 0
  const sliderValue  = Math.round(scrubValue ?? chapterFrac * 1000)

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
    // containerRef is the fullscreen target — the entire reader, not just the epub area.
    // In fullscreen: position:fixed + inset:0 is the only reliable way to cover the full
    // screen on mobile (100svh still leaves browser chrome visible on iOS/Android).
    <div ref={containerRef} style={{
      ...(fullscreen
        ? { position: "fixed", inset: 0, zIndex: 999 }
        : { height: "100svh" }
      ),
      display: "flex", flexDirection: "column", background: t.bg,
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
            {/* Font size — clamped 70–160% in steps of 10 */}
            <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
              <button onClick={() => changeFontSize(-10)} disabled={fontSize <= 70}
                title="Smaller text" aria-label="Decrease font size"
                style={{ background: "none", border: "none", cursor: "pointer",
                  color: t.mutedText, fontFamily: "Georgia, serif",
                  fontSize: "0.8rem", lineHeight: 1, padding: "2px 4px",
                  opacity: fontSize <= 70 ? 0.4 : 1 }}>
                A−
              </button>
              <button onClick={() => changeFontSize(10)} disabled={fontSize >= 160}
                title="Larger text" aria-label="Increase font size"
                style={{ background: "none", border: "none", cursor: "pointer",
                  color: t.mutedText, fontFamily: "Georgia, serif",
                  fontSize: "1.05rem", lineHeight: 1, padding: "2px 4px",
                  opacity: fontSize >= 160 ? 0.4 : 1 }}>
                A+
              </button>
            </div>
            {/* Go to very beginning — front matter is skipped on first open but
                never hidden; this jumps back to the cover/title page. */}
            <button onClick={() => { try { renditionRef.current?.display(0) } catch { /* ignore */ } }}
              title="Go to beginning"
              style={{ background: "none", border: "none", cursor: "pointer",
                color: t.mutedText, fontSize: "1.1rem", lineHeight: 1, padding: "2px 4px" }}>
              ⤴
            </button>
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
          // allowScriptedContent MUST stay false: epubs are user-uploaded zips of
          // HTML, and catalog books are shared across users — a <script> inside
          // one would run with access to the app origin (incl. the Supabase
          // session in localStorage). Keep the iframe sandbox script-free.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          epubOptions={{ allowScriptedContent: false, replacements: "none" } as any}
        />
      </div>

      {/* ── Scrubber — drag through the current chapter (left=first, right=last) ── */}
      <div style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 12,
        padding: "8px 20px", background: t.barBg, borderTop: `1px solid ${t.barBorder}`,
      }}>
        <input
          type="range"
          min={0}
          max={1000}
          value={sliderValue}
          onChange={e => handleScrub(parseInt(e.target.value, 10))}
          disabled={!canScrub}
          aria-label="Seek through the current chapter"
          style={{
            flex: 1, accentColor: t.arrow,
            cursor: canScrub ? "pointer" : "default",
            opacity: canScrub ? 1 : 0.5,
          }}
        />
        <span style={{
          fontFamily: "Georgia, serif", fontSize: "0.75rem", color: t.mutedText,
          whiteSpace: "nowrap", minWidth: 104, textAlign: "right",
        }}>
          {!seekable
            ? "Preparing pages…"
            : page
              ? <>p. {page}</>
              : `${Math.round(sliderValue / 10)}% of chapter`}
        </span>
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
              const cfi = selectedCfiRef.current ?? undefined
              saveHighlight(userIdRef.current, bookId, selectedText, undefined, cfi).catch(() => {})
              // Paint it right away so the saved passage is visibly marked
              if (cfi) {
                try { renditionRef.current?.annotations.highlight(cfi, {}, undefined, "hl", HIGHLIGHT_STYLE) }
                catch { /* ignore */ }
              }
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
              const cfi = selectedCfiRef.current ?? undefined
              saveHighlight(userIdRef.current, bookId, selectedText, note, cfi).catch(() => {})
              if (cfi) {
                try { renditionRef.current?.annotations.highlight(cfi, {}, undefined, "hl", HIGHLIGHT_STYLE) }
                catch { /* ignore */ }
              }
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
