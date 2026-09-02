"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const money = (v) => v == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(v));
const num = (v, d = 1) => v == null ? "—" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v) => v == null ? "—" : `${Number(v).toFixed(1)}%`;

function Badge({ children, tone }) {
  return <span className={`badge ${tone || "watch"}`}>{children}</span>;
}

function decisionTone(value) {
  const s = String(value || "").toUpperCase();
  if (s.startsWith("ACCUMULATE")) return "buy";
  if (s.startsWith("HOLD")) return "hold";
  if (s.startsWith("REDUCE") || s.startsWith("EXIT")) return "reduce";
  return "watch";
}

function Metric({ label, value, sub }) {
  return <div className="metricBox"><span>{label}</span><strong>{value}</strong>{sub ? <small>{sub}</small> : null}</div>;
}

export default function FinalDecisionPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("instrument_id");
    if (!id) { setError("Missing instrument_id"); setLoading(false); return; }
    fetch(`/api/final-decision?instrument_id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (r) => { const b = await r.json(); if (!r.ok || !b.success) throw new Error(b.error || "Unable to build final decision."); return b; })
      .then(setData)
      .catch((e) => setError(e.message || "Unable to build final decision."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <main className="stockShell"><div className="card"><h2>Building final decision…</h2><p>Combining fundamentals, technicals, risk, freshness and your position.</p></div></main>;
  if (error) return <main className="stockShell"><div className="card"><h2>Unable to load</h2><p>{error}</p><Link href="/ai">← Back to AI View</Link></div></main>;

  const f = data.fundamentals || {};
  const t = data.technicals || {};
  const final = data.final || {};

  return <main className="stockShell">
    <div className="stockTop">
      <Link href={`/stock?instrument_id=${encodeURIComponent(new URLSearchParams(window.location.search).get("instrument_id"))}`}>← Stock Intelligence</Link>
      <span className="muted">Portfolio AI · {data.engine_version}</span>
    </div>

    <section className="card heroStock">
      <div>
        <div className="eyebrow">FINAL PORTFOLIO DECISION</div>
        <h1>{data.instrument?.company_name || "Stock"}</h1>
        <p>{data.instrument?.symbol} · {data.instrument?.sector || "OTHER"}</p>
      </div>
      <div className="heroScore">
        <span className="label">DECISION</span>
        <div style={{ margin: "10px 0 8px" }}><Badge tone={decisionTone(final.decision)}>{final.decision}</Badge></div>
        <div><span className="badge">{final.conviction || "—"} CONVICTION</span></div>
      </div>
    </section>

    <section className="grid four">
      <Metric label="FINAL SCORE" value={`${num(final.score, 1)}/100`} sub="65% fundamentals · 35% technicals" />
      <Metric label="FUNDAMENTAL SCORE" value={f.score == null ? "—" : `${num(f.score, 1)}/100`} sub={`${f.rating || "—"} · ${f.action || "—"}`} />
      <Metric label="TECHNICAL SCORE" value={t.score == null ? "—" : `${num(t.score, 1)}/100`} sub={t.trend || "Market data unavailable"} />
      <Metric label="POSITION WEIGHT" value={pct(final.position_weight_pct)} sub={data.portfolio?.current_value != null ? money(data.portfolio.current_value) : "Current position"} />
    </section>

    <section className="card">
      <h2>Why this is the decision</h2>
      <div className="noticeBox" style={{ marginTop: 12 }}>
        <strong>{final.reason}</strong>
        <p style={{ marginBottom: 0 }}>The engine does not treat technical strength as a replacement for fundamentals. It uses technicals to adjust timing and conviction around the fundamental view.</p>
      </div>
    </section>

    <section className="grid two">
      <div className="card">
        <h2>Fundamental view</h2>
        <div className="metricsTable">
          <div><span>Score</span><strong>{num(f.score, 1)}</strong></div>
          <div><span>Model action</span><strong>{f.action || "—"}</strong></div>
          <div><span>Rating</span><strong>{f.rating || "—"}</strong></div>
          <div><span>Risk</span><strong>{f.risk || "—"}</strong></div>
          <div><span>Confidence</span><strong>{f.confidence == null ? "—" : `${num(f.confidence, 0)}%`}</strong></div>
          <div><span>Freshness</span><strong>{f.freshness || "—"}</strong></div>
        </div>
      </div>
      <div className="card">
        <h2>Technical view</h2>
        <div className="metricsTable">
          <div><span>Price</span><strong>{money(t.price)}</strong></div>
          <div><span>Trend</span><strong>{t.trend || "—"}</strong></div>
          <div><span>RSI 14</span><strong>{num(t.rsi14, 1)}</strong></div>
          <div><span>3M momentum</span><strong>{pct(t.momentum_3m)}</strong></div>
          <div><span>1Y momentum</span><strong>{pct(t.momentum_1y)}</strong></div>
          <div><span>Risk / reward</span><strong>{t.risk_reward == null ? "—" : `${num(t.risk_reward, 2)}x`}</strong></div>
        </div>
      </div>
    </section>

    <section className="card">
      <h2>Execution reference</h2>
      {t ? <div className="grid four">
        <Metric label="ENTRY ZONE" value={t.entry_zone ? `${money(t.entry_zone.low)} – ${money(t.entry_zone.high)}` : "—"} />
        <Metric label="STOP LOSS" value={money(t.stop_loss)} />
        <Metric label="TARGET 1" value={money(t.target_1)} />
        <Metric label="TARGET 2" value={money(t.target_2)} />
      </div> : <p>Technical market data is unavailable, so execution levels cannot be calculated.</p>}
      <p style={{ marginBottom: 0 }}>These levels are quantitative reference points. They are not guaranteed prices and should not be treated as automatic orders.</p>
    </section>

    <section className="card">
      <div className="sectionHead"><h2>Position snapshot</h2><Link href={`/market?instrument_id=${encodeURIComponent(new URLSearchParams(window.location.search).get("instrument_id"))}`}>Open Market View →</Link></div>
      <div className="grid four">
        <Metric label="QUANTITY" value={num(data.portfolio?.quantity, 2)} />
        <Metric label="INVESTED" value={money(data.portfolio?.invested_value)} />
        <Metric label="CURRENT VALUE" value={money(data.portfolio?.current_value)} />
        <Metric label="UNREALIZED P/L" value={money(data.portfolio?.unrealized_pnl)} sub={data.portfolio?.pnl_percentage == null ? "—" : `${num(data.portfolio.pnl_percentage, 1)}%`} />
      </div>
    </section>
  </main>;
}
