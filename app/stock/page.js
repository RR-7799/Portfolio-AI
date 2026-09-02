"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const money = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(n || 0));
const num = (n, d = 2) => Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

function Badge({ children, tone = "neutral" }) { return <span className={`badge ${tone}`}>{children}</span>; }
function toneForAction(action) { return { BUY: "buy", HOLD: "hold", WATCH: "watch", REDUCE: "reduce" }[action] || "neutral"; }

export default function StockPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("instrument_id");
    if (!id) { setError("Missing instrument_id"); setLoading(false); return; }
    fetch(`/api/stock-intelligence?instrument_id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (r) => { const body = await r.json(); if (!r.ok || !body.success) throw new Error(body.error || "Unable to load stock intelligence"); return body; })
      .then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, []);

  if (loading) return <main className="stockShell"><div className="card"><h2>Loading stock intelligence…</h2></div></main>;
  if (error) return <main className="stockShell"><div className="card"><h2>Unable to load</h2><p>{error}</p><Link href="/ai">← Back to AI View</Link></div></main>;

  const { instrument, portfolio, ai_score, key_metrics } = data;
  const b = ai_score?.breakdown || {};
  const components = b.components || {};
  const freshness = b.freshness || {};
  const instrumentId = instrument?.id;

  return (
    <main className="stockShell">
      <div className="stockTop"><Link href="/ai">← AI Investment View</Link><span className="muted">Portfolio AI</span></div>
      <section className="card heroStock">
        <div><div className="eyebrow">{instrument.sector || "OTHER"}</div><h1>{instrument.company_name}</h1><p>{instrument.symbol}</p></div>
        <div className="heroScore"><span className="label">AI SCORE</span><strong>{ai_score?.total_score ?? "—"}</strong><div><Badge tone={toneForAction(ai_score?.action)}>{ai_score?.action || "—"}</Badge> <Badge>{ai_score?.rating || "—"}</Badge></div></div>
      </section>
      <section className="card marketLinkCard"><div><div className="eyebrow">MARKET INTELLIGENCE</div><h2>See live price, trend, momentum and trade levels</h2><p>Upstox market data with moving averages, RSI, MACD, volatility, 52-week levels and quantitative reference levels.</p></div><Link href={`/market?instrument_id=${encodeURIComponent(instrumentId || "")}`}><button className="primaryAction">Open Market View →</button></Link></section>
      <section className="grid three">
        <div className="card"><span className="label">RISK</span><h2>{ai_score?.risk_level || "—"}</h2><p>Model risk assessment</p></div>
        <div className="card"><span className="label">CONFIDENCE</span><h2>{freshness.effective_confidence ?? "—"}%</h2><p>After freshness adjustment</p></div>
        <div className="card"><span className="label">FRESHNESS</span><h2>{freshness.status || "—"}</h2><p>{freshness.financial_period || "No period"}</p></div>
      </section>
      <section className="card">
        <div className="sectionHead"><h2>Why the model says this</h2><span className="muted">Engine: {data.engine_version}</span></div>
        <div className="grid four">{Object.entries(components).map(([k,v]) => <div className="metricBox" key={k}><span>{k.replaceAll("_"," ")}</span><strong>{v == null ? "—" : num(v,1)}</strong><div className="meter"><i style={{width:`${Math.max(0,Math.min(100,Number(v||0)))}%`}} /></div></div>)}</div>
      </section>
      <section className="grid two">
        <div className="card"><h2>Key strengths</h2>{ai_score?.strengths?.length ? <ul>{ai_score.strengths.map((x,i)=><li key={i}>{x}</li>)}</ul> : <p>No major model strengths identified.</p>}</div>
        <div className="card"><h2>Key concerns</h2>{ai_score?.concerns?.length ? <ul>{ai_score.concerns.map((x,i)=><li key={i}>{x}</li>)}</ul> : <p>No major model concerns identified.</p>}</div>
      </section>
      <section className="card"><h2>Fundamental snapshot</h2><div className="metricsTable">{Object.entries({"P/E":key_metrics.pe,"P/B":key_metrics.pb,"ROE":key_metrics.roe,"ROCE":key_metrics.roce,"Sales growth":key_metrics.sales_growth,"Profit growth":key_metrics.profit_growth,"Debt / Equity":key_metrics.debt_to_equity,"Operating cash flow":key_metrics.operating_cash_flow,"Promoter holding":key_metrics.promoter_holding,"FII holding":key_metrics.fii_holding,"DII holding":key_metrics.dii_holding,"Market cap":key_metrics.market_cap,"EPS":key_metrics.eps,"Book value / share":key_metrics.book_value_per_share,"Dividend yield":key_metrics.dividend_yield,"52W high":key_metrics.week_52_high,"52W low":key_metrics.week_52_low,"Financial year":key_metrics.financial_year,"Shareholding date":key_metrics.shareholding_date}).map(([label,value])=><div key={label}><span>{label}</span><strong>{value==null||value===""?"—":typeof value==="number"?num(value):value}</strong></div>)}</div></section>
      <section className="card"><h2>Your position</h2><div className="grid four"><div className="metricBox"><span>Quantity</span><strong>{num(portfolio.quantity,2)}</strong></div><div className="metricBox"><span>Invested</span><strong>{money(portfolio.invested_value)}</strong></div><div className="metricBox"><span>Current value</span><strong>{money(portfolio.current_value)}</strong></div><div className="metricBox"><span>P/L</span><strong className={portfolio.unrealized_pnl>=0?"positive":"negative"}>{money(portfolio.unrealized_pnl)} ({num(portfolio.pnl_percentage)}%)</strong></div></div></section>
    </main>
  );
}
