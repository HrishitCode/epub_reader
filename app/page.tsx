"use client"

import { useState, useEffect } from "react"
import { login, signup, getExistingSession } from "./lib/supabase/auth"
import { useRouter } from "next/navigation"

type AuthMode = "login" | "signup"

export default function Page() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>("login")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [signupEmail, setSignupEmail] = useState<string | null>(null)  // non-null → show "check your email" modal

  // If Supabase already has a session (token in localStorage), skip the login screen
  useEffect(() => {
    getExistingSession().then(uid => { if (uid) router.replace("/library") })
  }, [router])

  const toggleMode = () => {
    setMode(prev => prev === "login" ? "signup" : "login")
    setEmail("")
    setPassword("")
    setConfirmPassword("")
    setFormError(null)
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setFormError(null)
    setLoading(true)
    try {
      if (mode === "signup") {
        if (password !== confirmPassword) { setFormError("Passwords don't match"); return }
        await signup(email, password)
        setSignupEmail(email)   // open the "check your email" modal
      } else {
        const uid = await login(email, password)
        if (uid) router.push("/library")
      }
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
  }

  // After confirming the signup modal, switch to login mode with email prefilled
  const dismissSignupModal = () => {
    const confirmedEmail = signupEmail
    setSignupEmail(null)
    setMode("login")
    setEmail(confirmedEmail ?? "")
    setPassword("")
    setConfirmPassword("")
  }

  return (
    <main style={{
      minHeight: "100vh",
      background: "#f4f1ea",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 16px",
      fontFamily: "Georgia, 'Times New Roman', serif",
    }}>
      <div style={{ width: "100%", maxWidth: 400 }}>

        {/* Logo / title */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ fontSize: "2.2rem", marginBottom: 8 }}>📖</div>
          <h1 style={{ fontSize: "1.8rem", color: "#3d2b1f", margin: 0, fontWeight: "normal",
            letterSpacing: "0.02em" }}>
            My Library
          </h1>
          <p style={{ color: "#a89880", fontSize: "0.9rem", marginTop: 6 }}>
            Your personal reading space
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "#fffdf8",
          border: "1px solid #d4cfc6",
          borderRadius: 12,
          padding: "32px 28px",
          boxShadow: "0 4px 24px rgba(61,43,31,0.08)",
        }}>
          <h2 style={{ margin: "0 0 24px", fontSize: "1.15rem", color: "#3d2b1f",
            fontWeight: "normal", textAlign: "center" }}>
            {mode === "login" ? "Welcome back" : "Create an account"}
          </h2>

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={email}
                placeholder="you@example.com"
                onChange={e => setEmail(e.target.value)}
                required
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = "#a89880"}
                onBlur={e => e.target.style.borderColor = "#d4cfc6"}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={labelStyle}>Password</label>
              <input
                type="password"
                value={password}
                placeholder="••••••••"
                onChange={e => setPassword(e.target.value)}
                required
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = "#a89880"}
                onBlur={e => e.target.style.borderColor = "#d4cfc6"}
              />
            </div>

            {mode === "signup" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={labelStyle}>Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  placeholder="••••••••"
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = "#a89880"}
                  onBlur={e => e.target.style.borderColor = "#d4cfc6"}
                />
              </div>
            )}

            {formError && (
              <div style={{
                background: "#fdecea",
                border: "1px solid #f0c4be",
                color: "#a13226",
                fontSize: "0.85rem",
                padding: "10px 12px",
                borderRadius: 8,
              }}>
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                marginTop: 8,
                padding: "12px",
                background: loading ? "#c4b09a" : "#3d2b1f",
                color: "#f4f1ea",
                border: "none",
                borderRadius: 8,
                fontSize: "1rem",
                fontFamily: "Georgia, serif",
                cursor: loading ? "not-allowed" : "pointer",
                transition: "background 0.2s",
              }}
            >
              {loading ? "Please wait…" : mode === "login" ? "Log In" : "Sign Up"}
            </button>
          </form>

          {/* Divider */}
          <div style={{ margin: "24px 0 0", textAlign: "center" }}>
            <span style={{ color: "#a89880", fontSize: "0.88rem" }}>
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
            </span>
            <button
              type="button"
              onClick={toggleMode}
              style={{ background: "none", border: "none", cursor: "pointer",
                color: "#7a6652", fontSize: "0.88rem", fontFamily: "Georgia, serif",
                textDecoration: "underline", padding: 0 }}
            >
              {mode === "login" ? "Sign up" : "Log in"}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p style={{ textAlign: "center", color: "#c4b09a", fontSize: "0.78rem", marginTop: 24 }}>
          Your books, your notes, your words.
        </p>
      </div>

      {/* ── "Check your email" modal (replaces the default browser alert) ──── */}
      {signupEmail && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={dismissSignupModal}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(61,43,31,0.45)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            zIndex: 1000,
            animation: "fadeIn 0.18s ease-out",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 380,
              background: "#fffdf8",
              border: "1px solid #d4cfc6",
              borderRadius: 16,
              padding: "32px 28px",
              textAlign: "center",
              boxShadow: "0 12px 40px rgba(61,43,31,0.22)",
              animation: "popIn 0.2s ease-out",
            }}
          >
            <div style={{ fontSize: "2.6rem", marginBottom: 12 }}>✉️</div>
            <h3 style={{ margin: "0 0 10px", fontSize: "1.25rem", color: "#3d2b1f", fontWeight: "normal" }}>
              Confirm your email
            </h3>
            <p style={{ margin: "0 0 6px", color: "#7a6652", fontSize: "0.92rem", lineHeight: 1.5 }}>
              We&apos;ve sent a confirmation link to
            </p>
            <p style={{ margin: "0 0 20px", color: "#3d2b1f", fontSize: "0.95rem", fontWeight: 600, wordBreak: "break-all" }}>
              {signupEmail}
            </p>
            <p style={{ margin: "0 0 24px", color: "#a89880", fontSize: "0.85rem", lineHeight: 1.5 }}>
              Click the link in that email, then come back here to log in.
            </p>
            <button
              onClick={dismissSignupModal}
              style={{
                width: "100%",
                padding: "12px",
                background: "#3d2b1f",
                color: "#f4f1ea",
                border: "none",
                borderRadius: 8,
                fontSize: "0.98rem",
                fontFamily: "Georgia, serif",
                cursor: "pointer",
              }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes popIn  { from { opacity: 0; transform: scale(0.94) } to { opacity: 1; transform: scale(1) } }
      `}</style>
    </main>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: "0.82rem",
  color: "#7a6652",
  fontFamily: "Georgia, serif",
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: "1px solid #d4cfc6",
  borderRadius: 8,
  fontSize: "0.95rem",
  fontFamily: "Georgia, serif",
  background: "#faf8f4",
  color: "#3d2b1f",
  outline: "none",
  transition: "border-color 0.15s",
  width: "100%",
  boxSizing: "border-box",
}
