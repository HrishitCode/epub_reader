"use client"

import { useSearchParams, useRouter } from 'next/navigation'
import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ReactReader, ReactReaderStyle } from 'react-reader'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rendition = any

const SEPIA_BG    = "#f4f1ea"
const SEPIA_TEXT  = "#3d2b1f"
const SEPIA_ARROW = "#a89880"

const KINDLE_CSS = `
  html, body {
    background: ${SEPIA_BG} !important;
    color: ${SEPIA_TEXT} !important;
  }
  a { color: #7a6652; }

  /* Prevent epub.js columns from splitting headings across pages */
  h1, h2, h3, h4, h5, h6 {
    break-inside: avoid;
    page-break-inside: avoid;
  }
`

// ── Dictionary API types ─────────────────────────────────────────────────────
type DictEntry = {
  word: string
  phonetic?: string
  meanings: {
    partOfSpeech: string
    definitions: { definition: string }[]
  }[]
}

const DICT_CACHE_PREFIX = "dict_v1_"

async function fetchDefinition(word: string): Promise<DictEntry | null> {
  const cacheKey = DICT_CACHE_PREFIX + word.toLowerCase()

  // 1. Check localStorage first — works offline too
  try {
    const cached = localStorage.getItem(cacheKey)
    if (cached) return JSON.parse(cached) as DictEntry
  } catch { /* localStorage blocked (private mode etc.) — just continue */ }

  // 2. Not cached — hit the API
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
    )
    if (!res.ok) return null
    const data: DictEntry[] = await res.json()
    const entry = data[0] ?? null

    // 3. Save to cache for next time
    if (entry) {
      try { localStorage.setItem(cacheKey, JSON.stringify(entry)) } catch { /* storage full */ }
    }
    return entry
  } catch {
    return null   // network error and nothing cached → return null
  }
}

// ── Background dictionary pre-caching ────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Epub = require("epubjs").default ?? require("epubjs")

// Extract every unique lowercase word from the epub
async function extractWords(buffer: ArrayBuffer): Promise<string[]> {
  const book = Epub(buffer as any)
  await book.ready
  await book.locations.generate(1000) // ensures spine is loaded

  const wordSet = new Set<string>()
  const spine: any[] = []
  book.spine.each((item: any) => spine.push(item))

  for (const item of spine) {
    try {
      const doc: Document = await item.load(book.load.bind(book))
      const text = doc.body?.textContent ?? ""
      const words = text.match(/\b[a-zA-Z]{3,}\b/g) ?? []
      words.forEach(w => wordSet.add(w.toLowerCase()))
    } catch { /* skip unreadable chapters */ }
    finally { item.unload() }
  }

  book.destroy()
  return Array.from(wordSet)
}

// Fetch and cache definitions for a list of words in small batches.
// `onProgress` receives a 0–100 number so the UI can show progress.
async function preCacheDictionary(
  words: string[],
  onProgress: (pct: number) => void,
  signal: AbortSignal
) {
  const BATCH = 5          // parallel requests per tick
  const DELAY = 200        // ms between batches — be polite to the free API

  // Skip words already cached
  const needed = words.filter(w => {
    try { return !localStorage.getItem(DICT_CACHE_PREFIX + w) }
    catch { return true }
  })

  let done = 0
  for (let i = 0; i < needed.length; i += BATCH) {
    if (signal.aborted) return
    const batch = needed.slice(i, i + BATCH)
    await Promise.all(batch.map(w => fetchDefinition(w)))
    done += batch.length
    onProgress(Math.round((done / needed.length) * 100))
    await new Promise(r => setTimeout(r, DELAY))
  }
  onProgress(100)
}

