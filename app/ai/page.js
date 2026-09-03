"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const fmt = (v) => v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(1);

function Badge({ children }) {
  const v = String(children || "").toUpperCase();
  const style = ["BUY", "ACCUMULATE", "EXCELLENT", "STRONG", "FRESH", "LOW"].includes(v)
    ? { background: "#e8f7ef", color: "#137a46" }
    : ["HOLD", "GOOD", "AVERAGE", "ACCEPTABLE", "MODERATE", "NEUTRAL"].includes(v)
      ? { background: "#eef3ff", color: "#3159a6" }
      : { background: "#fff5df", color: "#9a6500" };
  return <span style={{ ...style, display: "inline-block", borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 800 }}>{children}</span>;
}

function ScoreCard({ label, value, grade }) {
  return <div className="card" style={{ margin: 0 }}><span className="label">{label}</span><h2 style={{ margin: "6px 0 2px" }}>{fmt(value)}<small style={{ fontSize: 13, fontWeight: 500 }}>/100</small></h2>{grade ? <Badge>{grade}</Badge> : null}</div>;
}

export default function AIPage() {
  const [session, setSession] = useState(null), [rows, setRows] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [selected, setSelected] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function init() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session || null);
      if (data.session) await load(data.session.user.id); else setLoading(false);
    }
    init();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next || null);
      if (next) load(next.user.id); else { setRows([]); setLoading(false); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  async function load(userId) {
    setLoading(true); setError("");
    try {
      const { data: holdings, error: he } = await supabase.from("holdings").select("instrument_id").eq("user_id", userId);
      if (he) throw he;
      const ids = [...new Set((holdings || []).map(x => x.instrument_id).filter(Boolean))];
      if (!ids.length) { setRows([]); return; }
      const [{ data: instruments, error: ie }, { data: scores, error: se }] = await Promise.all([
        supabase.from("instruments").select("id,symbol,company_name,sector").in("id", ids),
        supabase.from("ai_scores").select("instrument_id,long_term_score,short_term_score,risk_score,valuation_score,final_ai_score,total_score,confidence,data_completeness,freshness_status,score_version,action,rating,score_breakdown").in("instrument_id", ids)
      ]);
      if (ie) throw ie; if (se) throw se;
      const im = new Map((instruments || []).map(x => [x.id, x])), sm = new Map((scores || []).map(x => [x.instrument_id, x]));
      const merged = ids.map(id => {
        const i = im.get(id) || {}, a = sm.get(id) || {}, b = a.score_breakdown || {};
        return { instrument_id: id, symbol: i.symbol || "—", company_name: i.company_name || "Unknown Stock", sector: i.sector || "OTHER", long_term_score: a.long_term_score ?? a.total_score ?? null, long_term_grade: b.long_term?.grade || null, short_term_score: a.short_term_score ?? null, short_term_grade: b.short_term?.grade || null, risk_score: a.risk_score ?? null, valuation_score: a.valuation_score ?? null, final_ai_score: a.final_ai_score ?? a.total_score ?? null, confidence: a.confidence ?? null, data_completeness: a.data_completeness ?? null, freshness_status: a.freshness_status || "MISSING", action: a.action || "—", rating: a.rating || "—", score_version: a.score_version || "legacy", breakdown: b };
      });
      setRows(merged.sort((a, b) => (b.final_ai_score ?? -1) - (a.final_ai_score ?? -1)));
    } catch (e) { console.error("AI page load failed", e); setError(e?.message || "Unable to load AI scores."); }
    finally { setLoading(false); }
  }

  const averages = useMemo(() => {
    const average = key => { const values = rows.map(r => r[key]).filter(v => v != null && Number.isFinite(Number(v))); return values.length ? values.reduce((s, v) => s + Number(v), 0) / values.length : null; };
    return { long: average("long_term_score"), short: average("short_term_score"), risk: average("risk_score"), valuation: average("valuation_score"), final: average("final_ai_score") };
  }, [rows]);

  if (!session) return <main className="shell"><section className="card"><h1>Sign in required</h1><p>Please sign in on the main dashboard first.</p><a href="/">Go to Dashboard</a></section></main>;

  return <main className="shell">
    <header className="topbar"><div><div className="eyebrow">PORTFOLIO AI / INTELLIGENCE</div><h1>AI Investment View</h1><p>Separate business quality from current market opportunity.</p></div><div style={{ display: "flex", gap: 8 }}><a href="/" style={{ textDecoration: "none" }}><button>Portfolio</button></a><button onClick={() => supabase.auth.signOut()}>Sign out</button></div></header>
    {error ? <div className="error">{error}</div> : null}
    {loading ? <div className="card">Loading AI intelligence…</div> : null}
    {!loading ? <>
      <section className="grid" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}><ScoreCard label="AVERAGE LONG-TERM" value={averages.long}/><ScoreCard label="AVERAGE SHORT-TERM" value={averages.short}/><ScoreCard label="AVERAGE RISK" value={averages.risk}/><ScoreCard label="AVERAGE VALUATION" value={averages.valuation}/><ScoreCard label="AVERAGE FINAL" value={averages.final}/></section>
      <section className="card"><div className="eyebrow">HOW TO READ THIS</div><p><strong>Long-term</strong> evaluates multi-year business quality. <strong>Short-term</strong> evaluates the current market setup. Risk, valuation, confidence and freshness remain independent signals.</p></section>
      <section className="card"><div style={{ overflowX: "auto" }}><table><thead><tr><th>Company</th><th>Long-term</th><th>Short-term</th><th>Risk</th><th>Valuation</th><th>Final AI</th><th>Confidence</th><th>Freshness</th><th>Decision</th></tr></thead><tbody>{rows.map(r => <tr key={r.instrument_id} onClick={() => setSelected(r)} style={{ cursor: "pointer" }}><td><strong>{r.company_name}</strong><small>{r.symbol} · {r.sector}</small></td><td><strong>{fmt(r.long_term_score)}</strong><small>{r.long_term_grade || "—"}</small></td><td><strong>{fmt(r.short_term_score)}</strong><small>{r.short_term_grade || "—"}</small></td><td>{fmt(r.risk_score)}</td><td>{fmt(r.valuation_score)}</td><td><strong>{fmt(r.final_ai_score)}</strong><small>{r.rating}</small></td><td>{r.confidence == null ? "—" : `${Number(r.confidence).toFixed(0)}%`}<small>{r.data_completeness == null ? "" : `${Number(r.data_completeness).toFixed(0)}% complete`}</small></td><td><Badge>{r.freshness_status}</Badge></td><td><Badge>{r.action}</Badge></td></tr>)}</tbody></table>{!rows.length ? <p>No scored holdings are available yet.</p> : null}</div></section>
    </> : null}
    {selected ? <div onClick={() => setSelected(null)} style={{ position: "fixed", inset: 0, background: "rgba(23,32,51,.35)", display: "grid", placeItems: "center", padding: 20, zIndex: 20 }}><div className="card" onClick={e => e.stopPropagation()} style={{ width: "min(900px,100%)", maxHeight: "90vh", overflowY: "auto" }}><div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}><div><div className="eyebrow">INVESTMENT INTELLIGENCE</div><h2>{selected.company_name}</h2><p>{selected.symbol} · {selected.sector}</p></div><button onClick={() => setSelected(null)}>Close</button></div><div className="grid" style={{ gridTemplateColumns: "repeat(5, minmax(0,1fr))" }}><ScoreCard label="LONG-TERM" value={selected.long_term_score} grade={selected.long_term_grade}/><ScoreCard label="SHORT-TERM" value={selected.short_term_score} grade={selected.short_term_grade}/><ScoreCard label="RISK" value={selected.risk_score}/><ScoreCard label="VALUATION" value={selected.valuation_score}/><ScoreCard label="FINAL AI" value={selected.final_ai_score} grade={selected.rating}/></div><div style={{ marginTop: 18 }}><span className="label">MODEL ACTION</span><p><Badge>{selected.action}</Badge></p><span className="label">CONFIDENCE / DATA</span><p>{selected.confidence == null ? "—" : `${Number(selected.confidence).toFixed(0)}% confidence`} · {selected.data_completeness == null ? "—" : `${Number(selected.data_completeness).toFixed(0)}% complete`} · {selected.freshness_status}</p><span className="label">WHY</span><p>{selected.breakdown.reason || "Decision combines long-term quality, short-term opportunity, risk, valuation and data confidence."}</p><span className="label">SCORER VERSION</span><p>{selected.score_version}</p></div></div></div> : null}
  </main>;
}
