import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  Download,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Plus,
  Send,
  ShieldCheck,
  User,
  UserRound,
  X,
} from 'lucide-react'
import { createClient } from '@supabase/supabase-js'

const API_URL = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim()
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
const supabase = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null

function friendlySignupError(error) {
  const code = error?.code || ''
  const message = (error?.message || '').toLowerCase()

  if (code === 'over_email_send_rate_limit' || message.includes('email rate limit') || message.includes('email limit')) {
    return 'Supabase is trying to send an email. Turn off Confirm email for the Email provider in Supabase Authentication settings, then register again.'
  }

  if (message.includes('already registered') || message.includes('already been registered') || message.includes('user already exists')) {
    return 'An account with this email already exists. Please sign in instead.'
  }

  return error?.message || 'Could not create the account.'
}

function AuthShell({ mode, setMode }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const registering = mode === 'register'

  function update(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }))
  }

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')

    try {
      const email = form.email.trim().toLowerCase()
      if (!registering) {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: form.password })
        if (signInError) throw signInError
        return
      }

      const fullName = form.name.trim()
      if (fullName.length < 2) throw new Error('Please enter your full name.')

      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password: form.password,
        options: { data: { full_name: fullName } },
      })
      if (signUpError) throw signUpError
      if (!data.session) {
        throw new Error('Email confirmation is enabled. Turn off Confirm email in Supabase so new users can enter the app immediately.')
      }

      const response = await fetch(`${API_URL}/auth/sync-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ full_name: fullName, password: form.password }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body.detail || 'Your login account was created, but the application profile could not be completed.')
      }
    } catch (authError) {
      setError(registering ? friendlySignupError(authError) : authError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="chat-auth-page">
      <div className="auth-chat-brand">
        <span className="auth-brand-icon"><Bot size={18} /></span>
        CommerceLens AI
      </div>
      <section className="chat-auth-card">
        <div className="auth-bot-icon"><Bot size={25} /></div>
        <h1>{registering ? 'Start a new chat' : 'Welcome back'}</h1>
        <p className="auth-description">
          {registering
            ? 'Create your account and Northstar will set up your ecommerce workspace automatically.'
            : 'Sign in and chat with your ecommerce data through your assigned RBAC permissions.'}
        </p>

        <form onSubmit={submit} className="chat-auth-form">
          {registering && (
            <label>
              Full name
              <div className="auth-input-wrap">
                <UserRound size={16} />
                <input name="name" value={form.name} onChange={update} placeholder="Your name" autoComplete="name" required />
              </div>
            </label>
          )}
          <label>
            Email
            <div className="auth-input-wrap">
              <Mail size={16} />
              <input name="email" type="email" value={form.email} onChange={update} placeholder="you@company.com" autoComplete="email" required />
            </div>
          </label>
          <label>
            Password
            <div className="auth-input-wrap">
              <LockKeyhole size={16} />
              <input
                name="password"
                type="password"
                minLength={registering ? 6 : undefined}
                value={form.password}
                onChange={update}
                placeholder={registering ? 'At least 6 characters' : 'Your password'}
                autoComplete={registering ? 'new-password' : 'current-password'}
                required
              />
            </div>
          </label>
          {error && <div className="auth-error">{error}</div>}
          <button className="auth-send" disabled={busy}>
            {busy ? (registering ? 'Setting up your workspace…' : 'Signing in…') : (registering ? 'Create account' : 'Continue to chat')}
            <Send size={17} />
          </button>
        </form>

        <div className="auth-divider"><span /><em>{registering ? 'already have an account?' : 'new here?'}</em><span /></div>
        <button className="auth-switch" type="button" onClick={() => setMode(registering ? 'login' : 'register')}>
          {registering ? 'Sign in instead' : 'Create your account'}
        </button>
        <div className="auth-features">
          <span><Bot size={13} /> Ecommerce AI</span><span>•</span><span>RBAC protected</span>
        </div>
      </section>
    </main>
  )
}

function artifactFromAnswer(text) {
  if (typeof text !== 'string') return null
  const objectMatch = text.match(/\{[\s\S]*\}/)?.[0]
  for (const candidate of [text.trim(), objectMatch]) {
    if (!candidate) continue
    try {
      const parsed = JSON.parse(candidate)
      if (parsed?.success && parsed?.file && ['document', 'visualization'].includes(parsed.type)) return parsed
    } catch {
      // The assistant answer does not have to be JSON.
    }
  }

  const match =
    text.match(/(?:generated_reports[\\/])([^\s"'}`]+\.(?:docx|png))/i) ||
    text.match(/\b((?:report|chart)_[a-f0-9]+\.(?:docx|png))\b/i)
  if (!match) return null
  const file = match[1]
  return { success: true, type: file.toLowerCase().endsWith('.png') ? 'visualization' : 'document', file }
}

