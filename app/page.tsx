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

  // If Supabase already has a session (token in localStorage), skip the login screen
  useEffect(() => {
    getExistingSession().then(uid => { if (uid) router.replace("/library") })
  }, [router])

  const toggleMode = () => {
    setMode(prev => prev === "login" ? "signup" : "login")
    setEmail("")
    setPassword("")
    setConfirmPassword("")
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === "signup") {
        if (password !== confirmPassword) { alert("Passwords don't match"); return }
        await signup(email, password)
        alert("Check your email to confirm your account, then log in.")
      } else {
        const uid = await login(email, password)
        if (uid) router.push("/library")
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setLoading(false)
    }
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
