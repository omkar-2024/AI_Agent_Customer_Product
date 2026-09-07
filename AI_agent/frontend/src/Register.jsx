import { useState } from "react";
import { ArrowUp, Bot, LockKeyhole, Mail, UserRound } from "lucide-react";
import { supabase } from "./App";

const apiUrl = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function friendlySignupError(error) {
  const code = error?.code || "";
  const message = (error?.message || "").toLowerCase();
  if (code === "over_email_send_rate_limit" || message.includes("email rate limit") || message.includes("email limit")) {
    return "Supabase is trying to send an email. Turn off Confirm email for the Email provider in Supabase Authentication settings, then register again.";
  }
  if (message.includes("already registered") || message.includes("already been registered") || message.includes("user already exists")) {
    return "An account with this email already exists. Please sign in instead.";
  }
  return error?.message || "Could not create the account.";
}

export default function Register({ onLogin }) {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const email = form.email.trim().toLowerCase();
      const fullName = form.name.trim();
      if (fullName.length < 2) throw new Error("Please enter your full name.");

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: { data: { full_name: fullName } },
      });
      if (signUpError) throw signUpError;
      if (!data.session) {
        throw new Error("Email confirmation is enabled. Turn off Confirm email in Supabase so new users can enter the app immediately.");
      }

      const response = await fetch(`${apiUrl}/auth/sync-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ full_name: fullName, password: form.password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.detail || "Your login account was created, but the application profile could not be completed.");
    } catch (signupError) {
      setError(friendlySignupError(signupError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="chat-auth-page register-page">
      <div className="auth-chat-brand"><span className="auth-brand-icon"><Bot size={18} /></span> CommerceLens AI</div>
      <section className="chat-auth-card register-card">
        <div className="auth-bot-icon"><Bot size={25} /></div>
        <h1>Start a new chat</h1>
        <p className="auth-description">Create your account and Northstar will set up your ecommerce workspace automatically.</p>

        {/* <div className="signup-preview">
          <div><span className="preview-dot" /><strong>Default workspace</strong></div>
          <div><span>Role</span><b>sales_manager</b></div>
          <div><span>Department</span><b>Sales</b></div>
        </div> */}

        <form onSubmit={submit} className="chat-auth-form">
          <label>Full name
            <div className="auth-input-wrap"><UserRound size={16} /><input name="name" value={form.name} onChange={update} placeholder="Your name" autoComplete="name" required /></div>
          </label>
          <label>Email
            <div className="auth-input-wrap"><Mail size={16} /><input name="email" type="email" value={form.email} onChange={update} placeholder="you@company.com" autoComplete="email" required /></div>
          </label>
          <label>Password
            <div className="auth-input-wrap"><LockKeyhole size={16} /><input name="password" type="password" minLength="6" value={form.password} onChange={update} placeholder="At least 6 characters" autoComplete="new-password" required /></div>
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-send" disabled={busy}>{busy ? "Setting up your workspace…" : "Create account"}<ArrowUp size={17} /></button>
        </form>
        <div className="auth-divider"><span /> <em>already have an account?</em> <span /></div>
        <button className="auth-switch" onClick={onLogin}>Sign in instead</button>
        <div className="auth-features"><span>Instant access</span><span>•</span><span>RBAC protected</span><span>•</span><span>Sales workspace</span></div>
      </section>
    </main>
  );
}
