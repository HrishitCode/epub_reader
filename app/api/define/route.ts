import { NextRequest, NextResponse } from "next/server"

// Dictionary words only: letters, apostrophes, hyphens — and a sane length cap.
// This route proxies to an external API, so the input must be tightly shaped
// (no path tricks, no abuse as a generic fetch relay).
const WORD_RE = /^[a-zA-Z][a-zA-Z'-]{0,49}$/

export async function GET(req: NextRequest) {
  const word = req.nextUrl.searchParams.get("word")
  if (!word || !WORD_RE.test(word)) return NextResponse.json(null, { status: 400 })

  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`
    )
    if (!res.ok) return NextResponse.json(null, { status: res.status })
    const data = await res.json()
    return NextResponse.json(data[0] ?? null)
  } catch {
    return NextResponse.json(null, { status: 502 })
  }
}
