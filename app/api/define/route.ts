import { NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest) {
  const word = req.nextUrl.searchParams.get("word")
  if (!word) return NextResponse.json(null, { status: 400 })

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