// ── Selection action bar ──────────────────────────────────────────────────────
function SelectionBar({
  text,
  onDefine,
  onCopy,
  onDismiss,
}: {
  text: string
  onDefine: () => void
  onCopy: () => void
  onDismiss: () => void
}) {
  return (
    <div style={{
      position: "fixed", bottom: 80, left: "50%", transform: "translateX(-50%)",
      zIndex: 9998, display: "flex", alignItems: "center", gap: 2,
      background: "#2d2017", borderRadius: 10,
      boxShadow: "0 4px 20px rgba(0,0,0,0.35)",
      overflow: "hidden",
    }}>
      {/* Selected text preview */}
      <span style={{
        padding: "10px 14px", fontSize: "0.8rem", color: "#c4ab8e",
        fontFamily: "Georgia, serif", maxWidth: 140,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        borderRight: "1px solid #4a3520",
      }}>
        "{text}"
      </span>

      <button onClick={onDefine} style={barBtn}>📖 Define</button>

      <button onClick={onCopy} style={{ ...barBtn, borderLeft: "1px solid #4a3520" }}>
        Copy
      </button>

      <button onClick={onDismiss} style={{ ...barBtn, borderLeft: "1px solid #4a3520", color: "#c4ab8e" }}>
        ✕
      </button>
    </div>
  )
}

const barBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer",
  padding: "10px 14px", fontSize: "0.85rem", color: "#f4f1ea",
  fontFamily: "Georgia, serif", whiteSpace: "nowrap",
}

