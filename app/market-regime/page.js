"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const money = (v) => v == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(v));
const pct = (v) => v == null ? "—" : `${Number(v).toFixed(2)}%`;
const score = (v) => v == null ? "—" : Number(v).toFixed(1);

function Badge({ children }) {
  const v = String(children || "").toUpperCase();
  const cls = v === "BULL" ? "buy" : v === "BEAR" ? "reduce" : "watch";
  return <span className={`badge ${cls}`}>{children}</span>;
}

function Metric({ label, value, sub }) {
  return <div className="metricBox"><span>{label}</span><strong>{value}</strong>{sub ? <small>{sub}</small> : null}</div>;
}

export default function MarketRegimePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/market-regime", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Unable to load market regime.");
      setData(body);
    } catch (e) {
      setError(e.message || "Unable to load market regime.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <main className="shell"><section className="card"><h2>Loading market regime…</h2></section></main>;
  if (error) return <main className="shell"><section className="card"><h2>Unable to load</h2><p>{error}</p><button onClick={load}>Retry</button></section></main>;

  const r = data.regime;
  const n = data.indicators.nifty50;
  const b = data.indicators.nifty_bank;
  const v = data.indicators.india_vix;

  return <main className="shell">
    <header className="topbar">
      <div><div className="eyebrow">PORTFOLIO AI / MARKET REGIME</div><h1>Market Regime & Portfolio Mode</h1><p>The overall market backdrop used to moderate accumulation and risk decisions.</p></div>
      <div style={{display:"flex",gap:8}}><button onClick={load}>Refresh</button><Link href="/command-center"><button>Command Center</button></Link><Link href="/health"><button>Health</button></Link><Link href="/"><button>Portfolio</button></Link></div>
    </header>

    <section className="card heroStock">
      <div><span className="label">CURRENT REGIME</span><h1 style={{marginBottom:8}}><Badge>{r.label}</Badge></h1><p>{r.guidance}</p></div>
      <div className="heroScore"><span className="label">REGIME SCORE</span><strong>{score(r.score)}/100</strong><div><span className="badge">Confidence {r.confidence}%</span></div></div>
    </section>

    <section className="grid four">
      <Metric label="PORTFOLIO MODE" value={r.portfolio_mode} sub="Decision framework" />
      <Metric label="BUY MULTIPLIER" value={`${r.buy_multiplier}×`} sub="Relative accumulation aggressiveness" />
      <Metric label="POSITION MULTIPLIER" value={`${r.position_target_multiplier}×`} sub="Target-size adjustment" />
      <Metric label="DATA SOURCES" value={`${data.source_health.available_sources}/3`} sub="Nifty 50 · Bank · VIX" />
    </section>

    <section className="card"><h2>Market indicators</h2><div className="grid three">
      <div className="metricBox"><span>NIFTY 50</span><strong>{money(n.price)}</strong><small><Badge>{n.trend}</Badge> · 3M {pct(n.momentum?.three_month_return_pct)} · 1Y {pct(n.momentum?.one_year_return_pct)} · score {score(n.regime_score)}</small></div>
      <div className="metricBox"><span>NIFTY BANK</span><strong>{money(b.price)}</strong><small><Badge>{b.trend}</Badge> · 3M {pct(b.momentum?.three_month_return_pct)} · 1Y {pct(b.momentum?.one_year_return_pct)} · score {score(b.regime_score)}</small></div>
      <div className="metricBox"><span>INDIA VIX</span><strong>{money(v.price)}</strong><small>Volatility index · regime adjustment {v.price == null ? "—" : (v.price <= 13 ? "+5" : v.price <= 18 ? "0" : v.price <= 22 ? "-5" : "-10")}</small></div>
    </div></section>

    <section className="grid two">
      <div className="card"><h2>Why this regime?</h2><div style={{display:"grid",gap:10}}>{data.rationale.map((x,i)=><div key={i} className="metricBox"><strong>{i+1}. {x}</strong></div>)}</div></div>
      <div className="card"><h2>Portfolio behavior</h2><div className="metricsTable">
        <div><span>Bull market</span><strong>Accumulate selectively</strong></div>
        <div><span>Neutral market</span><strong>Quality first</strong></div>
        <div><span>Bear market</span><strong>Protect capital</strong></div>
        <div><span>Current guidance</span><strong>{r.guidance}</strong></div>
      </div></div>
    </section>

    <section className="card"><h2>Guardrails</h2><div className="grid three"><Metric label="BULL" value="Normal" sub={data.guardrails.bull} /><Metric label="NEUTRAL" value="Selective" sub={data.guardrails.neutral} /><Metric label="BEAR" value="Defensive" sub={data.guardrails.bear} /></div><p className="muted" style={{marginBottom:0}}>Regime is a model overlay. It does not predict markets with certainty and does not place trades.</p></section>

    <section className="card"><div className="sectionHead"><h2>Source health</h2><span className="muted">Upstox · generated {new Date(data.fetched_at).toLocaleString("en-IN")}</span></div><div className="metricsTable"><div><span>Directional sources</span><strong>{data.source_health.directional_sources}/2</strong></div><div><span>Total sources</span><strong>{data.source_health.available_sources}/3</strong></div><div><span>Nifty 50 data</span><strong>{n.available ? "Available" : "Unavailable"}</strong></div><div><span>Nifty Bank data</span><strong>{b.available ? "Available" : "Unavailable"}</strong></div><div><span>India VIX data</span><strong>{v.available ? "Available" : "Unavailable"}</strong></div><div><span>Engine</span><strong>{data.engine_version}</strong></div></div></section>
  </main>;
}
