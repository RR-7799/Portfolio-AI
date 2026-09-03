"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const money = (v) => Number(v || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const scoreClass = (action) => ["BUY", "ACCUMULATE"].includes(action) ? "positive" : ["EXIT", "SELL", "REDUCE"].includes(action) ? "negative" : "";
const clean = (v) => String(v || "").replace(/\s+/g, " ").trim().toUpperCase();

export default function PositionIntelligence() {
  const [session, setSession] = useState(null);
  const [instruments, setInstruments] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: auth }) => { if (mounted) setSession(auth.session || null); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    let mounted = true;
    supabase.from("instruments").select("id,company_name,symbol").then(({ data }) => { if (mounted) setInstruments(data || []); });
    return () => { mounted = false; };
  }, [session]);

  useEffect(() => {
    const handler = async (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const row = target?.closest("section table tbody tr");
      if (!row) return;
      const section = row.closest("section");
      const heading = Array.from(section?.querySelectorAll("span,h2,h3") || []).find((node) => clean(node.textContent) === "STOCK HOLDINGS");
      if (!heading) return;

      const cells = Array.from(row.children);
      const companyText = clean(cells[0]?.textContent);
      const cellTexts = cells.map((cell) => clean(cell.textContent)).filter(Boolean);
      let instrument = instruments.find((x) => clean(x.company_name) === companyText);
      if (!instrument) instrument = instruments.find((x) => cellTexts.includes(clean(x.company_name)) || (x.symbol && cellTexts.includes(clean(x.symbol))));
      if (!instrument?.id || !session?.access_token) return;

      setOpen(true); setLoading(true); setError(""); setData(null);
      try {
        const response = await fetch(`/api/holding-intelligence?instrument_id=${encodeURIComponent(instrument.id)}`, { headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" }, cache: "no-store" });
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) throw new Error(body?.error || "Unable to load position intelligence.");
        setData(body);
      } catch (err) { setError(err.message || "Unable to load position intelligence."); }
      finally { setLoading(false); }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [instruments, session]);

  if (!open) return null;
  const score = data?.score || {};
  const holding = data?.holding || {};
  const instrument = data?.instrument || {};

  return (
    <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.28)", display: "flex", justifyContent: "flex-end" }}>
      <aside onClick={(e) => e.stopPropagation()} style={{ width: "min(520px, 94vw)", height: "100%", background: "white", overflowY: "auto", padding: "28px", boxShadow: "-12px 0 40px rgba(15,23,42,.16)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
          <div><div className="label">POSITION INTELLIGENCE</div><h2 style={{ margin: "8px 0 4px" }}>{instrument.company_name || "Position"}</h2><div style={{ opacity: .6 }}>{instrument.symbol || "—"}</div></div>
          <button onClick={() => setOpen(false)} aria-label="Close">×</button>
        </div>
        {loading && <p style={{ marginTop: 28 }}>Loading intelligence...</p>}
        {error && <div className="error" style={{ marginTop: 20 }}>{error}</div>}
        {!loading && !error && data && <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 24 }}>
            <div className="card"><span className="label">AI SCORE</span><div style={{ fontSize: 32, fontWeight: 800 }}>{score.total_score ?? "—"}<span style={{ fontSize: 15, fontWeight: 500 }}>/100</span></div><strong>{score.rating || "—"}</strong></div>
            <div className="card"><span className="label">DECISION</span><div style={{ fontSize: 24, fontWeight: 800 }} className={scoreClass(score.action)}>{score.action || "—"}</div><div style={{ marginTop: 5 }}>{score.risk_level || "—"} risk</div></div>
          </div>
          <div className="card" style={{ marginTop: 14 }}><span className="label">YOUR POSITION</span><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}><div>Value<br /><strong>{money(holding.current_value)}</strong></div><div>P/L<br /><strong className={Number(holding.pnl_pct) >= 0 ? "positive" : "negative"}>{Number(holding.pnl_pct || 0).toFixed(2)}%</strong></div></div></div>
          <div style={{ marginTop: 22 }}><div className="label">WHY THIS DECISION</div><p style={{ lineHeight: 1.55 }}>{score.ai_summary || "The engine has not generated a detailed summary for this position yet."}</p></div>
          <div style={{ marginTop: 22 }}><div className="label">KEY STRENGTHS</div>{(data.strengths || []).length ? data.strengths.map((x) => <div key={x.factor} style={{ padding: "10px 0", borderBottom: "1px solid #eef2f7" }}><strong>{x.factor}</strong><span style={{ float: "right" }}>{x.score}</span></div>) : <p>No strong factors identified.</p>}</div>
          <div style={{ marginTop: 22 }}><div className="label">KEY WEAKNESSES</div>{(data.weaknesses || []).length ? data.weaknesses.map((x) => <div key={x.factor} style={{ padding: "10px 0", borderBottom: "1px solid #eef2f7" }}><strong>{x.factor}</strong><span style={{ float: "right" }}>{x.score}</span></div>) : <p>No major weak factors identified.</p>}</div>
          <div style={{ marginTop: 22 }}><div className="label">THESIS INVALIDATION CHECKS</div>{(data.invalidation_checks || []).map((x) => <div key={x} style={{ padding: "9px 0", lineHeight: 1.4 }}>• {x}</div>)}</div>
          <div className="card" style={{ marginTop: 22 }}><span className="label">MARKET REGIME</span><div style={{ marginTop: 8, fontWeight: 700 }}>{data.market_regime?.regime || "—"}</div><div style={{ opacity: .65, marginTop: 3 }}>{data.market_regime?.portfolio_mode || "—"}</div></div>
        </>}
      </aside>
    </div>
  );
}
