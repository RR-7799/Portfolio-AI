"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const money = (v) => Number(v || 0).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const scoreClass = (action) => ["BUY", "ACCUMULATE"].includes(action) ? "positive" : ["EXIT", "SELL", "REDUCE"].includes(action) ? "negative" : "";
const score = (v) => v == null ? "—" : Number(v).toFixed(1);

export default function DecisionPositionModal({ instrumentId, onClose }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: auth }) => {
      if (mounted) setSession(auth.session || null);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!instrumentId || !session?.access_token) return undefined;
    let mounted = true;
    setLoading(true);
    setError("");
    setData(null);

    fetch(`/api/holding-intelligence?instrument_id=${encodeURIComponent(instrumentId)}`, {
      headers: { Authorization: `Bearer ${session.access_token}`, Accept: "application/json" },
      cache: "no-store",
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.success) throw new Error(body?.error || "Unable to load position intelligence.");
        return body;
      })
      .then((body) => { if (mounted) setData(body); })
      .catch((err) => { if (mounted) setError(err.message || "Unable to load position intelligence."); })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; };
  }, [instrumentId, session]);

  useEffect(() => {
    const handler = (event) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (!instrumentId) return null;
  const scoreData = data?.score || {};
  const holding = data?.holding || {};
  const instrument = data?.instrument || {};

  return (
    <div onClick={onClose} role="presentation" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.28)", display: "flex", justifyContent: "flex-end" }}>
      <aside onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Position intelligence" style={{ width: "min(560px, 94vw)", height: "100%", background: "white", overflowY: "auto", padding: "28px", boxShadow: "-12px 0 40px rgba(15,23,42,.16)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start" }}>
          <div>
            <div className="label">POSITION INTELLIGENCE</div>
            <h2 style={{ margin: "8px 0 4px" }}>{instrument.company_name || "Position"}</h2>
            <div style={{ opacity: .6 }}>{instrument.symbol || "—"}</div>
          </div>
          <button onClick={onClose} aria-label="Close">×</button>
        </div>

        {loading && <p style={{ marginTop: 28 }}>Loading intelligence...</p>}
        {error && <div className="error" style={{ marginTop: 20 }}>{error}</div>}

        {!loading && !error && data && <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12, marginTop: 24 }}>
            <div className="card"><span className="label">LONG-TERM</span><div style={{ fontSize: 30, fontWeight: 800 }}>{score(scoreData.long_term_score)}</div><strong>{scoreData.long_term_grade || scoreData.rating || "—"}</strong></div>
            <div className="card"><span className="label">SHORT-TERM</span><div style={{ fontSize: 30, fontWeight: 800 }}>{score(scoreData.short_term_score)}</div><strong>{scoreData.short_term_grade || "—"}</strong></div>
            <div className="card"><span className="label">RISK</span><div style={{ fontSize: 30, fontWeight: 800 }}>{score(scoreData.risk_score)}</div><strong>{scoreData.risk_level || "—"}</strong></div>
            <div className="card"><span className="label">VALUATION</span><div style={{ fontSize: 30, fontWeight: 800 }}>{score(scoreData.valuation_score)}</div><strong>{scoreData.valuation_grade || "—"}</strong></div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <span className="label">FINAL DECISION</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginTop: 6 }}>
              <div style={{ fontSize: 32, fontWeight: 800 }}>{score(scoreData.final_ai_score ?? scoreData.total_score)}</div>
              <div style={{ fontWeight: 800 }} className={scoreClass(scoreData.action)}>{scoreData.action || "WATCH"}</div>
            </div>
            <p style={{ margin: "6px 0 0", lineHeight: 1.45 }}>{scoreData.ai_summary || "The engine has not generated a detailed summary for this position yet."}</p>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <span className="label">YOUR POSITION</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <div>Value<br /><strong>{money(holding.current_value)}</strong></div>
              <div>P/L<br /><strong className={Number(holding.pnl_pct) >= 0 ? "positive" : "negative"}>{Number(holding.pnl_pct || 0).toFixed(2)}%</strong></div>
            </div>
          </div>

          <div style={{ marginTop: 22 }}>
            <div className="label">WHY THIS DECISION</div>
            <p style={{ lineHeight: 1.55 }}>{scoreData.ai_summary || "No detailed rationale is available yet."}</p>
          </div>

          <div style={{ marginTop: 22 }}>
            <div className="label">KEY STRENGTHS</div>
            {(data.strengths || []).length ? data.strengths.map((x) => <div key={x.factor} style={{ padding: "10px 0", borderBottom: "1px solid #eef2f7" }}><strong>{x.factor}</strong><span style={{ float: "right" }}>{x.score}</span></div>) : <p>No strong factors identified.</p>}
          </div>

          <div style={{ marginTop: 22 }}>
            <div className="label">KEY WEAKNESSES</div>
            {(data.weaknesses || []).length ? data.weaknesses.map((x) => <div key={x.factor} style={{ padding: "10px 0", borderBottom: "1px solid #eef2f7" }}><strong>{x.factor}</strong><span style={{ float: "right" }}>{x.score}</span></div>) : <p>No major weak factors identified.</p>}
          </div>

          <div style={{ marginTop: 22 }}>
            <div className="label">THESIS INVALIDATION CHECKS</div>
            {(data.invalidation_checks || []).map((x) => <div key={x} style={{ padding: "9px 0", lineHeight: 1.4 }}>• {x}</div>)}
          </div>

          <div className="card" style={{ marginTop: 22 }}>
            <span className="label">DATA QUALITY</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
              <div>Confidence<br /><strong>{scoreData.confidence == null ? "—" : `${Number(scoreData.confidence).toFixed(1)}%`}</strong></div>
              <div>Freshness<br /><strong>{scoreData.freshness_status || "—"}</strong></div>
            </div>
          </div>
        </>}
      </aside>
    </div>
  );
}
