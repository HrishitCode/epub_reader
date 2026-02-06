"use client";

import { useState, useEffect, FormEvent, FormEventHandler } from "react";
import { login, signup } from "./lib/supabase/auth";
import { getBooks } from "./lib/supabase/queries";
import { useRouter } from "next/navigation";

type AuthMode = "login" | "signup";

export default function Page() {
  const router = useRouter()
  const [mode, setMode] = useState<AuthMode>("login");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [email, setEmail] = useState("");

  const toggleMode = () => {
    setMode((prev) => (prev === "login" ? "signup" : "login"));
    setEmail("");
    setPassword("");
    setConfirmPassword("");
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (mode === "signup"){
      if (password === confirmPassword) {
        signup(email, password)
      }
      else {
        // throw an alert error here
        console.log("Not matching passwords") 
      }
    }
    else {
      const uid = await login(email, password)
      const books = await getBooks(uid)
      console.log(books)
      // router.push(`/home?bookUrl=${encodeURIComponent(books[0]['book_url'])}`);

    }
    console.log(email, password, confirmPassword);
  };

  return (
    <div>
      <h1>{mode === "login" ? "Log In" : "Sign Up"}</h1>
      <button type="button" onClick={toggleMode}>
        Switch To {mode === "login" ? "signup" : "login"}
      </button>
      <form onSubmit={handleSubmit}>
        <input name="email" 
               value={email}
               placeholder={mode === "login" ? "Email" : "Register Email"}
               onChange={(e) => setEmail(e.target.value)}
        />
        <input name="password"
               type="password"
               value={password}
               placeholder="Password"
               onChange={(e) => setPassword(e.target.value)}
        />
        {mode === "signup" &&
          <input name="confirmPassword" 
               type="password" 
               value={confirmPassword}
               placeholder="Confirm Password"
               onChange={(e) => setConfirmPassword(e.target.value)}
        />
        }
        <button type="submit">{mode === "login" ? "Login" : "Sign Up"}</button>
      </form>
    </div>
  );
}
