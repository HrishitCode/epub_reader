"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter } from "next/navigation"
import { getUserId, getWords, getHighlights, deleteHighlight, getBooks, Word, Highlight } from "../lib/supabase/queries"
import { PALETTE, readTheme, applyTheme, type Theme, type ThemePalette } from "../lib/theme"

type Book = { id: number; title: string | null }
type Tab  = "all" | "words" | "highlights" | "notes"

// Unified entry for the feed
type Entry =
  | { kind: "word";      date: string; data: Word }
  | { kind: "highlight"; date: string; data: Highlight }
  | { kind: "note";      date: string; data: Highlight }

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined,
    { month: "short", day: "numeric", year: "numeric" })
}

function Notebook() {
  const router = useRouter()
  const [words,      setWords]      = useState<Word[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [books,      setBooks]      = useState<Book[]>([])
  const [loading,    setLoading]    = useState(true)
  const [tab,        setTab]        = useState<Tab>("all")
  const [filterBook, setFilterBook] = useState<number | "all">("all")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [uid,        setUid]        = useState<string | null>(null)
  // Colours come from CSS variables (PALETTE) and follow <html data-theme>
  // automatically — this state only drives the 🌙/☀️ toggle icon.
  const [theme,      setTheme]      = useState<Theme>("sepia")
  const t = PALETTE
  const s = makeStyles(t)

  // Sync the toggle icon with the saved theme (shared key across the app)
  useEffect(() => { setTheme(readTheme()) }, [])

  const toggleTheme = () => {
    setTheme(prev => {
      const next: Theme = prev === "sepia" ? "dark" : "sepia"
      applyTheme(next)
      return next
    })
  }

  useEffect(() => {
    getUserId()
      .then(async uid => {
        setUid(uid)
        const [ws, hs, bs] = await Promise.all([
          getWords(uid),
          getHighlights(uid),
          getBooks(uid),
        ])
        setWords(ws)
        setHighlights(hs)
        setBooks(bs as Book[])
      })
      .catch(() => router.push("/"))
      .finally(() => setLoading(false))
  }, [router])

  const bookName = (id: number) => books.find(b => b.id === id)?.title ?? "Unknown book"

  // Build unified feed ───────────────────────────────────────────────────────
  const allEntries: Entry[] = [
    ...words.map(w => ({ kind: "word" as const,  date: w.last_seen,   data: w })),
    ...highlights.map(h => ({
      kind: (h.note ? "note" : "highlight") as "note" | "highlight",
      date: h.created_at,
      data: h,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  // Filter by tab
  const byTab = allEntries.filter(e => {
    if (tab === "all")        return true
    if (tab === "words")      return e.kind === "word"
    if (tab === "highlights") return e.kind === "highlight"
    if (tab === "notes")      return e.kind === "note"
    return true
  })

  // Filter by book
  const feed = byTab.filter(e => {
    if (filterBook === "all") return true
    const bookId = e.kind === "word"
      ? (e.data as Word).book_stats.some(s => s.book_id === filterBook)
      : (e.data as Highlight).book_id === filterBook
    return bookId
  })

  const handleDeleteHighlight = async (id: number) => {
    if (!uid) return
    await deleteHighlight(id, uid)
    setHighlights(prev => prev.filter(h => h.id !== id))
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "all",        label: "All" },
    { key: "words",      label: "Words" },
    { key: "highlights", label: "Highlights" },
    { key: "notes",      label: "Notes" },
  ]

  return (
    <main style={{ minHeight: "100vh", background: t.bg, padding: "40px 20px",
      fontFamily: "Georgia, serif", transition: "background 0.2s" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <div style={{ display: "flex", alignItems: "flex-start",
            justifyContent: "space-between", gap: 12 }}>
            <div>
              <button onClick={() => router.push("/library")}
                style={{ background: "none", border: "none", cursor: "pointer",
                  color: t.muted, fontSize: "0.85rem", padding: 0, marginBottom: 8,
                  display: "block", fontFamily: "Georgia, serif" }}>
                ← Library
              </button>
              <h1 style={{ margin: 0, fontSize: "1.8rem", color: t.text, fontWeight: "normal" }}>
                My Notebook
              </h1>
              <p style={{ margin: "4px 0 0", color: t.faint, fontSize: "0.88rem" }}>
                {feed.length} {tab === "all" ? "entries" : tab}
                {filterBook !== "all" ? ` in "${bookName(filterBook as number)}"` : ""}
              </p>
            </div>
            {/* Dark / sepia toggle */}
            <button
              onClick={toggleTheme}
              aria-label="Toggle light / dark mode"
              title={theme === "sepia" ? "Switch to dark mode" : "Switch to light mode"}
              style={{ width: 36, height: 36, display: "flex", alignItems: "center",
                justifyContent: "center", borderRadius: "50%", cursor: "pointer",
                border: `1px solid ${t.border}`, background: "none", fontSize: "1rem",
                flexShrink: 0 }}>
              {theme === "sepia" ? "🌙" : "☀️"}
            </button>
          </div>
        </div>

        {/* Controls row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap",
          alignItems: "center" }}>

          {/* Book dropdown */}
          <select
            value={filterBook}
            onChange={e => setFilterBook(e.target.value === "all" ? "all" : parseInt(e.target.value))}
            style={s.select}
          >
            <option value="all">All books</option>
            {books.map(b => (
              <option key={b.id} value={b.id}>{b.title ?? "Untitled"}</option>
            ))}
          </select>

          {/* Type tabs */}
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden",
            border: `1px solid ${t.border}` }}>
            {TABS.map((tb, i) => (
              <button key={tb.key} onClick={() => setTab(tb.key)}
                style={{
                  padding: "8px 14px", fontSize: "0.82rem", border: "none",
                  cursor: "pointer", fontFamily: "Georgia, serif",
                  background: tab === tb.key ? t.primaryBg : t.card,
                  color:      tab === tb.key ? t.primaryText : t.muted,
                  borderRight: i < TABS.length - 1 ? `1px solid ${t.border}` : "none",
                }}>
                {tb.label}
              </button>
            ))}
          </div>
        </div>

        {/* Feed */}
        {loading ? (
          <p style={{ color: t.faint, textAlign: "center", marginTop: 60 }}>Loading…</p>
        ) : feed.length === 0 ? (
          <div style={{ textAlign: "center", marginTop: 60, color: t.faint }}>
            <p style={{ fontSize: "1.05rem" }}>Nothing here yet.</p>
            <p style={{ fontSize: "0.88rem", marginTop: 6 }}>
              Select text in the reader to define words, save highlights, or add notes.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {feed.map(entry => {
              const entryId = `${entry.kind}-${entry.kind === "word" ? (entry.data as Word).id : (entry.data as Highlight).id}`
              const isOpen = expandedId === entryId

              if (entry.kind === "word") {
                const w = entry.data as Word
                const def = w.definition
                const bookList = filterBook === "all" ? w.book_stats : w.book_stats.filter(st => st.book_id === filterBook)
                return (
                  <div key={entryId} style={s.card}>
                    <button onClick={() => setExpandedId(isOpen ? null : entryId)}
                      style={s.cardRow}>
                      <span style={typeBadge("word")}>Word</span>
                      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontSize: "1rem", color: t.text, fontWeight: "bold" }}>
                            {w.word}
                          </span>
                          {def?.phonetic && (
                            <span style={{ fontSize: "0.78rem", color: t.faint }}>{def.phonetic}</span>
                          )}
                        </div>
                        {!isOpen && def?.meanings?.[0]?.definitions?.[0] && (
                          <p style={s.preview}>{def.meanings[0].definitions[0].definition}</p>
                        )}
                      </div>
                      <div style={s.meta}>
                        <span style={s.countBadge}>{w.total_count}×</span>
                        <span style={s.date}>{formatDate(w.last_seen)}</span>
                      </div>
                      <span style={{ ...s.chevron, transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
                    </button>

                    {isOpen && (
                      <div style={s.expanded}>
                        {/* Per-book breakdown */}
                        {bookList.length > 0 && (
                          <div style={{ marginBottom: 14 }}>
                            <p style={s.sectionLabel}>Per book</p>
                            {bookList.map(st => (
                              <div key={st.book_id} style={s.bookRow}>
                                <span style={{ fontSize: "0.85rem", color: t.text, fontStyle: "italic" }}>
                                  {bookName(st.book_id)}
                                </span>
                                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                  <span style={{ fontSize: "0.8rem", color: t.muted, fontWeight: "bold" }}>{st.count}×</span>
                                  <span style={s.date}>first {formatDate(st.first_seen)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Definition */}
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        {def?.meanings?.map((m: any, i: number) => (
                          <div key={i} style={{ marginTop: 8 }}>
                            <span style={posTag}>{m.partOfSpeech}</span>
                            <ol style={{ margin: "6px 0 0 18px", padding: 0 }}>
                              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                              {m.definitions.slice(0, 3).map((d: any, j: number) => (
                                <li key={j} style={{ fontSize: "0.88rem", color: t.text,
                                  lineHeight: 1.7, marginBottom: 4 }}>
                                  {d.definition}
                                </li>
                              ))}
                            </ol>
                          </div>
                        ))}
                        <p style={{ ...s.date, marginTop: 12 }}>First looked up {formatDate(w.first_seen)}</p>
                      </div>
                    )}
                  </div>
                )
              }

              // Highlight or Note — collapsed: clamped 2-line preview (so long
              // passages don't make phone cards huge); tap to expand for the
              // full passage, note, and metadata footer.
              const h = entry.data as Highlight
              return (
                <div key={entryId} style={s.card}>
                  <button onClick={() => setExpandedId(isOpen ? null : entryId)}
                    style={{ ...s.cardRow, alignItems: "flex-start" }}>
                    <span style={typeBadge(entry.kind)}>{entry.kind === "note" ? "Note" : "Highlight"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Passage — clamped while collapsed */}
                      <p style={{
                        margin: 0, fontSize: "0.9rem", color: t.text,
                        fontStyle: "italic", lineHeight: 1.65,
                        borderLeft: `3px solid ${t.border}`, paddingLeft: 10,
                        ...(isOpen ? {} : clamp2),
                      }}>
                        "{h.text}"
                      </p>
                      {/* Note hint while collapsed */}
                      {!isOpen && h.note && (
                        <p style={{ ...s.preview, fontStyle: "normal" }}>✏️ {h.note}</p>
                      )}
                    </div>
                    <span style={{ ...s.chevron, transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
                  </button>

                  {isOpen && (
                    <div style={s.expanded}>
                      {/* Full note */}
                      {h.note && (
                        <p style={{ margin: "12px 0 0", fontSize: "0.88rem", color: t.text,
                          lineHeight: 1.6, background: t.surface, borderRadius: 6,
                          padding: "8px 12px" }}>
                          {h.note}
                        </p>
                      )}
                      {/* Footer: book · date — and Remove */}
                      <div style={{ display: "flex", alignItems: "center",
                        justifyContent: "space-between", gap: 10, marginTop: 12 }}>
                        <span style={{ ...s.date, minWidth: 0, overflow: "hidden",
                          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {bookName(h.book_id)} · {formatDate(h.created_at)}
                        </span>
                        <button
                          onClick={() => handleDeleteHighlight(h.id)}
                          style={{ background: "none", border: `1px solid ${t.dangerBorder}`,
                            borderRadius: 6, cursor: "pointer", color: t.danger,
                            fontSize: "0.75rem", padding: "4px 10px", flexShrink: 0,
                            fontFamily: "Georgia, serif" }}
                          title="Delete">
                          Remove
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}

// ── Theme-aware micro-styles ──────────────────────────────────────────────────
function makeStyles(t: ThemePalette) {
  return {
    select: {
      padding: "8px 12px", fontSize: "0.82rem",
      border: `1px solid ${t.border}`, borderRadius: 8,
      background: t.card, color: t.text,
      fontFamily: "Georgia, serif", cursor: "pointer",
    } as React.CSSProperties,
    card: {
      background: t.card, border: `1px solid ${t.border}`,
      borderRadius: 10, overflow: "hidden",
    } as React.CSSProperties,
    cardRow: {
      width: "100%", display: "flex", alignItems: "center",
      gap: 10, padding: "13px 14px", background: "none",
      border: "none", cursor: "pointer", textAlign: "left",
    } as React.CSSProperties,
    expanded: {
      padding: "0 14px 14px", borderTop: `1px solid ${t.surface}`,
    } as React.CSSProperties,
    meta: {
      display: "flex", flexDirection: "column", alignItems: "flex-end",
      gap: 3, flexShrink: 0,
    } as React.CSSProperties,
    preview: {
      margin: "3px 0 0", fontSize: "0.82rem", color: t.muted,
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    } as React.CSSProperties,
    date: { fontSize: "0.72rem", color: t.faint } as React.CSSProperties,
    chevron: {
      color: t.faint, fontSize: "0.8rem", flexShrink: 0, transition: "transform 0.2s",
    } as React.CSSProperties,
    countBadge: {
      display: "inline-block", background: t.surface, color: t.muted,
      borderRadius: 20, padding: "1px 8px", fontSize: "0.75rem",
    } as React.CSSProperties,
    sectionLabel: {
      margin: "12px 0 8px", fontSize: "0.72rem", color: t.faint,
      textTransform: "uppercase", letterSpacing: "0.06em",
    } as React.CSSProperties,
    bookRow: {
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: t.bg, borderRadius: 8, padding: "7px 11px", marginBottom: 4,
    } as React.CSSProperties,
  }
}

// Works on both themes (mid-tone bg, white text)
const posTag: React.CSSProperties = {
  fontSize: "0.72rem", color: "#fff", background: "#a89880",
  borderRadius: 4, padding: "2px 6px", display: "inline-block",
}

// Multi-line ellipsis — caps collapsed passages at 2 lines
const clamp2: React.CSSProperties = {
  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
  overflow: "hidden",
}

// Badge colours are CSS variables too (see globals.css), so they follow
// <html data-theme> without re-rendering.
function typeBadge(kind: string): React.CSSProperties {
  const colors: Record<string, [string, string]> = {
    word:      ["var(--badge-word-bg)", "var(--badge-word-fg)"],
    highlight: ["var(--badge-hl-bg)",   "var(--badge-hl-fg)"],
    note:      ["var(--badge-note-bg)", "var(--badge-note-fg)"],
  }
  const [bg, color] = colors[kind] ?? ["var(--surface)", "var(--muted)"]
  return {
    flexShrink: 0, fontSize: "0.68rem", fontFamily: "Georgia, serif",
    background: bg, color, borderRadius: 4, padding: "2px 7px",
    letterSpacing: "0.04em",
  }
}

export default function NotebookPage() {
  return (
    <Suspense fallback={
      <main style={{ minHeight: "100vh", background: PALETTE.bg, display: "flex",
        alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: PALETTE.faint, fontFamily: "Georgia, serif" }}>Loading…</p>
      </main>
    }>
      <Notebook />
    </Suspense>
  )
}
