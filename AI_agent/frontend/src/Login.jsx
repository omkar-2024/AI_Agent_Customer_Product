import { useState } from "react";
import { ArrowUp, Bot, LockKeyhole, Mail } from "lucide-react";
import { supabase } from "./App";

export default function Login({ onRegister }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (signInError) setError(signInError.message);
    setBusy(false);
  }

  return (
    <main className="chat-auth-page">
      <div className="auth-chat-brand"><span className="auth-brand-icon"><Bot size={18} /></span>CommerceLens AI</div>
      <section className="chat-auth-card">
        <div className="auth-bot-icon"><Bot size={25} /></div>
        <h1>Welcome back</h1>
        <p className="auth-description">Sign in and chat with your ecommerce data through your assigned RBAC permissions.</p>
        <form onSubmit={submit} className="chat-auth-form">
          <label>Email
            <div className="auth-input-wrap"><Mail size={16} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" required /></div>
          </label>
          <label>Password
            <div className="auth-input-wrap"><LockKeyhole size={16} /><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" autoComplete="current-password" required /></div>
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-send" disabled={busy}>{busy ? "Signing in…" : "Continue to chat"}<ArrowUp size={17} /></button>
        </form>
        <div className="auth-divider"><span /> <em>new here?</em> <span /></div>
        <button className="auth-switch" onClick={onRegister}>Create your account</button>
        <div className="auth-features"><span><Bot size={13} /> Ecommerce AI</span><span>•</span><span>RBAC protected</span></div>
      </section>
    </main>
  );
}
