"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter } from "next/navigation"
import { unzipSync, strFromU8 } from "fflate"
import {
  getBooks, getUserId, getBookUrl, deleteBook,
  sha256Hex, findCatalogByHash, uploadCatalogFile, uploadCatalogCover, insertCatalog,
  searchCatalog, addBookFromCatalog, type CatalogEntry,
} from "../lib/supabase/queries"
import { logout } from "../lib/supabase/auth"

type Book = {
  id: number
  title: string | null
  book_url: string
  cover_url: string | null
  catalog_id: number | null
}

// ── Themes ───────────────────────────────────────────────────────────────────
// Shares the "reader_theme" localStorage key with the reader so the choice
// persists across the whole app.
type Theme = "sepia" | "dark"

const THEMES = {
  sepia: {
    bg:         "#f4f1ea",
    surface:    "#ece8df",
    border:     "#d4cfc6",
    text:       "#3d2b1f",
    muted:      "#7a6652",
    primaryBg:  "#3d2b1f",
    primaryText:"#f4f1ea",
    primaryHover:"#5a3e2b",
    coverBg:    "#d9cfc4",
  },
  dark: {
    bg:         "#1c1c1e",
    surface:    "#2c2c2e",
    border:     "#3c3c3e",
    text:       "#e8e0d0",
    muted:      "#9a9080",
    primaryBg:  "#e8e0d0",
    primaryText:"#1c1c1e",
    primaryHover:"#cfc6b4",
    coverBg:    "#3c3c3e",
  },
}

function readTheme(): Theme {
  try { return (localStorage.getItem("reader_theme") as Theme) ?? "sepia" } catch { return "sepia" }
}

type EpubMeta = { title: string; coverBlob: Blob | null }

