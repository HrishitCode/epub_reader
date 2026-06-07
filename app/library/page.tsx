"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter } from "next/navigation"
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Epub = require("epubjs").default ?? require("epubjs")
import { getBooks, getUserId, insertBook, uploadFile, uploadCover, getBookUrl } from "../lib/supabase/queries"

type Book = {
  id: number
  title: string | null
  book_url: string
  cover_url: string | null
}

type EpubMeta = { title: string; coverBlob: Blob | null }

// Extract title + cover from an epub ArrayBuffer in one pass.
async function extractEpubMeta(buffer: ArrayBuffer, fallbackTitle: string): Promise<EpubMeta> {
  try {
    const book = Epub(buffer as any)
    await book.ready

    // Title from epub metadata (falls back to filename if empty)
    const metaTitle: string = book.packaging?.metadata?.title?.trim() || fallbackTitle

    // Cover image
    let coverBlob: Blob | null = null
    const coverUrl: string | null = await book.coverUrl()
    if (coverUrl) {
      const res = await fetch(coverUrl)
      coverBlob = await res.blob()
    }

    book.destroy()
    return { title: metaTitle, coverBlob }
  } catch (e) {
    console.warn("epub meta extraction failed:", e)
    return { title: fallbackTitle, coverBlob: null }
  }
}

function Library() {
  const router = useRouter()
  const [books, setBooks] = useState<Book[]>([])
  const [uid, setUid] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getUserId()
      .then(async (id) => {
        setUid(id)
        const data = await getBooks(id)
        setBooks(data as Book[])
      })
      .catch(() => router.push("/"))
  }, [router])

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

      // 2. Extract title + cover from epub metadata
      setUploadStatus("Reading book info…")
      const fallback = file.name.replace(".epub", "")
      const { title, coverBlob } = await extractEpubMeta(buffer, fallback)
      console.log("✅ epub title:", title, "| has cover:", !!coverBlob)

      // 3. Upload epub file
      setUploadStatus("Uploading book…")
      const uploaded = await uploadFile(buffer, uid, file.name)
      const { publicUrl: bookPublicUrl } = await getBookUrl(uploaded.path)

      // 4. Upload cover (best-effort — a missing cover won't block the upload)
      setUploadStatus("Uploading cover…")
      let coverPublicUrl: string | undefined
      if (coverBlob) {
        const coverUploaded = await uploadCover(coverBlob, uid, fallback)
        const { publicUrl } = await getBookUrl(coverUploaded.path)
        coverPublicUrl = publicUrl
      }

      // 5. Save to DB
      setUploadStatus("Saving…")
      await insertBook(uid, bookPublicUrl, title, coverPublicUrl)

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
    <main className="min-h-screen bg-[#f4f1ea] px-6 py-10">
      <div className="max-w-4xl mx-auto">

        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-serif text-[#3d2b1f]">My Library</h1>
          <label className="cursor-pointer bg-[#3d2b1f] text-[#f4f1ea] px-4 py-2 rounded text-sm hover:bg-[#5a3e2b] transition-colors">
            {uploading ? uploadStatus || "Uploading…" : "+ Add Book"}
            <input
              type="file"
              accept=".epub"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
          </label>
        </div>

        {error && <p className="text-red-600 mb-4 text-sm">{error}</p>}

        {books.length === 0 ? (
          <p className="text-[#7a6652] text-center mt-20">
            No books yet. Upload your first .epub to get started.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
            {books.map((book) => (
              <button
                key={book.id}
                onClick={() => router.push(`/home?bookUrl=${encodeURIComponent(book.book_url)}`)}
                className="group flex flex-col items-center gap-2 text-left"
              >
                <div className="w-full aspect-[2/3] rounded-sm shadow-md overflow-hidden group-hover:shadow-lg transition-shadow bg-[#d9cfc4]">
                  {book.cover_url ? (
                    <img
                      src={book.cover_url}
                      alt={book.title ?? "Book cover"}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    // Fallback: decorative placeholder with title
                    <div className="w-full h-full flex items-end p-3">
                      <span className="text-xs text-[#3d2b1f] font-serif line-clamp-3 leading-snug">
                        {book.title ?? "Untitled"}
                      </span>
                    </div>
                  )}
                </div>
                <span className="text-sm text-[#3d2b1f] font-serif text-center line-clamp-2">
                  {book.title ?? "Untitled"}
                </span>
              </button>
            ))}
          </div>
        )}

      </div>
    </main>
  )
}

export default function LibraryPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-[#f4f1ea] flex items-center justify-center">
        <p className="text-[#7a6652] font-serif">Loading library…</p>
      </main>
    }>
      <Library />
    </Suspense>
  )
}
