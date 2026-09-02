"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const suggestions = [
  "What should I do with my portfolio today?",
  "Which stocks should I completely exit?",
  "Where should I deploy ₹50,000?",
  "What are my biggest portfolio risks?",
  "Which are my strongest holdings?",
];

function money(v) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(v || 0));
}

export default function CopilotPage() {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([
    { role: "assistant", text: "I’m your Portfolio AI Copilot. Ask me about your holdings, risk, decisions, or where to deploy fresh capital." },
  ]);
  const [memory, setMemory] = useState([]);
  const [showMemory, setShowMemory] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function loadMemory(token = session?.access_token) {
    if (!token) return;
    setMemoryLoading(true);
    try {
      const r = await fetch("/api/copilot-memory?limit=30", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const b = await r.json();
      if (!r.ok || !b.success) throw new Error(b.error || "Unable to load memory.");
      setMemory(b.items || []);
    } catch (e) {
      setError(e.message || "Unable to load Copilot memory.");
    } finally {
      setMemoryLoading(false);
    }
  }

  useEffect(() => {
    if (session) loadMemory(session.access_token);
  }, [session]);

  async function saveMemory(questionText, answer, context) {
    if (!session?.access_token) return;
    try {
      await fetch("/api/copilot-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          question: questionText,
          answer,
          market_regime: context?.market_regime,
          portfolio_value: context?.portfolio_value,
          metadata: { stock_count: context?.stock_count ?? null, data_sources: ["holdings", "ai_scores", "fundamentals", "market_regime"] },
        }),
      });
    } catch {
      // Memory is helpful but should never block a Copilot answer.
    }
  }

  async function ask(text = question) {
    const q = String(text || "").trim();
    if (!q || !session || loading) return;
    setError("");
    setQuestion("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setLoading(true);
    try {
      const token = session.access_token;
      const r = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question: q }),
      });
      const b = await r.json();
      if (!r.ok || !b.success) throw new Error(b.error || "Copilot request failed.");
      setMessages((m) => [...m, {
        role: "assistant",
        text: b.answer,
        meta: b.context ? `${b.context.stock_count} stocks · ${money(b.context.portfolio_value)} total · regime ${b.context.market_regime}` : "",
      }]);
      await saveMemory(q, b.answer, b.context);
      loadMemory(token);
    } catch (e) {
      setError(e.message || "Unable to answer.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteMemory(id) {
    if (!session?.access_token) return;
    try {
      const r = await fetch(`/api/copilot-memory?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const b = await r.json();
      if (!r.ok || !b.success) throw new Error(b.error || "Unable to delete memory.");
      setMemory((items) => items.filter((x) => x.id !== id));
    } catch (e) {
      setError(e.message || "Unable to delete memory.");
    }
  }

  function reopenMemory(item) {
    setMessages((m) => [
      ...m,
      { role: "user", text: item.question },
      { role: "assistant", text: item.answer, meta: item.market_regime ? `Memory · regime ${item.market_regime}` : "Saved Copilot memory" },
    ]);
    setShowMemory(false);
  }

  if (!session) return (
    <main className="shell">
      <section className="card">
        <div className="eyebrow">PORTFOLIO AI / COPILOT</div>
        <h1>Sign in required</h1>
        <p>Sign in on the main dashboard to use your private portfolio context.</p>
        <Link href="/">Go to Dashboard</Link>
      </section>
    </main>
  );

  return (
    <main className="shell copilotShell">
      <header className="topbar">
        <div>
          <div className="eyebrow">PORTFOLIO AI / COPILOT</div>
          <h1>Portfolio AI Copilot</h1>
          <p>Ask questions using your actual portfolio, AI scores, risk signals and market regime.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => { setShowMemory((v) => !v); if (!showMemory) loadMemory(); }}>Memory {memory.length ? `(${memory.length})` : ""}</button>
          <Link href="/command-center"><button>Command Center</button></Link>
          <Link href="/health"><button>Health</button></Link>
          <Link href="/history"><button>History</button></Link>
          <Link href="/"><button>Portfolio</button></Link>
        </div>
      </header>

      {showMemory ? (
        <section className="card">
          <div className="sectionHead"><h2>Copilot memory</h2><span className="muted">Your saved questions and answers</span></div>
          {memoryLoading ? <p>Loading memory…</p> : memory.length ? (
            <div className="memoryList">
              {memory.map((item) => (
                <div className="memoryItem" key={item.id}>
                  <strong>{item.question}</strong>
                  <p>{item.answer}</p>
                  <small>{new Date(item.created_at).toLocaleString("en-IN")} · {item.market_regime || "—"}</small>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button onClick={() => reopenMemory(item)}>Open</button>
                    <button onClick={() => deleteMemory(item.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          ) : <p>No saved Copilot conversations yet.</p>}
        </section>
      ) : null}

      <section className="card copilotCard">
        <div className="suggestionRow">
          {suggestions.map((s) => <button key={s} onClick={() => ask(s)} className="suggestion">{s}</button>)}
        </div>

        <div className="chatWindow">
          {messages.map((m, i) => (
            <div key={i} className={`chatRow ${m.role}`}>
              <div className="chatBubble">
                <div>{m.text}</div>
                {m.meta ? <small>{m.meta}</small> : null}
              </div>
            </div>
          ))}
          {loading ? <div className="chatRow assistant"><div className="chatBubble">Analysing your portfolio…</div></div> : null}
          <div ref={endRef} />
        </div>

        {error ? <div className="error" style={{ marginTop: 14 }}>{error}</div> : null}

        <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="chatInputRow">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask: Should I buy BEL today?"
            aria-label="Ask Portfolio AI"
          />
          <button className="primaryAction" type="submit" disabled={loading || !question.trim()}>Ask AI</button>
        </form>
      </section>

      <section className="grid three">
        <div className="card"><span className="label">PRIVATE CONTEXT</span><h2>✓</h2><p>Your request is authenticated with your current Supabase session before the portfolio context is loaded.</p></div>
        <div className="card"><span className="label">MEMORY</span><h2>Persistent</h2><p>Copilot questions and answers can be saved to your private memory and reopened later.</p></div>
        <div className="card"><span className="label">MODEL STYLE</span><h2>Guardrailed</h2><p>Answers are based on the app's current rules and data, not a claim of guaranteed returns.</p></div>
      </section>
    </main>
  );
}
