"use client"

import { useState } from "react"
import { getBookUrl, getUserId, insertBook, uploadFile } from "../lib/supabase/queries"

export default function EpubUploader() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith(".epub")) {
      setError("Only .epub files are allowed")
      return
    }

    try {
      setLoading(true)
      setError(null)
      setSuccess(false)

      const arrayBuffer = await file.arrayBuffer()
      const uploaded = await uploadFile(arrayBuffer)
      console.log(uploaded)
      const publicUrl = await getBookUrl(uploaded.fullPath)
      console.log(publicUrl)
      const uid = await getUserId()
      console.log(uid)
      await insertBook(uid, publicUrl)
      setSuccess(true)
    } catch (err) {
      console.error(err)
      setError("Upload failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: "20px", borderBottom: "1px solid #ddd" }}>
      <h3>Upload EPUB</h3>

      <input
        type="file"
        accept=".epub"
        onChange={handleFileChange}
        disabled={loading}
      />

      {loading && <p>Uploading...</p>}
      {success && <p style={{ color: "green" }}>Upload successful</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  )
}