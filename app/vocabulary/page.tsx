"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter } from "next/navigation"
import { getUserId, getWords, getHighlights, deleteHighlight, getBooks, Word, Highlight } from "../lib/supabase/queries"

type Book  = { id: number; title: string | null }
type Tab   = "all" | "words" | "highlights" | "notes"

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

  useEffect(() => {
    getUserId()
      .then(async uid => {
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
    await deleteHighlight(id)
    setHighlights(prev => prev.filter(h => h.id !== id))
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "all",        label: "All" },
    { key: "words",      label: "Words" },
    { key: "highlights", label: "Highlights" },
    { key: "notes",      label: "Notes" },
  ]

  return (
    <main style={{ minHeight: "100vh", background: "#f4f1ea", padding: "40px 20px",
      fontFamily: "Georgia, serif" }}>
      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <button onClick={() => router.push("/library")}
            style={{ background: "none", border: "none", cursor: "pointer",
              color: "#7a6652", fontSize: "0.85rem", padding: 0, marginBottom: 8,
              display: "block" }}>
            ← Library
          </button>
          <h1 style={{ margin: 0, fontSize: "1.8rem", color: "#3d2b1f", fontWeight: "normal" }}>
            My Notebook
          </h1>
          <p style={{ margin: "4px 0 0", color: "#a89880", fontSize: "0.88rem" }}>
            {feed.length} {tab === "all" ? "entries" : tab}
            {filterBook !== "all" ? ` in "${bookName(filterBook as number)}"` : ""}
          </p>
        </div>

        {/* Controls row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 22, flexWrap: "wrap",
          alignItems: "center" }}>

          {/* Book dropdown */}
          <select
            value={filterBook}
            onChange={e => setFilterBook(e.target.value === "all" ? "all" : parseInt(e.target.value))}
            style={selectStyle}
          >
            <option value="all">All books</option>
            {books.map(b => (
              <option key={b.id} value={b.id}>{b.title ?? "Untitled"}</option>
            ))}
          </select>

          {/* Type tabs */}
          <div style={{ display: "flex", borderRadius: 8, overflow: "hidden",
            border: "1px solid #d4cfc6" }}>
            {TABS.map((t, i) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{
                  padding: "8px 14px", fontSize: "0.82rem", border: "none",
                  cursor: "pointer", fontFamily: "Georgia, serif",
                  background: tab === t.key ? "#3d2b1f" : "#fffdf8",
                  color:      tab === t.key ? "#f4f1ea" : "#7a6652",
                  borderRight: i < TABS.length - 1 ? "1px solid #d4cfc6" : "none",
                }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Feed */}
        {loading ? (
          <p style={{ color: "#a89880", textAlign: "center", marginTop: 60 }}>Loading…</p>
        ) : feed.length === 0 ? (
          <div style={{ textAlign: "center", marginTop: 60, color: "#a89880" }}>
            <p style={{ fontSize: "1.05rem" }}>Nothing here yet.</p>
            <p style={{ fontSize: "0.88rem", marginTop: 6 }}>
              Select text in the reader to define words, save highlights, or add notes.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {feed.map(entry => {
              const uid = `${entry.kind}-${entry.kind === "word" ? (entry.data as Word).id : (entry.data as Highlight).id}`
              const isOpen = expandedId === uid

              if (entry.kind === "word") {
                const w = entry.data as Word
                const def = w.definition
                const bookList = filterBook === "all" ? w.book_stats : w.book_stats.filter(s => s.book_id === filterBook)
                return (
                  <div key={uid} style={cardStyle}>
                    <button onClick={() => setExpandedId(isOpen ? null : uid)}
                      style={cardRowStyle}>
                      <span style={typeBadge("word")}>Word</span>
                      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                          <span style={{ fontSize: "1rem", color: "#3d2b1f", fontWeight: "bold" }}>
                            {w.word}
                          </span>
                          {def?.phonetic && (
                            <span style={{ fontSize: "0.78rem", color: "#a89880" }}>{def.phonetic}</span>
                          )}
                        </div>
                        {!isOpen && def?.meanings?.[0]?.definitions?.[0] && (
                          <p style={previewStyle}>{def.meanings[0].definitions[0].definition}</p>
                        )}
                      </div>
                      <div style={metaStyle}>
                        <span style={countBadge}>{w.total_count}×</span>
                        <span style={dateStyle}>{formatDate(w.last_seen)}</span>
                      </div>
                      <span style={{ ...chevronStyle, transform: isOpen ? "rotate(180deg)" : "none" }}>▾</span>
                    </button>

                    {isOpen && (
                      <div style={expandedStyle}>
                        {/* Per-book breakdown */}
                        {bookList.length > 0 && (
                          <div style={{ marginBottom: 14 }}>
                            <p style={sectionLabel}>Per book</p>
                            {bookList.map(s => (
                              <div key={s.book_id} style={bookRowStyle}>
                                <span style={{ fontSize: "0.85rem", color: "#3d2b1f", fontStyle: "italic" }}>
                                  {bookName(s.book_id)}
                                </span>
                                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                                  <span style={{ fontSize: "0.8rem", color: "#7a6652", fontWeight: "bold" }}>{s.count}×</span>
                                  <span style={dateStyle}>first {formatDate(s.first_seen)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Definition */}
                        {def?.meanings?.map((m: any, i: number) => (
                          <div key={i} style={{ marginTop: 8 }}>
                            <span style={posTag}>{m.partOfSpeech}</span>
                            <ol style={{ margin: "6px 0 0 18px", padding: 0 }}>
                              {m.definitions.slice(0, 3).map((d: any, j: number) => (
                                <li key={j} style={{ fontSize: "0.88rem", color: "#3d2b1f",
                                  lineHeight: 1.7, marginBottom: 4 }}>
                                  {d.definition}
                                </li>
                              ))}
                            </ol>
                          </div>
                        ))}
                        <p style={{ ...dateStyle, marginTop: 12 }}>First looked up {formatDate(w.first_seen)}</p>
                      </div>
                    )}
                  </div>
                )
              }

              // Highlight or Note
              const h = entry.data as Highlight
              return (
                <div key={uid} style={cardStyle}>
                  <div style={{ ...cardRowStyle, cursor: "default", alignItems: "flex-start" }}>
                    <span style={typeBadge(entry.kind)}>{entry.kind === "note" ? "Note" : "Highlight"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Passage */}
                      <p style={{
                        margin: "0 0 6px", fontSize: "0.9rem", color: "#3d2b1f",
                        fontStyle: "italic", lineHeight: 1.65,
                        borderLeft: "3px solid #d4cfc6", paddingLeft: 10,
                      }}>
                        "{h.text}"
                      </p>
                      {/* User note */}
                      {h.note && (
                        <p style={{ margin: 0, fontSize: "0.88rem", color: "#5a3e2b",
                          lineHeight: 1.6, background: "#ece8df", borderRadius: 6,
                          padding: "6px 10px" }}>
                          {h.note}
                        </p>
                      )}
                    </div>
                    <div style={{ ...metaStyle, alignItems: "flex-end" }}>
                      <span style={{ ...dateStyle, fontSize: "0.72rem" }}>{bookName(h.book_id)}</span>
                      <span style={dateStyle}>{formatDate(h.created_at)}</span>
                      <button
                        onClick={() => handleDeleteHighlight(h.id)}
                        style={{ background: "none", border: "none", cursor: "pointer",
                          color: "#c4b09a", fontSize: "0.75rem", padding: "2px 0",
                          fontFamily: "Georgia, serif" }}
                        title="Delete">
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}

// ── Shared micro-styles ───────────────────────────────────────────────────────
const selectStyle: React.CSSProperties = {
  padding: "8px 12px", fontSize: "0.82rem",
  border: "1px solid #d4cfc6", borderRadius: 8,
  background: "#fffdf8", color: "#3d2b1f",
  fontFamily: "Georgia, serif", cursor: "pointer",
}
const cardStyle: React.CSSProperties = {
  background: "#fffdf8", border: "1px solid #d4cfc6",
  borderRadius: 10, overflow: "hidden",
}
const cardRowStyle: React.CSSProperties = {
  width: "100%", display: "flex", alignItems: "center",
  gap: 10, padding: "13px 14px", background: "none",
  border: "none", cursor: "pointer", textAlign: "left",
}
const expandedStyle: React.CSSProperties = {
  padding: "0 14px 14px", borderTop: "1px solid #ece8df",
}
const metaStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "flex-end",
  gap: 3, flexShrink: 0,
}
const previewStyle: React.CSSProperties = {
  margin: "3px 0 0", fontSize: "0.82rem", color: "#7a6652",
  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
}
const dateStyle: React.CSSProperties = { fontSize: "0.72rem", color: "#a89880" }
const chevronStyle: React.CSSProperties = {
  color: "#a89880", fontSize: "0.8rem", flexShrink: 0, transition: "transform 0.2s",
}
const countBadge: React.CSSProperties = {
  display: "inline-block", background: "#ece8df", color: "#7a6652",
  borderRadius: 20, padding: "1px 8px", fontSize: "0.75rem",
}
const sectionLabel: React.CSSProperties = {
  margin: "12px 0 8px", fontSize: "0.72rem", color: "#a89880",
  textTransform: "uppercase", letterSpacing: "0.06em",
}
const bookRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  background: "#f4f1ea", borderRadius: 8, padding: "7px 11px", marginBottom: 4,
}
const posTag: React.CSSProperties = {
  fontSize: "0.72rem", color: "#fff", background: "#a89880",
  borderRadius: 4, padding: "2px 6px", display: "inline-block",
}

function typeBadge(kind: string): React.CSSProperties {
  const colors: Record<string, [string, string]> = {
    word:      ["#e8f0e8", "#4a7a4a"],
    highlight: ["#fdf3e0", "#8a6a20"],
    note:      ["#e8eaf6", "#3949ab"],
  }
  const [bg, color] = colors[kind] ?? ["#ece8df", "#7a6652"]
  return {
    flexShrink: 0, fontSize: "0.68rem", fontFamily: "Georgia, serif",
    background: bg, color, borderRadius: 4, padding: "2px 7px",
    letterSpacing: "0.04em",
  }
}

export default function NotebookPage() {
  return (
    <Suspense fallback={
      <main style={{ minHeight: "100vh", background: "#f4f1ea", display: "flex",
        alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "#a89880", fontFamily: "Georgia, serif" }}>Loading…</p>
      </main>
    }>
      <Notebook />
    </Suspense>
  )
}
