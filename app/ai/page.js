"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const money = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

const scoreNumber = (n) => (n === null || n === undefined ? "—" : Number(n).toFixed(1));

const badgeStyle = (value) => {
  const v = String(value || "").toUpperCase();
  if (["BUY", "FRESH", "LOW", "STRONG"].includes(v)) return { background: "#e8f7ef", color: "#137a46" };
  if (["HOLD", "ACCEPTABLE", "MODERATE", "GOOD"].includes(v)) return { background: "#eef3ff", color: "#3159a6" };
  if (["WATCH", "AGING", "AVERAGE", "PROVISIONAL", "PARTIAL"].includes(v)) return { background: "#fff5df", color: "#9a6500" };
  return { background: "#fff0f0", color: "#b33a3a" };
};

function Badge({ children }) {
  return <span style={{ ...badgeStyle(children), display: "inline-block", borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 800 }}>{children}</span>;
}

export default function AIPage() {
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) loadData(data.session.user.id);
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      if (next) loadData(next.user.id);
      else {
        setRows([]);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function loadData(userId) {
    setLoading(true);
    setError("");

    try {
      const { data: holdings, error: holdingsError } = await supabase
        .from("holdings")
        .select("instrument_id")
        .eq("user_id", userId);

      if (holdingsError) throw new Error(holdingsError.message);

      const ids = [...new Set((holdings || []).map((x) => x.instrument_id).filter(Boolean))];
      if (!ids.length) {
        setRows([]);
        setLoading(false);
        return;
      }

      const [{ data: instruments, error: instrumentError }, { data: scores, error: scoreError }] = await Promise.all([
        supabase.from("instruments").select("id,symbol,company_name").in("id", ids),
        supabase.from("ai_scores").select("instrument_id,total_score,rating,action,risk_level,score_breakdown,updated_at").in("instrument_id", ids),
      ]);

      if (instrumentError) throw new Error(instrumentError.message);
      if (scoreError) throw new Error(scoreError.message);

      const instrumentMap = new Map((instruments || []).map((x) => [x.id, x]));
      const scoreMap = new Map((scores || []).map((x) => [x.instrument_id, x]));

      const merged = ids.map((id) => {
        const instrument = instrumentMap.get(id) || {};
        const score = scoreMap.get(id) || {};
        const breakdown = score.score_breakdown || {};
        const freshness = breakdown.freshness || {};
        const components = breakdown.components || {};
        const raw = breakdown.raw_inputs || {};
        return {
          instrument_id: id,
          symbol: instrument.symbol || "—",
          company_name: instrument.company_name || "Unknown Stock",
          total_score: score.total_score ?? null,
          rating: score.rating || "—",
          action: score.action || "—",
          risk_level: score.risk_level || "—",
          confidence: breakdown.confidence ?? freshness.effective_confidence ?? null,
          completeness: breakdown.data_completeness ?? null,
          freshness_status: freshness.status || "MISSING",
          financial_period: freshness.financial_period || null,
          financial_age_months: freshness.financial_age_months ?? null,
          diagnostics: breakdown.diagnostics || [],
          notes: breakdown.notes || [],
          components,
          raw,
          valuation: breakdown.valuation || {},
          updated_at: score.updated_at || freshness.as_of || null,
        };
      });

      setRows(merged.sort((a, b) => Number(b.total_score ?? -1) - Number(a.total_score ?? -1)));
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to load AI scores.");
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(() => {
    const out = { BUY: 0, HOLD: 0, WATCH: 0, REDUCE: 0 };
    for (const row of rows) if (out[row.action] !== undefined) out[row.action]++;
    return out;
  }, [rows]);

  const averageScore = useMemo(() => {
    const scored = rows.filter((x) => x.total_score !== null);
    return scored.length ? scored.reduce((s, x) => s + Number(x.total_score), 0) / scored.length : null;
  }, [rows]);

  const freshnessCounts = useMemo(() => {
    const out = {};
    for (const row of rows) out[row.freshness_status] = (out[row.freshness_status] || 0) + 1;
    return out;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (filter === "ALL") return rows;
    return rows.filter((x) => x.action === filter);
  }, [rows, filter]);

  function selectRow(row) {
    setSelected(row);
  }

  if (!session) {
    return (
      <main className="shell">
        <section className="card">
          <div className="eyebrow">PORTFOLIO AI</div>
          <h1>Sign in required</h1>
          <p>Please sign in on the main dashboard first.</p>
          <a href="/" style={{ textDecoration: "none" }}><button className="primary" style={{ width: "auto" }}>Go to Dashboard</button></a>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">PORTFOLIO AI / INTELLIGENCE</div>
          <h1>AI Investment View</h1>
          <p>Score, conviction, freshness, risk and diagnostics for your holdings.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/" style={{ textDecoration: "none" }}><button>Portfolio</button></a>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      {error && <div className="error">{error}</div>}
      {loading && <div className="card"><strong>Loading AI intelligence…</strong></div>}

      {!loading && (
        <>
          <section className="grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            <div className="card"><span className="label">AVERAGE AI SCORE</span><h2>{averageScore === null ? "—" : averageScore.toFixed(1)}</h2><p>{rows.length} unique instruments</p></div>
            <div className="card"><span className="label">BUY</span><h2>{counts.BUY}</h2><p>Meets current engine rules</p></div>
            <div className="card"><span className="label">HOLD</span><h2>{counts.HOLD}</h2><p>Core positions</p></div>
            <div className="card"><span className="label">WATCH / REDUCE</span><h2>{counts.WATCH + counts.REDUCE}</h2><p>{counts.WATCH} watch · {counts.REDUCE} reduce</p></div>
          </section>

          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <span className="label">DATA QUALITY</span>
                <h2 style={{ marginBottom: 2 }}>{freshnessCounts.FRESH || 0} fresh · {freshnessCounts.ACCEPTABLE || 0} acceptable</h2>
                <p style={{ marginTop: 4 }}>{freshnessCounts.MISSING || 0} missing · {freshnessCounts.VERY_STALE || 0} very stale</p>
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {['ALL', 'BUY', 'HOLD', 'WATCH', 'REDUCE'].map((x) => (
                  <button key={x} onClick={() => setFilter(x)} style={{ fontWeight: 800, background: filter === x ? "#172033" : "white", color: filter === x ? "white" : "#172033" }}>{x}</button>
                ))}
              </div>
            </div>
          </section>

          <section className="card">
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>Company</th><th>Score</th><th>Action</th><th>Risk</th><th>Confidence</th><th>Freshness</th><th>Valuation</th></tr></thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.instrument_id} onClick={() => selectRow(row)} style={{ cursor: "pointer" }}>
                      <td><strong>{row.company_name}</strong><small>{row.symbol}</small></td>
                      <td><strong>{scoreNumber(row.total_score)}</strong></td>
                      <td><Badge>{row.action}</Badge></td>
                      <td><Badge>{row.risk_level}</Badge></td>
                      <td>{row.confidence == null ? "—" : `${Number(row.confidence).toFixed(0)}%`}</td>
                      <td><Badge>{row.freshness_status}</Badge><small>{row.financial_period || "No period"}</small></td>
                      <td>{row.valuation?.pe == null ? "—" : `P/E ${Number(row.valuation.pe).toFixed(1)}`}<small>{row.valuation?.pb == null ? "" : `P/B ${Number(row.valuation.pb).toFixed(1)}`}</small></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredRows.length && <p>No stocks match this filter.</p>}
            </div>
          </section>
        </>
      )}

      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(23,32,51,.35)", display: "grid", placeItems: "center", padding: 20, zIndex: 20 }} onClick={() => setSelected(null)}>
          <div className="card" style={{ width: "min(720px,100%)", maxHeight: "90vh", overflowY: "auto", margin: 0 }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <div><div className="eyebrow">STOCK INTELLIGENCE</div><h2 style={{ marginBottom: 4 }}>{selected.company_name}</h2><p>{selected.symbol}</p></div>
              <button onClick={() => setSelected(null)}>Close</button>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
              <div><span className="label">AI SCORE</span><h2>{scoreNumber(selected.total_score)}</h2></div>
              <div><span className="label">ACTION</span><h2><Badge>{selected.action}</Badge></h2></div>
              <div><span className="label">CONFIDENCE</span><h2>{selected.confidence == null ? "—" : `${Number(selected.confidence).toFixed(0)}%`}</h2></div>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(2,1fr)" }}>
              {Object.entries(selected.components || {}).map(([key, value]) => (
                <div className="card" key={key} style={{ marginBottom: 0, padding: 16 }}><span className="label">{key.replaceAll("_", " ")}</span><h2>{scoreNumber(value)}</h2></div>
              ))}
            </div>
            <div style={{ marginTop: 18 }}>
              <span className="label">DIAGNOSTICS</span>
              <p>{selected.diagnostics?.length ? selected.diagnostics.join(" · ") : "No diagnostics flagged."}</p>
            </div>
            <div style={{ marginTop: 12 }}>
              <span className="label">WHY THIS SCORE</span>
              <p>{selected.notes?.length ? selected.notes.join(" ") : "No additional notes."}</p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
