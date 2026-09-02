"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const money = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(n || 0));
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

function Badge({ children }) {
  const v = String(children || "").toUpperCase();
  const cls = v === "BUY" || v === "ACCUMULATE" ? "buy" : v === "HOLD" ? "hold" : v === "REDUCE" || v === "EXIT" ? "reduce" : "watch";
  return <span className={`badge ${cls}`}>{children}</span>;
}

function decisionFor(row, portfolioWeight) {
  const action = String(row.action || "WATCH").toUpperCase();
  const score = Number(row.total_score ?? 0);
  const risk = String(row.risk_level || "").toUpperCase();
  const fresh = String(row.freshness_status || "MISSING").toUpperCase();
  const confidence = Number(row.confidence ?? 0);

  if (action === "REDUCE" && score < 50) return { decision: portfolioWeight >= 6 ? "EXIT" : "REDUCE", reason: portfolioWeight >= 6 ? "Weak score plus high portfolio weight." : "Weak model score." };
  if (action === "REDUCE") return { decision: "REDUCE", reason: "Model flags downside or risk concerns." };
  if (action === "BUY" && score >= 85 && confidence >= 80 && ["FRESH", "ACCEPTABLE"].includes(fresh) && risk !== "HIGH") {
    if (portfolioWeight >= 8) return { decision: "HOLD", reason: "Strong candidate, but already a large portfolio position." };
    return { decision: "ACCUMULATE", reason: "Strong score, adequate confidence and acceptable data freshness." };
  }
  if (action === "HOLD" && portfolioWeight >= 10) return { decision: "REDUCE", reason: "Core holding appears oversized relative to the portfolio." };
  if (action === "WATCH" && portfolioWeight >= 10) return { decision: "REDUCE", reason: "Watch-listed stock is also highly concentrated." };
  if (["STALE", "VERY_STALE", "MISSING"].includes(fresh) && score >= 70) return { decision: "WATCH", reason: "Fundamentals are promising, but data freshness limits conviction." };
  return { decision: action === "HOLD" ? "HOLD" : "WATCH", reason: action === "HOLD" ? "Continue holding under current model view." : "Monitor until conviction or data quality improves." };
}

export default function DecisionsPage() {
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) load(data.session.user.id); else setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      if (next) load(next.user.id); else { setRows([]); setLoading(false); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  async function load(userId) {
    setLoading(true); setError("");
    try {
      const { data: holdings, error: hErr } = await supabase.from("holdings").select("instrument_id,current_value,invested_value").eq("user_id", userId);
      if (hErr) throw hErr;
      const ids = [...new Set((holdings || []).map(x => x.instrument_id).filter(Boolean))];
      if (!ids.length) { setRows([]); return; }
      const [{ data: instruments, error: iErr }, { data: scores, error: sErr }] = await Promise.all([
        supabase.from("instruments").select("id,symbol,company_name,sector").in("id", ids),
        supabase.from("ai_scores").select("instrument_id,total_score,action,risk_level,rating,score_breakdown,updated_at").in("instrument_id", ids),
      ]);
      if (iErr) throw iErr; if (sErr) throw sErr;
      const im = new Map((instruments || []).map(x => [x.id, x]));
      const sm = new Map((scores || []).map(x => [x.instrument_id, x]));
      const totalValue = (holdings || []).reduce((s, x) => s + Number(x.current_value || 0), 0);
      const byId = new Map();
      for (const h of holdings || []) {
        const prev = byId.get(h.instrument_id) || { current_value: 0, invested_value: 0 };
        prev.current_value += Number(h.current_value || 0); prev.invested_value += Number(h.invested_value || 0); byId.set(h.instrument_id, prev);
      }
      const merged = ids.map(id => {
        const inst = im.get(id) || {}; const score = sm.get(id) || {}; const b = score.score_breakdown || {}; const f = b.freshness || {}; const pos = byId.get(id) || {};
        const weight = totalValue ? (pos.current_value / totalValue) * 100 : 0;
        const decision = decisionFor({ ...score, confidence: b.confidence, freshness_status: f.status }, weight);
        return { id, company_name: inst.company_name || "Unknown Stock", symbol: inst.symbol || "—", sector: inst.sector || "OTHER", current_value: pos.current_value || 0, weight, score: score.total_score ?? null, action: score.action || "WATCH", risk: score.risk_level || "—", confidence: b.confidence ?? f.effective_confidence ?? null, freshness: f.status || "MISSING", decision: decision.decision, reason: decision.reason };
      });
      setRows(merged.sort((a,b) => (Number(b.score ?? -1) - Number(a.score ?? -1))));
    } catch (e) { console.error(e); setError(e.message || "Unable to load decisions."); } finally { setLoading(false); }
  }

  const summary = useMemo(() => {
    const out = { ACCUMULATE: 0, HOLD: 0, WATCH: 0, REDUCE: 0, EXIT: 0 };
    for (const r of rows) if (out[r.decision] !== undefined) out[r.decision]++;
    return out;
  }, [rows]);

  const sectors = useMemo(() => {
    const map = new Map();
    for (const r of rows) map.set(r.sector, (map.get(r.sector) || 0) + r.weight);
    return [...map.entries()].map(([sector, weight]) => ({ sector, weight })).sort((a,b) => b.weight-a.weight);
  }, [rows]);

  if (!session) return <main className="shell"><section className="card"><h1>Sign in required</h1><p>Please sign in on the main dashboard first.</p><Link href="/">Go to Dashboard</Link></section></main>;

  return <main className="shell">
    <header className="topbar"><div><div className="eyebrow">PORTFOLIO AI / DECISIONS</div><h1>What Should I Do?</h1><p>Position-aware recommendations built on your current AI score.</p></div><div style={{display:"flex",gap:8}}><Link href="/ai"><button>AI View</button></Link><Link href="/"><button>Portfolio</button></Link></div></header>
    {error && <div className="error">{error}</div>}
    {loading ? <section className="card"><h2>Loading decisions…</h2></section> : <>
      <section className="grid" style={{gridTemplateColumns:"repeat(5,minmax(0,1fr))"}}>
        <div className="card"><span className="label">ACCUMULATE</span><h2>{summary.ACCUMULATE}</h2></div>
        <div className="card"><span className="label">HOLD</span><h2>{summary.HOLD}</h2></div>
        <div className="card"><span className="label">WATCH</span><h2>{summary.WATCH}</h2></div>
        <div className="card"><span className="label">REDUCE</span><h2>{summary.REDUCE}</h2></div>
        <div className="card"><span className="label">EXIT</span><h2>{summary.EXIT}</h2></div>
      </section>
      <section className="card"><h2>Sector concentration</h2>{sectors.map(s => <div key={s.sector} style={{marginBottom:12}}><div style={{display:"flex",justifyContent:"space-between"}}><strong>{s.sector}</strong><span>{pct(s.weight)}</span></div><div className="bar"><span style={{width:`${Math.min(100,s.weight)}%`}} /></div></div>)}</section>
      <section className="card"><div style={{overflowX:"auto"}}><table><thead><tr><th>Company</th><th>Weight</th><th>Score</th><th>Model</th><th>Decision</th><th>Why</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td><strong>{r.company_name}</strong><small>{r.symbol}</small></td><td>{pct(r.weight)}<small>{money(r.current_value)}</small></td><td>{r.score == null ? "—" : Number(r.score).toFixed(1)}</td><td><Badge>{r.action}</Badge><small>{r.risk} · {r.freshness}</small></td><td><Badge>{r.decision}</Badge></td><td>{r.reason}</td></tr>)}</tbody></table></div></section>
    </>}
  </main>;
}
