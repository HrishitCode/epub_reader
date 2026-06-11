"use client"

import { useEffect, useState, Suspense } from "react"
import { useRouter } from "next/navigation"
import { unzipSync, strFromU8 } from "fflate"
import { getBooks, getUserId, insertBook, uploadFile, uploadCover, getBookUrl, deleteBook } from "../lib/supabase/queries"
import { logout } from "../lib/supabase/auth"

type Book = {
  id: number
  title: string | null
  book_url: string
  cover_url: string | null
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

function Library() {
  const router = useRouter()
  const [books, setBooks] = useState<Book[]>([])
  const [uid, setUid] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  useEffect(() => {
    getUserId()
      .then(async (id) => {
        setUid(id)
        const data = await getBooks(id)
        setBooks(data as Book[])
      })
      .catch(() => router.push("/"))
  }, [router])

  const handleDelete = async (book: Book) => {
    if (!confirm(`Remove "${book.title ?? "this book"}" from your library?`)) return
    setDeletingId(book.id)
    try {
      await deleteBook(book.id, book.book_url, book.cover_url)
      setBooks(prev => prev.filter(b => b.id !== book.id))
    } catch {
      setError("Could not delete book. Please try again.")
    } finally {
      setDeletingId(null)
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

      // 2. Extract title + cover from epub metadata (synchronous zip parsing — no epubjs)
      setUploadStatus("Reading book info…")
      const fallback = file.name.replace(".epub", "")
      const { title, coverBlob } = extractEpubMeta(buffer, fallback)
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
          <div className="flex items-center gap-3">
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
            <button
              onClick={() => router.push("/vocabulary")}
              className="text-sm font-serif text-[#7a6652] hover:text-[#3d2b1f] transition-colors"
            >
              Notebook
            </button>
            <button
              onClick={async () => { await logout(); router.push("/") }}
              className="text-sm font-serif text-[#7a6652] hover:text-[#3d2b1f] transition-colors"
            >
              Log out
            </button>
          </div>
        </div>

        {error && <p className="text-red-600 mb-4 text-sm">{error}</p>}

        {books.length === 0 ? (
          <p className="text-[#7a6652] text-center mt-20">
            No books yet. Upload your first .epub to get started.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-6">
            {books.map((book) => (
              <div key={book.id} className="group relative flex flex-col items-center gap-2">

                {/* Delete button — always visible on mobile, hover-only on desktop */}
                <button
                  onClick={() => handleDelete(book)}
                  disabled={deletingId === book.id}
                  className="absolute top-1 right-1 z-10 w-7 h-7 rounded-full bg-[#3d2b1f] text-[#f4f1ea] text-xs flex items-center justify-center sm:opacity-0 sm:group-hover:opacity-100 transition-opacity disabled:opacity-40"
                  title="Remove from library"
                >
                  {deletingId === book.id ? "…" : "✕"}
                </button>

                {/* Book cover — clicking opens the reader */}
                <button
                  onClick={() => router.push(`/home?bookUrl=${encodeURIComponent(book.book_url)}&bookId=${book.id}`)}
                  className="w-full text-left"
                >
                  <div className="w-full aspect-[2/3] rounded-sm shadow-md overflow-hidden group-hover:shadow-lg transition-shadow bg-[#d9cfc4]">
                    {book.cover_url ? (
                      <img
                        src={book.cover_url}
                        alt={book.title ?? "Book cover"}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-end p-3">
                        <span className="text-xs text-[#3d2b1f] font-serif line-clamp-3 leading-snug">
                          {book.title ?? "Untitled"}
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="block text-sm text-[#3d2b1f] font-serif text-center line-clamp-2 mt-2">
                    {book.title ?? "Untitled"}
                  </span>
                </button>

              </div>
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
