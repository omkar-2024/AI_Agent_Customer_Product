import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Check, Download, FileText, LogOut, Menu, Plus, ShieldCheck, User, X } from "lucide-react";
import { supabase } from "./App";

const apiUrl = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

function basename(filename) {
  return String(filename || "").split(/[\\/]/).pop();
}

function parseArtifactsFromText(text) {
  const artifacts = [];
  const seen = new Set();

  const addArtifact = (value) => {
    if (!value?.success || !value?.file) return;
    if (!["document", "visualization"].includes(value.type)) return;
    const file = basename(value.file);
    if (seen.has(file)) return;
    seen.add(file);
    artifacts.push({ ...value, file });
  };

  for (const candidate of [text.trim(), text.match(/\{[\s\S]*\}/)?.[0]]) {
    if (!candidate) continue;
    try {
      addArtifact(JSON.parse(candidate));
    } catch (_) {
      // The assistant may wrap the tool response in normal prose.
    }
  }

  const docMatch = text.match(/(?:generated_reports[\\/])?([^\s"'`}]+\.docx)/i)
    || text.match(/\b(report_[a-f0-9]+\.docx)\b/i);
  if (docMatch) addArtifact({ success: true, type: "document", format: "docx", file: basename(docMatch[1]) });

  const chartMatch = text.match(/(?:generated_reports[\\/])?([^\s"'`}]+\.png)/i)
    || text.match(/\b(chart_[a-f0-9]+\.png)\b/i);
  if (chartMatch) addArtifact({ success: true, type: "visualization", format: "png", file: basename(chartMatch[1]) });

  return artifacts;
}

function mergeArtifacts(primary = [], fallback = []) {
  const merged = [];
  const seen = new Set();
  for (const artifact of [...primary, ...fallback]) {
    const file = basename(artifact?.file);
    if (!file || seen.has(file)) continue;
    seen.add(file);
    merged.push({ ...artifact, file });
  }
  return merged;
}

function stripArtifactJson(text, artifacts) {
  let cleaned = text;
  for (const artifact of artifacts) {
    cleaned = cleaned.replace(JSON.stringify(artifact), "").trim();
    cleaned = cleaned.replace(artifact.file, "").trim();
    cleaned = cleaned.replace(artifact.message || "", "").trim();
  }
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

function ChartPreview({ filename, fetchArtifactUrl }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl = null;

    (async () => {
      try {
        objectUrl = await fetchArtifactUrl(filename);
        if (active && objectUrl) setSrc(objectUrl);
        else if (active) setFailed(true);
      } catch (_) {
        if (active) setFailed(true);
      }
    })();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [filename, fetchArtifactUrl]);

  if (failed) return null;
  if (!src) return <div className="artifact-loading">Loading chart…</div>;

  return (
    <img
      className="artifact-chart"
      src={src}
      alt={`Chart ${filename}`}
    />
  );
}

function AssistantContent({ text, artifacts = [], onDownload, fetchArtifactUrl }) {
  const resolvedArtifacts = mergeArtifacts(artifacts, parseArtifactsFromText(text));
  const displayText = stripArtifactJson(text, resolvedArtifacts) || text.trim();

  if (!resolvedArtifacts.length) return displayText;

  return (
    <div className="assistant-artifacts">
      {displayText ? <p className="assistant-text">{displayText}</p> : null}
      {resolvedArtifacts.map((artifact) => {
        const label = artifact.type === "document" ? "Download document" : "Download chart";
        const Icon = artifact.type === "document" ? FileText : Download;
        return (
          <div className="artifact-card" key={artifact.file}>
            {artifact.type === "visualization" ? (
              <ChartPreview filename={artifact.file} fetchArtifactUrl={fetchArtifactUrl} />
            ) : (
              <div className="artifact-doc-icon"><FileText size={28} /></div>
            )}
            <div className="artifact-meta">
              <strong>{artifact.message || (artifact.type === "document" ? "Report ready" : "Chart ready")}</strong>
              <span>{artifact.file}</span>
            </div>
            <button className="download-report" type="button" onClick={() => onDownload(artifact.file)}>
              <Icon size={15} /> {label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function Chatbot({ session }) {
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState([]);
  const [rbac, setRbac] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [provider, setProvider] = useState("auto");
  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const name = session.user.user_metadata?.full_name || session.user.email?.split("@")[0] || "there";
  const firstName = name.split(/\s+/)[0];
  const initials = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

  async function getAuthHeaders() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new Error("Your session expired. Please sign in again.");
    return { Authorization: `Bearer ${data.session.access_token}` };
  }

  async function fetchArtifactUrl(filename) {
    const safeFilename = basename(filename);
    const headers = await getAuthHeaders();
    const response = await fetch(`${apiUrl}/reports/${encodeURIComponent(safeFilename)}`, { headers });
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  }

  async function downloadArtifact(filename) {
    const objectUrl = await fetchArtifactUrl(filename);
    if (!objectUrl) return;
    const safeFilename = basename(filename);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = safeFilename;
    link.click();
    URL.revokeObjectURL(objectUrl);
  }

  useEffect(() => {
    inputRef.current?.focus();
    fetchProfile();
  }, []);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, progress]);

  async function fetchProfile() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) return;
        const response = await fetch(`${apiUrl}/auth/me`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        if (response.ok) {
          setRbac(await response.json());
          return;
        }
      } catch (_) {
        // Retry while the registration transaction finishes.
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  function newChat() {
    if (busy) return;
    setMessages([]);
    setProgress([]);
    setQuery("");
    setSidebarOpen(false);
    inputRef.current?.focus();
  }

  async function ask(event) {
    event.preventDefault();
    const text = query.trim();
    if (!text || busy) return;
    setQuery("");
    setBusy(true);
    setProgress(["Understanding your question"]);
    setMessages((current) => [...current, { role: "user", text }]);

    try {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError || !refreshed.session) throw new Error("Your session expired. Please sign in again.");

      const response = await fetch(`${apiUrl}/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
          Authorization: `Bearer ${refreshed.session.access_token}`,
        },
        body: JSON.stringify({ query: text, provider }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || "Request failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedAnswer = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const eventData = JSON.parse(line);
          if (eventData.type === "progress") {
            setProgress((current) => current.includes(eventData.message) ? current : [...current, eventData.message]);
          }
          if (eventData.type === "answer") {
            receivedAnswer = true;
            setMessages((current) => [...current, {
              role: "assistant",
              text: eventData.answer,
              artifacts: eventData.artifacts || [],
              provider: eventData.provider,
            }]);
          }
          if (eventData.type === "error") throw new Error(eventData.message);
        }
      }
      if (!receivedAnswer) throw new Error("The server closed the request before returning an answer.");
    } catch (error) {
      setMessages((current) => [...current, { role: "assistant", error: true, text: error.message }]);
    } finally {
      setBusy(false);
      setProgress([]);
      inputRef.current?.focus();
    }
  }

  const suggestions = [
    "Which products have the lowest stock?",
    "Show total order revenue by month",
    "Which regions have the highest order volume?",
  ];

  return (
    <div className="gpt-shell">
      {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close menu" />}
      <aside className={`gpt-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <div className="gpt-brand"><span className="brand-dot"><Bot size={17} /></span> CommerceLens AI</div>
          <button className="mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={18} /></button>
        </div>
        <button className="new-chat" onClick={newChat}><Plus size={17} /> New chat</button>

        <div className="sidebar-label">Workspace</div>
        <div className="workspace-card">
          <ShieldCheck size={16} />
          <div><strong>RBAC protected</strong><span>{rbac?.roles?.join(", ") || "Loading role…"}</span></div>
        </div>

        <div className="sidebar-label">Allowed data</div>
        <div className="access-list">
          {(rbac?.allowed_tables || []).map((table) => <span key={table}>{table}</span>)}
        </div>

        <div className="sidebar-bottom">
          <div className="account-row">
            <div className="account-avatar">{initials || <User size={14} />}</div>
            <div className="account-copy"><strong>{name}</strong><span>{session.user.email}</span></div>
          </div>
          <button className="signout" onClick={() => supabase.auth.signOut()}><LogOut size={16} /> Sign out</button>
        </div>
      </aside>

      <main className="gpt-main">
        <header className="gpt-topbar">
          <button className="mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar"><Menu size={20} /></button>
          <div className="model-name">
            <Bot size={18} /><span>•</span> CommerceLens AI
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              disabled={busy}
              aria-label="AI provider"
              title="Choose Gemini, Claude, or let the server select an available provider"
              style={{
                marginLeft: 8,
                padding: "5px 8px",
                borderRadius: 8,
                border: "1px solid currentColor",
                background: "transparent",
                color: "inherit",
                font: "inherit",
              }}
            >
              <option value="auto">Auto</option>
              <option value="gemini">Gemini</option>
              <option value="claude">Claude</option>
            </select>
          </div>
          <div className="top-role"><span className="online-dot" /> {rbac?.roles?.[0] || "Secure session"}</div>
        </header>

        <section className={`conversation ${messages.length ? "has-messages" : "empty"}`} ref={messagesRef}>
          {!messages.length && !busy && (
            <div className="welcome">
              <div className="welcome-icon"><Bot size={24} /></div>
              <h1>How can I help you, {firstName}?</h1>
              <p>Ask questions about your ecommerce data. CommerceLens AI checks your RBAC permissions before it reads any database table.</p>
              <div className="suggestions">
                {suggestions.map((suggestion) => (
                  <button key={suggestion} onClick={() => { setQuery(suggestion); inputRef.current?.focus(); }}>{suggestion}</button>
                ))}
              </div>
            </div>
          )}

          <div className="message-list">
            {messages.map((message, index) => (
              <div className={`gpt-message ${message.role}`} key={index}>
                {message.role === "assistant" && <div className="message-avatar assistant"><Bot size={16} /></div>}
                <div className={`message-content-wrap ${message.error ? "error-wrap" : ""}`}>
                  <div className={`message-content ${message.error ? "error" : ""}`}>
                    {message.error ? message.text : (
                      <>
                        <AssistantContent
                          text={message.text}
                          artifacts={message.artifacts}
                          onDownload={downloadArtifact}
                          fetchArtifactUrl={fetchArtifactUrl}
                        />
                        {message.provider ? (
                          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.65 }}>
                            Answered with {message.provider === "claude" ? "Claude" : "Gemini"}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                </div>
                {message.role === "user" && <div className="message-avatar user"><span>{initials}</span></div>}
              </div>
            ))}

            {busy && (
              <div className="gpt-message assistant">
                <div className="message-avatar assistant"><Bot size={16} /></div>
                <div className="processing-card">
                  <div className="processing-heading"><span className="processing-spinner" /> Processing your query</div>
                  <div className="processing-current">{progress[progress.length - 1] || "Working on your request"}</div>
                  <div className="processing-steps-mini">
                    {progress.slice(-3).map((step, index) => <div key={`${step}-${index}`}><Check size={12} /> {step}</div>)}
                  </div>
                  <div className="processing-bar"><i /><i /><i /></div>
                </div>
              </div>
            )}
          </div>
        </section>

        <div className="composer-wrap">
          <form className="gpt-composer" onSubmit={ask}>
            <textarea
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  ask(event);
                }
              }}
              placeholder="Message CommerceLens AI"
              rows="1"
              disabled={busy}
              aria-label="Message CommerceLens AI"
            />
            <button className="composer-send" disabled={busy || !query.trim()} aria-label="Send"><ArrowUp size={17} /></button>
          </form>
          <div className="composer-note">CommerceLens AI can make mistakes. Check important business decisions.</div>
        </div>
      </main>
    </div>
  );
}
