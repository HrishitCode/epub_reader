"use client"

import { useEffect } from "react"

// Registers the service worker (production only — in dev it would serve
// stale chunks and fight hot reload).
export default function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return
    if (!("serviceWorker" in navigator)) return
    navigator.serviceWorker.register("/sw.js").catch(() => {})
  }, [])
  return null
}