// ── Definition popover component ─────────────────────────────────────────────
function DefinitionPopover({
  entry,
  onClose,
}: {
  entry: DictEntry | "loading" | "not-found"
  onClose: () => void
}) {
  return (
    // Full-screen backdrop — clicking it closes the popover
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        padding: "0 0 24px",
        background: "rgba(0,0,0,0.15)",
      }}
    >
      {/* Card — stop clicks bubbling to backdrop */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fffdf8",
          border: "1px solid #d4cfc6",
          borderRadius: 12,
          padding: "20px 24px",
          maxWidth: 420,
          width: "90%",
          maxHeight: "50vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          fontFamily: "Georgia, serif",
        }}
      >
        {entry === "loading" && (
          <p style={{ color: SEPIA_ARROW, fontSize: "0.95rem" }}>Looking up…</p>
        )}

        {entry === "not-found" && (
          <>
            <p style={{ color: SEPIA_TEXT, fontWeight: "bold", marginBottom: 4 }}>Not found</p>
            <p style={{ color: SEPIA_ARROW, fontSize: "0.9rem" }}>
              No dictionary entry for this word.
            </p>
          </>
        )}

        {entry !== "loading" && entry !== "not-found" && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: "1.2rem", fontWeight: "bold", color: SEPIA_TEXT }}>
                {entry.word}
              </span>
              {entry.phonetic && (
                <span style={{ fontSize: "0.85rem", color: SEPIA_ARROW }}>{entry.phonetic}</span>
              )}
              <button
                onClick={onClose}
                style={{ marginLeft: "auto", background: "none", border: "none",
                  cursor: "pointer", color: SEPIA_ARROW, fontSize: "1.1rem" }}
              >
                ✕
              </button>
            </div>

            {entry.meanings.slice(0, 2).map((m, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <span style={{
                  fontSize: "0.75rem", color: "#fff",
                  background: "#a89880", borderRadius: 4,
                  padding: "2px 6px", marginBottom: 4, display: "inline-block"
                }}>
                  {m.partOfSpeech}
                </span>
                <ol style={{ margin: "6px 0 0 16px", padding: 0 }}>
                  {m.definitions.slice(0, 2).map((d, j) => (
                    <li key={j} style={{ fontSize: "0.9rem", color: SEPIA_TEXT,
                      lineHeight: 1.6, marginBottom: 4 }}>
                      {d.definition}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Reader ───────────────────────────────────────────────────────────────
export default function Reader() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const bookUrl = searchParams.get("bookUrl")

  const [location, setLocation] = useState<string | number>(0)
  const [bookData, setBookData] = useState<ArrayBuffer | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState("")
  const renditionRef = useRef<Rendition | null>(null)

  // Definition popover state
  const [popover, setPopover] = useState<DictEntry | "loading" | "not-found" | null>(null)
  const [selectedText, setSelectedText] = useState<string | null>(null)

  // Pre-cache state — null = not started, 0-99 = in progress, 100 = done
  const [cacheProgress, setCacheProgress] = useState<number | null>(null)
  const cacheAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!bookUrl) { router.push("/library"); return }
    fetch(bookUrl)
      .then(res => res.arrayBuffer())
      .then(data => { setBookData(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [bookUrl, router])

  // Start pre-caching once we have the book data
  useEffect(() => {
    if (!bookData) return
    const controller = new AbortController()
    cacheAbortRef.current = controller
    setCacheProgress(0)

    extractWords(bookData).then(words => {
      preCacheDictionary(words, setCacheProgress, controller.signal)
    }).catch(() => setCacheProgress(null))

    return () => controller.abort()   // cancel if user navigates away
  }, [bookData])

  const getRendition = useCallback((rendition: Rendition) => {
    renditionRef.current = rendition

    rendition.hooks.content.register((contents: any) => {
      const doc = contents.document
      if (!doc) return

      // 1. Inject Kindle theme
      const existing = doc.getElementById("kindle-theme")
      if (existing) existing.remove()
      const style = doc.createElement("style")
      style.id = "kindle-theme"
      style.innerHTML = KINDLE_CSS
      doc.head.appendChild(style)

      // 2. Show action bar whenever the user has text selected
      //    Debounced so it waits for the user to finish dragging the handles
      let debounceTimer: ReturnType<typeof setTimeout>
      doc.addEventListener("selectionchange", () => {
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          const sel = contents.window.getSelection()
          const text = sel?.toString().trim() ?? ""
          setSelectedText(text.length > 0 ? text : null)
        }, 300)
      })
    })

    rendition.on("relocated", (loc: any) => {
      const { displayed } = loc.start
      setPage(`${displayed.page} / ${displayed.total}`)
    })
  }, [])

  const readerStyles = {
    ...ReactReaderStyle,
    readerArea: { ...ReactReaderStyle.readerArea, backgroundColor: SEPIA_BG },
    arrow:      { ...ReactReaderStyle.arrow, color: SEPIA_ARROW },
    arrowHover: { color: SEPIA_TEXT },
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "100vh", background: SEPIA_BG }}>
        <p style={{ color: SEPIA_ARROW, fontFamily: "Georgia, serif", fontSize: "1.1rem" }}>
          Opening book…
        </p>
      </div>
    )
  }

  if (!bookData) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", minHeight: "100vh", gap: 16, background: SEPIA_BG }}>
        <p style={{ color: SEPIA_TEXT, fontFamily: "Georgia, serif" }}>Could not load book.</p>
        <button onClick={() => router.push("/library")}
          style={{ color: SEPIA_TEXT, textDecoration: "underline", background: "none",
            border: "none", cursor: "pointer", fontFamily: "Georgia, serif" }}>
          ← Back to library
        </button>
      </div>
    )
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: SEPIA_BG }}>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 20px", background: "#ece8df",
        borderBottom: "1px solid #d4cfc6", flexShrink: 0 }}>
        <button onClick={() => router.push("/library")}
          style={{ fontFamily: "Georgia, serif", fontSize: "0.85rem", color: "#7a6652",
            background: "none", border: "none", cursor: "pointer" }}>
          ← Library
        </button>
        {page && (
          <span style={{ fontFamily: "Georgia, serif", fontSize: "0.8rem", color: "#7a6652" }}>
            {page}
          </span>
        )}

        {/* Dictionary cache progress — disappears once done */}
        {cacheProgress !== null && cacheProgress < 100 && (
          <span style={{ fontFamily: "Georgia, serif", fontSize: "0.75rem", color: "#b0a090" }}>
            📖 {cacheProgress}%
          </span>
        )}
      </div>

      {/* Reader */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <ReactReader
          url={bookData as unknown as string}
          location={location}
          locationChanged={(epubcfi: string) => setLocation(epubcfi)}
          getRendition={getRendition}
          readerStyles={readerStyles}
        />
      </div>

      {/* Selection action bar — appears when text is selected */}
      {selectedText && !popover && (
        <SelectionBar
          text={selectedText}
          onDefine={async () => {
            const word = selectedText.trim().split(/\s+/)[0].replace(/[^a-zA-Z'-]/g, "")
            setSelectedText(null)
            setPopover("loading")
            const entry = await fetchDefinition(word)
            setPopover(entry ?? "not-found")
          }}
          onCopy={() => {
            navigator.clipboard.writeText(selectedText).catch(() => {})
            setSelectedText(null)
          }}
          onDismiss={() => setSelectedText(null)}
        />
      )}

      {/* Definition popover — rendered above everything */}
      {popover && (
        <DefinitionPopover entry={popover} onClose={() => setPopover(null)} />
      )}

    </div>
  )
}