function Chat({ session }) {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState([])
  const [rbac, setRbac] = useState(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const conversationRef = useRef(null)
  const inputRef = useRef(null)

  const fullName = session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'there'
  const firstName = fullName.split(/\s+/)[0]
  const initials = fullName.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()

  useEffect(() => {
    inputRef.current?.focus()
    loadRbac()
  }, [])

  useEffect(() => {
    conversationRef.current?.scrollTo({ top: conversationRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, progress])

  async function getActiveSession(refresh = false) {
    const result = refresh ? await supabase.auth.refreshSession() : await supabase.auth.getSession()
    if (result.error || !result.data.session) throw new Error('Your session expired. Please sign in again.')
    return result.data.session
  }

  async function loadRbac() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const activeSession = await getActiveSession()
        const response = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${activeSession.access_token}` },
        })
        if (response.ok) {
          setRbac(await response.json())
          return
        }
      } catch {
        // Registration sync can finish just after authentication.
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
    }
  }

  async function downloadArtifact(file) {
    try {
      const activeSession = await getActiveSession()
      const filename = file.split(/[\\/]/).pop()
      const response = await fetch(`${API_URL}/reports/${encodeURIComponent(filename)}`, {
        headers: { Authorization: `Bearer ${activeSession.access_token}` },
      })
      if (!response.ok) throw new Error('The generated file could not be downloaded.')

      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', error: true, text: error.message }])
    }
  }

  function newChat() {
    if (busy) return
    setMessages([])
    setProgress([])
    setQuery('')
    setSidebarOpen(false)
    inputRef.current?.focus()
  }

  function applyStreamEvent(streamEvent) {
    if (streamEvent.type === 'progress') {
      setProgress((current) => current.includes(streamEvent.message) ? current : [...current, streamEvent.message])
      return false
    }
    if (streamEvent.type === 'answer') {
      setMessages((current) => [...current, {
        role: 'assistant',
        text: streamEvent.answer || '',
        artifacts: Array.isArray(streamEvent.artifacts) ? streamEvent.artifacts : [],
      }])
      return true
    }
    if (streamEvent.type === 'error') throw new Error(streamEvent.message)
    return false
  }

  async function submit(event) {
    event.preventDefault()
    const text = query.trim()
    if (!text || busy) return

    setQuery('')
    setBusy(true)
    setProgress(['Understanding your question'])
    setMessages((current) => [...current, { role: 'user', text }])

    try {
      const activeSession = await getActiveSession(true)
      const response = await fetch(`${API_URL}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
          Authorization: `Bearer ${activeSession.access_token}`,
        },
        body: JSON.stringify({ query: text }),
      })

      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail || 'Request failed.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let answered = false

      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          answered = applyStreamEvent(JSON.parse(line)) || answered
        }
      }

      buffer += decoder.decode()
      if (buffer.trim()) answered = applyStreamEvent(JSON.parse(buffer)) || answered
      if (!answered) throw new Error('The server closed the request before returning an answer.')
    } catch (error) {
      setMessages((current) => [...current, { role: 'assistant', error: true, text: error.message }])
    } finally {
      setBusy(false)
      setProgress([])
      inputRef.current?.focus()
    }
  }

  const suggestions = [
    'Which products have the lowest stock?',
    'Show total order revenue by month',
    'Which regions have the highest order volume?',
  ]

  return (
    <div className="gpt-shell">
      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}

      <aside className={`gpt-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="gpt-brand"><span className="brand-dot"><Bot size={13} /></span> Northstar</div>
          <button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={18} /></button>
        </div>
        <button className="new-chat" onClick={newChat}><Plus size={17} /> New chat</button>

        <div className="sidebar-label">Workspace</div>
        <div className="workspace-card">
          <ShieldCheck size={16} />
          <div><strong>RBAC protected</strong><span>{rbac?.roles?.join(', ') || 'Loading role…'}</span></div>
        </div>

        <div className="sidebar-label">Allowed data</div>
        <div className="access-list">{(rbac?.allowed_tables || []).map((table) => <span key={table}>{table}</span>)}</div>

        <div className="sidebar-bottom">
          <div className="account-row">
            <div className="account-avatar">{initials || <User size={14} />}</div>
            <div className="account-copy"><strong>{fullName}</strong><span>{session.user.email}</span></div>
          </div>
          <button className="signout" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>

      <main className="gpt-main">
        <header className="gpt-topbar">
          <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar"><Menu size={20} /></button>
          <div className="model-name"><Bot size={18} /> CommerceLens AI <span>•</span> Ecommerce AI</div>
          <div className="top-role"><span className="online-dot" /> {rbac?.roles?.[0] || 'Secure session'}</div>
        </header>

        <section className={`conversation ${messages.length ? 'has-messages' : 'empty'}`} ref={conversationRef}>
          {!messages.length && !busy && (
            <div className="welcome">
              <div className="welcome-icon"><Bot size={24} /></div>
              <h1>How can I help you, {firstName}?</h1>
              <p>Ask questions about your ecommerce data. CommerceLens AI checks your RBAC permissions before it reads any database table.</p>
              <div className="suggestions">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} onClick={() => { setQuery(suggestion); inputRef.current?.focus() }}>{suggestion}</button>
                ))}
              </div>
            </div>
          )}

          <div className="message-list">
            {messages.map((message, index) => {
              const fallbackArtifact = artifactFromAnswer(message.text)
              const artifacts = message.artifacts?.length ? message.artifacts : fallbackArtifact ? [fallbackArtifact] : []
              return (
                <div className={`gpt-message ${message.role}`} key={`${message.role}-${index}`}>
                  {message.role === 'assistant' && <div className="message-avatar assistant"><Bot size={16} /></div>}
                  <div className={`message-content-wrap ${message.error ? 'error-wrap' : ''}`}>
                    <div className={`message-content ${message.error ? 'error' : ''}`}>{message.text}</div>
                    {!message.error && artifacts.length > 0 && (
                      <div className="artifact-list">
                        {artifacts.map((artifact) => (
                          <button className="download-report" key={artifact.file} onClick={() => downloadArtifact(artifact.file)}>
                            <Download size={15} /> {artifact.type === 'visualization' ? 'Download chart' : 'Download document'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {message.role === 'user' && <div className="message-avatar user"><span>{initials}</span></div>}
                </div>
              )
            })}

            {busy && (
              <div className="gpt-message assistant">
                <div className="message-avatar assistant"><Bot size={16} /></div>
                <div className="processing-card">
                  <div className="processing-heading"><span className="processing-spinner" /> Processing your query</div>
                  <div className="processing-current">{progress.at(-1) || 'Working on your request'}</div>
                  <div className="processing-steps-mini">
                    {progress.slice(-3).map((step, index) => <div key={`${step}-${index}`}><CheckCircle2 size={12} /> {step}</div>)}
                  </div>
                  <div className="processing-bar"><i /><i /><i /></div>
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="composer-wrap">
          <form className="gpt-composer" onSubmit={submit}>
            <textarea
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              placeholder="Message Northstar…"
              rows={1}
              disabled={busy}
              aria-label="Message Northstar"
            />
            <button className="composer-send" disabled={busy || !query.trim()} aria-label="Send"><Send size={17} /></button>
          </form>
          <div className="composer-note">Northstar can make mistakes. Check important business decisions.</div>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [mode, setMode] = useState('login')
  const [loading, setLoading] = useState(Boolean(supabase))

  useEffect(() => {
    if (!supabase) return undefined
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [])

  if (loading) return <div className="center-page">Loading...</div>
  if (!supabase) {
    return (
      <div className="center-page">
        <div className="auth-box config-panel">
          <h1>Supabase setup required</h1>
          <p>Put your Supabase URL and anon key in <b>frontend/.env</b>.</p>
        </div>
      </div>
    )
  }
  if (session) return <Chat session={session} />
  return <AuthShell mode={mode} setMode={setMode} />
}