// Parse epub metadata directly from the zip — no epubjs, no rendering pipeline.
// epub format: zip → META-INF/container.xml → OPF file → title + cover path
function extractEpubMeta(buffer: ArrayBuffer, fallbackTitle: string): EpubMeta {
  try {
    const zip = unzipSync(new Uint8Array(buffer))

    // 1. Read META-INF/container.xml to find the OPF file path
    const containerXml = strFromU8(zip["META-INF/container.xml"])
    const opfPathMatch = containerXml.match(/full-path="([^"]+\.opf)"/)
    if (!opfPathMatch) return { title: fallbackTitle, coverBlob: null }
    const opfPath = opfPathMatch[1]

    // 2. Parse the OPF file (it's XML)
    const opfXml = strFromU8(zip[opfPath])

    // 3. Extract title
    const titleMatch = opfXml.match(/<dc:title[^>]*>([^<]+)<\/dc:title>/)
    const title = titleMatch?.[1]?.trim() || fallbackTitle

    // 4. Find cover image path
    //    Epubs store the cover in one of two ways — check both
    let coverBlob: Blob | null = null

    // Method A: <meta name="cover" content="cover-id"/> → find that item in manifest
    const coverMetaMatch = opfXml.match(/<meta[^>]+name=["']cover["'][^>]+content=["']([^"']+)["']/)
    const coverId = coverMetaMatch?.[1]

    // Method B: manifest item with id="cover" or properties="cover-image"
    const manifestItemRegex = /<item[^>]+>/g
    let itemMatch: RegExpExecArray | null
    let coverHref: string | null = null

    while ((itemMatch = manifestItemRegex.exec(opfXml)) !== null) {
      const item = itemMatch[0]
      const isImage = /media-type=["']image\//.test(item)
      if (!isImage) continue

      const idMatch = item.match(/\bid=["']([^"']+)["']/)
      const hrefMatch = item.match(/\bhref=["']([^"']+)["']/)
      const isCoverByProp = /properties=["'][^"']*cover-image[^"']*["']/.test(item)
      const isCoverById = coverId && idMatch?.[1] === coverId

      if (isCoverByProp || isCoverById) {
        coverHref = hrefMatch?.[1] ?? null
        break
      }
    }

    if (coverHref) {
      // Resolve relative path against OPF directory
      const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : ""
      const fullCoverPath = coverHref.startsWith("/") ? coverHref.slice(1) : opfDir + coverHref

      const coverBytes = zip[fullCoverPath] ?? zip[decodeURIComponent(fullCoverPath)]
      if (coverBytes) {
        coverBlob = new Blob([coverBytes], { type: "image/jpeg" })
      }
    }

    return { title, coverBlob }
  } catch (e) {
    console.warn("epub meta extraction failed:", e)
    return { title: fallbackTitle, coverBlob: null }
  }
}

// Deep structural validation — runs BEFORE upload so a broken epub never makes
// it into the library. Catches the cases that crash epub.js at render time:
//   • not a real zip / not an epub
//   • missing META-INF/container.xml or OPF
//   • spine entries pointing at manifest items whose files aren't in the zip
//     (this is what produces epub.js's `new Path(undefined)` crash)
function validateEpub(buffer: ArrayBuffer): { ok: true } | { ok: false; reason: string } {
  let zip: Record<string, Uint8Array>
  try {
    zip = unzipSync(new Uint8Array(buffer))
  } catch {
    return { ok: false, reason: "This file isn't a valid EPUB (couldn't read the archive)." }
  }

  // 1. container.xml → OPF path
  const containerBytes = zip["META-INF/container.xml"]
  if (!containerBytes) return { ok: false, reason: "Missing META-INF/container.xml — the file isn't a proper EPUB." }
  const containerXml = strFromU8(containerBytes)
  const opfPathMatch = containerXml.match(/full-path="([^"]+\.opf)"/)
  if (!opfPathMatch) return { ok: false, reason: "Couldn't find the EPUB's package file (OPF)." }
  const opfPath = opfPathMatch[1]

  // 2. OPF present
  const opfBytes = zip[opfPath] ?? zip[decodeURIComponent(opfPath)]
  if (!opfBytes) return { ok: false, reason: "The EPUB's package file is missing or unreadable." }
  const opfXml = strFromU8(opfBytes)

  // 3. Build manifest map: id → href
  const manifest = new Map<string, string>()
  const itemRegex = /<item\b[^>]*>/g
  let m: RegExpExecArray | null
  while ((m = itemRegex.exec(opfXml)) !== null) {
    const id = m[0].match(/\bid=["']([^"']+)["']/)?.[1]
    const href = m[0].match(/\bhref=["']([^"']+)["']/)?.[1]
    if (id && href) manifest.set(id, href)
  }

  // 4. Spine health — be tolerant, not perfectionist. Real-world epubs (esp.
  //    Internet Archive scans) often have a stray spine entry with no manifest
  //    item (e.g. "cover"); epub.js simply skips those, so they're harmless.
  //    What actually crashes the reader is a manifest href pointing to a file
  //    that ISN'T in the zip. So: tolerate hrefless entries, count genuinely
  //    missing files, and only reject if the book is *mostly* broken.
  const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : ""
  const spineRegex = /<itemref\b[^>]*>/g
  let total = 0       // spine entries that name a manifest href
  let readable = 0    // …whose file exists in the zip
  let s: RegExpExecArray | null
  while ((s = spineRegex.exec(opfXml)) !== null) {
    const idref = s[0].match(/\bidref=["']([^"']+)["']/)?.[1]
    if (!idref) continue
    const href = manifest.get(idref)
    if (!href) continue   // hrefless entry → epub.js skips it, don't penalise
    total++
    const full = href.startsWith("/") ? href.slice(1) : opfDir + href
    if (zip[full] !== undefined || zip[decodeURIComponent(full)] !== undefined) readable++
  }

  if (total === 0 || readable === 0) {
    return { ok: false, reason: "This EPUB has no readable chapters." }
  }
  // Reject only if a large share of referenced chapters are missing — that's a
  // genuinely corrupt file, not a quirky-but-readable one.
  if (readable / total < 0.8) {
    return { ok: false, reason: "Many chapters are missing from this EPUB — the file looks corrupted." }
  }

  // 5. Table of contents — the book MUST have a usable, marked-up TOC.
  //    Internet-Archive-style scans ship an empty <ol/> nav and a 0-entry NCX,
  //    so chapters aren't navigable. We require a handful of real, named
  //    entries (ignoring blank labels and generic "Page N" placeholders).
  const GENERIC = /^(page\s*\d+|cover|title( page)?|contents?|toc)$/i
  const countTocEntries = (entries: { label: string }[]) =>
    entries.filter(e => {
      const label = e.label.replace(/\s+/g, " ").trim()
      return label.length > 0 && !GENERIC.test(label)
    }).length

  // Read a navigation file referenced in the manifest, given a predicate.
  const readManifestFile = (pred: (item: string) => boolean): string | null => {
    const itemRe = /<item\b[^>]*>/g
    let it: RegExpExecArray | null
    while ((it = itemRe.exec(opfXml)) !== null) {
      if (!pred(it[0])) continue
      const href = it[0].match(/\bhref=["']([^"']+)["']/)?.[1]
      if (!href) continue
      const full = href.startsWith("/") ? href.slice(1) : opfDir + href
      const bytes = zip[full] ?? zip[decodeURIComponent(full)]
      if (bytes) return strFromU8(bytes)
    }
    return null
  }

  let tocEntries = 0

  // 5a. EPUB3 nav document (properties="nav") → <nav epub:type="toc"> anchors
  const navXml = readManifestFile(item => /\bproperties=["'][^"']*\bnav\b[^"']*["']/.test(item))
  if (navXml) {
    const tocBlock = navXml.match(/<nav\b[^>]*epub:type=["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1] ?? navXml
    const anchors = [...tocBlock.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(a => ({ label: a[1].replace(/<[^>]+>/g, " ") }))
    tocEntries = countTocEntries(anchors)
  }

  // 5b. Fall back to the EPUB2 NCX (media-type application/x-dtbncx+xml)
  if (tocEntries < 3) {
    const ncxXml = readManifestFile(item => /media-type=["']application\/x-dtbncx\+xml["']/.test(item))
    if (ncxXml) {
      const labels = [...ncxXml.matchAll(/<navLabel>\s*<text>([\s\S]*?)<\/text>/gi)]
        .map(l => ({ label: l[1] }))
      tocEntries = Math.max(tocEntries, countTocEntries(labels))
    }
  }

  if (tocEntries < 3) {
    return {
      ok: false,
      reason: "This EPUB has no usable table of contents — its chapters aren't marked up, so it can't be navigated reliably.",
    }
  }

  return { ok: true }
}

// ── Body-start detection ──────────────────────────────────────────────────────
// Returns the spine index where the actual reading material begins, so the
// reader can open past front matter (cover, praise, copyright, TOC…) on first
// open. Layered: most authoritative signal first, graceful fallback to 0.
// NOTHING is hidden — the reader can still page back into front matter.
//
//   1. EPUB3 landmarks nav  → epub:type="bodymatter"   (spec-official marker)
//   2. OPF <guide>          → <reference type="text">  (EPUB2 equivalent)
//   3. Heading keyword scan → first "Prologue/Foreword/Chapter 1/Part One…"
//   4. Give up → 0 (skip nothing)
function detectBodyStart(buffer: ArrayBuffer): number {
  try {
    const zip = unzipSync(new Uint8Array(buffer))

    const container = zip["META-INF/container.xml"]
    if (!container) return 0
    const opfPath = strFromU8(container).match(/full-path="([^"]+\.opf)"/)?.[1]
    if (!opfPath) return 0
    const opfDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : ""
    const opfBytes = zip[opfPath] ?? zip[decodeURIComponent(opfPath)]
    if (!opfBytes) return 0
    const opf = strFromU8(opfBytes)

    // manifest: id → href ; and a reverse href(basename) → spine index helper
    const manifest = new Map<string, string>()
    let im: RegExpExecArray | null
    const itemRe = /<item\b[^>]*>/g
    while ((im = itemRe.exec(opf)) !== null) {
      const id = im[0].match(/\bid=["']([^"']+)["']/)?.[1]
      const href = im[0].match(/\bhref=["']([^"']+)["']/)?.[1]
      if (id && href) manifest.set(id, href)
    }

    // IMPORTANT: keep EVERY itemref (even ones with no manifest href, e.g. a
    // stray "cover") so our index lines up exactly with epub.js's spine, which
    // is what `rendition.display(index)` addresses. Missing hrefs become "".
    const spine: string[] = []  // spine[i] = href (relative to OPF dir) or ""
    let sm: RegExpExecArray | null
    const spineRe = /<itemref\b[^>]*>/g
    while ((sm = spineRe.exec(opf)) !== null) {
      const idref = sm[0].match(/\bidref=["']([^"']+)["']/)?.[1]
      if (idref) spine.push(manifest.get(idref) ?? "")
    }
    if (spine.length === 0) return 0

    // Normalise a path to its filename (drop dirs + #fragment + querystring) so
    // we can match hrefs that use different relative bases.
    const baseName = (p: string) => decodeURIComponent(p).split(/[#?]/)[0].split("/").pop() ?? p
    const spineIndexOfHref = (href: string): number => {
      const target = baseName(href)
      return spine.findIndex(h => baseName(h) === target)
    }

    // ── 1. EPUB3 landmarks (nav document with epub:type="bodymatter") ─────────
    const navId = opf.match(/<item\b[^>]*\bproperties=["'][^"']*\bnav\b[^"']*["'][^>]*>/)?.[0]
      ?.match(/\bid=["']([^"']+)["']/)?.[1]
    const navHref = navId ? manifest.get(navId) : undefined
    if (navHref) {
      const navPath = (navHref.startsWith("/") ? navHref.slice(1) : opfDir + navHref)
      const navBytes = zip[navPath] ?? zip[decodeURIComponent(navPath)]
      if (navBytes) {
        const nav = strFromU8(navBytes)
        const bodyAnchor = nav.match(/<a\b[^>]*epub:type=["'][^"']*\bbodymatter\b[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1]
          ?? nav.match(/epub:type=["'][^"']*\bbodymatter\b[^"']*["'][^>]*?href=["']([^"']+)["']/i)?.[1]
        if (bodyAnchor) {
          const idx = spineIndexOfHref(bodyAnchor)
          if (idx > 0) return idx
        }
      }
    }

    // ── 2. OPF <guide> reference type="text" (start of reading) ───────────────
    const guideText = opf.match(/<reference\b[^>]*type=["']text["'][^>]*href=["']([^"']+)["']/i)?.[1]
      ?? opf.match(/<reference\b[^>]*href=["']([^"']+)["'][^>]*type=["']text["']/i)?.[1]
    if (guideText) {
      const idx = spineIndexOfHref(guideText)
      if (idx > 0) return idx
    }

    // ── 3. Heading keyword scan over spine sections ───────────────────────────
    const bodyKw = /^\s*(prologue|foreword|preface|introduction|part\s*(one|i|1)\b|chapter\s*(one|1)\b)/i
    for (let i = 0; i < spine.length; i++) {
      const href = spine[i]
      const path = href.startsWith("/") ? href.slice(1) : opfDir + href
      const bytes = zip[path] ?? zip[decodeURIComponent(path)]
      if (!bytes) continue
      const text = strFromU8(bytes)
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z#0-9]+;/gi, " ")
        // OCR scans often prefix "Page N " — strip a leading page label
        .replace(/^\s*page\s+\d+\s+/i, "")
        .replace(/\s+/g, " ")
        .trim()
      if (bodyKw.test(text.slice(0, 60))) return i
    }

    // ── 4. Nothing matched → don't skip anything ──────────────────────────────
    return 0
  } catch {
    return 0
  }
}

function Library() {
  const router = useRouter()
  const [books, setBooks] = useState<Book[]>([])
  const [uid, setUid] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [theme, setTheme] = useState<Theme>("sepia")
  const [invalidMsg, setInvalidMsg] = useState<string | null>(null)   // corrupted-epub modal
  const [pendingDelete, setPendingDelete] = useState<Book | null>(null) // delete-confirm modal
  // Catalog search
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<CatalogEntry[]>([])
  const [searching, setSearching] = useState(false)
  const [addingId, setAddingId] = useState<number | null>(null)
  const t = THEMES[theme]

  // catalog_ids already in this user's library — to mark search results.
  const ownedCatalogIds = new Set(books.map(b => b.catalog_id).filter((id): id is number => id != null))

  // Load saved theme on mount
  useEffect(() => { setTheme(readTheme()) }, [])

  const toggleTheme = () => {
    setTheme(prev => {
      const next: Theme = prev === "sepia" ? "dark" : "sepia"
      try { localStorage.setItem("reader_theme", next) } catch { /* ignore */ }
      return next
    })
  }

  useEffect(() => {
    getUserId()
      .then(async (id) => {
        setUid(id)
        const data = await getBooks(id)
        setBooks(data as Book[])
      })
      .catch(() => router.push("/"))
  }, [router])

  const confirmDelete = async () => {
    const book = pendingDelete
    if (!book || !uid) return
    setPendingDelete(null)
    setDeletingId(book.id)
    try {
      await deleteBook(uid, book.id, book.book_url, book.cover_url)
      setBooks(prev => prev.filter(b => b.id !== book.id))
    } catch {
      setError("Could not delete book. Please try again.")
    } finally {
      setDeletingId(null)
    }
  }

  // ── Catalog search ──────────────────────────────────────────────────────────
  // Debounce the query so we don't hit the DB on every keystroke.
  useEffect(() => {
    if (!searchOpen) return
    const q = searchQuery.trim()
    if (!q) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    const handle = setTimeout(async () => {
      try { setSearchResults(await searchCatalog(q)) }
      catch { setSearchResults([]) }
      finally { setSearching(false) }
    }, 300)
    return () => clearTimeout(handle)
  }, [searchQuery, searchOpen])

  const handleAddFromCatalog = async (entry: CatalogEntry) => {
    if (!uid) return
    setAddingId(entry.id)
    try {
      await addBookFromCatalog(uid, entry)
      const updated = await getBooks(uid)
      setBooks(updated as Book[])
    } catch {
      setError("Could not add this book. Please try again.")
    } finally {
      setAddingId(null)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !uid) return
    if (!file.name.endsWith(".epub")) {
      setError("Only .epub files are allowed")
      return
    }

    try {
      setUploading(true)
      setError(null)

      // 1. Read file
      setUploadStatus("Reading file…")
      const buffer = await file.arrayBuffer()

      // 1b. Validate structure BEFORE uploading — reject broken/corrupt epubs
      //     so they never appear in the library and never crash the reader.
      setUploadStatus("Checking book…")
      const validation = validateEpub(buffer)
      if (!validation.ok) {
        setInvalidMsg(validation.reason)
        return  // finally{} resets the upload UI
      }

      // 2. Hash the file — this is the universal dedup key for the catalog.
      setUploadStatus("Checking catalog…")
      const hash = await sha256Hex(buffer)
      let catalog = await findCatalogByHash(hash)

      // 3. Not in the catalog yet → store the file once + create a catalog entry.
      if (!catalog) {
        setUploadStatus("Reading book info…")
        const fallback = file.name.replace(".epub", "")
        const { title, coverBlob } = extractEpubMeta(buffer, fallback)
        const startIndex = detectBodyStart(buffer)

        setUploadStatus("Uploading book…")
        const uploaded = await uploadCatalogFile(buffer, hash)
        const { publicUrl: bookPublicUrl } = await getBookUrl(uploaded.path)

        setUploadStatus("Uploading cover…")
        let coverPublicUrl: string | undefined
        if (coverBlob) {
          const coverUploaded = await uploadCatalogCover(coverBlob, hash)
          const { publicUrl } = await getBookUrl(coverUploaded.path)
          coverPublicUrl = publicUrl
        }

        catalog = await insertCatalog({
          file_hash: hash,
          title,
          book_url: bookPublicUrl,
          cover_url: coverPublicUrl,
          start_index: startIndex,
          uploaded_by: uid,
        })
      }

      // 4. Add the (new or existing) catalog book to this user's library.
      setUploadStatus("Saving…")
      const added = await addBookFromCatalog(uid, catalog)
      if (!added) {
        setError(`"${catalog.title ?? "This book"}" is already in your library.`)
      }

      const updated = await getBooks(uid)
      setBooks(updated as Book[])
    } catch (err) {
      setError(`Upload failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setUploading(false)
      setUploadStatus("")
      e.target.value = ""
    }
  }

  return (
    <main className="min-h-screen px-4 sm:px-6 py-6 sm:py-10 transition-colors" style={{ background: t.bg }}>
      <div className="max-w-4xl mx-auto">

        {/* ── Header ──────────────────────────────────────────────────────────
            Mobile: title on its own row, then a full-width "Add Book" button,
            then a row of secondary actions. Desktop: everything on one line. */}
        <header className="mb-8">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h1 className="text-2xl sm:text-3xl font-serif" style={{ color: t.text }}>
              My Library
            </h1>

            {/* Secondary actions — icon buttons, always compact */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={toggleTheme}
                aria-label="Toggle light / dark mode"
                title={theme === "sepia" ? "Switch to dark mode" : "Switch to light mode"}
                className="w-9 h-9 flex items-center justify-center rounded-full border transition-colors"
                style={{ borderColor: t.border, color: t.muted }}
              >
                {theme === "sepia" ? "🌙" : "☀️"}
              </button>
              <button
                onClick={() => router.push("/vocabulary")}
                className="h-9 px-3 rounded-full border text-sm font-serif transition-colors"
                style={{ borderColor: t.border, color: t.muted }}
              >
                Notebook
              </button>
              <button
                onClick={async () => { await logout(); router.push("/") }}
                className="h-9 px-3 rounded-full border text-sm font-serif transition-colors"
                style={{ borderColor: t.border, color: t.muted }}
              >
                Log out
              </button>
            </div>
          </div>

          {/* Primary actions — stack on mobile, inline on desktop */}
          <div className="flex flex-col sm:flex-row gap-2">
            <label
              className="flex items-center justify-center cursor-pointer w-full sm:w-auto px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60"
              style={{ background: t.primaryBg, color: t.primaryText }}
            >
              {uploading ? uploadStatus || "Uploading…" : "+ Add Book"}
              <input
                type="file"
                accept=".epub"
                className="hidden"
                onChange={handleUpload}
                disabled={uploading}
              />
            </label>
            <button
              onClick={() => { setSearchOpen(true); setSearchQuery(""); setSearchResults([]) }}
              className="flex items-center justify-center w-full sm:w-auto px-4 py-2.5 rounded-lg text-sm font-medium border transition-colors"
              style={{ borderColor: t.border, color: t.text, background: t.surface }}
            >
              🔍 Search catalog
            </button>
          </div>
        </header>

        {error && <p className="text-red-600 mb-4 text-sm">{error}</p>}

        {books.length === 0 ? (
          <p className="text-center mt-20" style={{ color: t.muted }}>
            No books yet. Upload your first .epub to get started.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 sm:gap-6">
            {books.map((book) => (
              <div key={book.id} className="group relative flex flex-col items-center gap-2">

                {/* Delete button — always visible on mobile, hover-only on desktop */}
                <button
                  onClick={() => setPendingDelete(book)}
                  disabled={deletingId === book.id}
                  className="absolute top-1 right-1 z-10 w-7 h-7 rounded-full text-xs flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 transition-opacity disabled:opacity-40"
                  style={{ background: t.primaryBg, color: t.primaryText }}
                  title="Remove from library"
                >
                  {deletingId === book.id ? "…" : "✕"}
                </button>

                {/* Book cover — clicking opens the reader */}
                <button
                  onClick={() => router.push(`/home?bookUrl=${encodeURIComponent(book.book_url)}&bookId=${book.id}`)}
                  className="w-full text-left"
                >
                  <div className="w-full aspect-[2/3] rounded-sm shadow-md overflow-hidden group-hover:shadow-lg transition-shadow" style={{ background: t.coverBg }}>
                    {book.cover_url ? (
                      <img
                        src={book.cover_url}
                        alt={book.title ?? "Book cover"}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-end p-3">
                        <span className="text-xs font-serif line-clamp-3 leading-snug" style={{ color: t.text }}>
                          {book.title ?? "Untitled"}
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="block text-sm font-serif text-center line-clamp-2 mt-2" style={{ color: t.text }}>
                    {book.title ?? "Untitled"}
                  </span>
                </button>

              </div>
            ))}
          </div>
        )}

      </div>

      {/* ── Catalog search modal ──────────────────────────────────────────── */}
      {searchOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSearchOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            padding: 16, paddingTop: "8vh",
            background: "rgba(20,16,12,0.5)", backdropFilter: "blur(2px)",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full flex flex-col"
            style={{
              maxWidth: 520, maxHeight: "80vh",
              background: t.surface, border: `1px solid ${t.border}`,
              borderRadius: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.3)", overflow: "hidden",
            }}
          >
            <div className="p-4 sm:p-5" style={{ borderBottom: `1px solid ${t.border}` }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-serif" style={{ color: t.text }}>Search the catalog</h3>
                <button onClick={() => setSearchOpen(false)} style={{ color: t.muted, fontSize: "1.1rem" }} aria-label="Close">✕</button>
              </div>
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search books by title…"
                className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                style={{ background: t.bg, border: `1px solid ${t.border}`, color: t.text }}
              />
            </div>

            <div className="overflow-y-auto p-2 sm:p-3">
              {searching ? (
                <p className="text-center py-8 text-sm" style={{ color: t.muted }}>Searching…</p>
              ) : searchQuery.trim() === "" ? (
                <p className="text-center py-8 text-sm" style={{ color: t.muted }}>
                  Type a title to find books other readers have uploaded.
                </p>
              ) : searchResults.length === 0 ? (
                <p className="text-center py-8 text-sm" style={{ color: t.muted }}>
                  No books found. Upload it yourself with “+ Add Book”.
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {searchResults.map(r => {
                    const owned = ownedCatalogIds.has(r.id)
                    return (
                      <li key={r.id} className="flex items-center gap-3 p-2 rounded-lg" style={{ background: t.bg }}>
                        <div className="w-10 h-14 flex-shrink-0 rounded-sm overflow-hidden" style={{ background: t.coverBg }}>
                          {r.cover_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={r.cover_url} alt="" className="w-full h-full object-cover" />
                          )}
                        </div>
                        <span className="flex-1 text-sm font-serif line-clamp-2" style={{ color: t.text }}>
                          {r.title ?? "Untitled"}
                        </span>
                        <button
                          onClick={() => handleAddFromCatalog(r)}
                          disabled={owned || addingId === r.id}
                          className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50"
                          style={owned
                            ? { background: "transparent", color: t.muted, border: `1px solid ${t.border}` }
                            : { background: t.primaryBg, color: t.primaryText }}
                        >
                          {owned ? "✓ In library" : addingId === r.id ? "Adding…" : "+ Add"}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Corrupted-EPUB modal ──────────────────────────────────────────── */}
      {invalidMsg && (
        <ModalOverlay onClose={() => setInvalidMsg(null)} t={t}>
          <div style={{ fontSize: "2.4rem", marginBottom: 12 }}>📕</div>
          <h3 className="text-lg font-serif mb-2" style={{ color: t.text }}>
            Couldn&apos;t add this book
          </h3>
          <p className="text-sm mb-6 leading-relaxed" style={{ color: t.muted }}>
            {invalidMsg}
          </p>
          <button
            onClick={() => setInvalidMsg(null)}
            className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors"
            style={{ background: t.primaryBg, color: t.primaryText }}
          >
            OK
          </button>
        </ModalOverlay>
      )}

      {/* ── Delete-confirmation modal (replaces window.confirm) ───────────── */}
      {pendingDelete && (
        <ModalOverlay onClose={() => setPendingDelete(null)} t={t}>
          <div style={{ fontSize: "2.4rem", marginBottom: 12 }}>🗑️</div>
          <h3 className="text-lg font-serif mb-2" style={{ color: t.text }}>
            Remove from library?
          </h3>
          <p className="text-sm mb-6 leading-relaxed" style={{ color: t.muted }}>
            &ldquo;{pendingDelete.title ?? "This book"}&rdquo; will be permanently deleted from your library.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => setPendingDelete(null)}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors"
              style={{ borderColor: t.border, color: t.muted, background: "transparent" }}
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors text-white"
              style={{ background: "#a13226" }}
            >
              Remove
            </button>
          </div>
        </ModalOverlay>
      )}
    </main>
  )
}

// Shared modal shell — dim backdrop + centered card, theme-aware, click-outside
// to dismiss. Keeps the corrupted + delete modals visually consistent.
function ModalOverlay({ children, onClose, t }: {
  children: React.ReactNode
  onClose: () => void
  t: (typeof THEMES)[Theme]
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, background: "rgba(20,16,12,0.5)", backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full text-center"
        style={{
          maxWidth: 360,
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 16,
          padding: "28px 24px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.3)",
        }}
      >
        {children}
      </div>
    </div>
  )
}

export default function LibraryPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen flex items-center justify-center" style={{ background: THEMES.sepia.bg }}>
        <p className="font-serif" style={{ color: THEMES.sepia.muted }}>Loading library…</p>
      </main>
    }>
      <Library />
    </Suspense>
  )
}
