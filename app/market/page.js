"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const fmt = (v, d = 2) => v == null ? "—" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const money = (v) => v == null ? "—" : new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(v));
const pct = (v) => v == null ? "—" : `${Number(v).toFixed(2)}%`;

function tone(value) {
  const s = String(value || "").toUpperCase();
  if (s.includes("UPTREND") || s === "BULLISH") return "buy";
  if (s.includes("DOWNTREND") || s === "BEARISH") return "reduce";
  return "watch";
}

function Metric({ label, value, sub }) {
  return <div className="metricBox"><span>{label}</span><strong>{value}</strong>{sub ? <small>{sub}</small> : null}</div>;
}

export default function MarketPage() {
  const [data, setData] = useState(null);
  const [stock, setStock] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("instrument_id");
    if (!id) { setError("Missing instrument_id"); setLoading(false); return; }

    (async () => {
      try {
        const s = await fetch(`/api/stock-intelligence?instrument_id=${encodeURIComponent(id)}`, { cache: "no-store" });
        const sb = await s.json();
        if (!s.ok || !sb.success) throw new Error(sb.error || "Unable to load stock.");
        setStock(sb.instrument);
        const isin = sb.instrument?.symbol;
        if (!isin || !String(isin).startsWith("INE")) throw new Error("This holding does not have an NSE equity ISIN suitable for market analysis.");

        const m = await fetch(`/api/market-intelligence?isin=${encodeURIComponent(isin)}&days=365`, { cache: "no-store" });
        const mb = await m.json();
        if (!m.ok || !mb.success) throw new Error(mb.error || "Unable to load market intelligence.");
        setData(mb);
      } catch (e) { setError(e.message || "Unable to load market intelligence."); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <main className="stockShell"><div className="card"><h2>Loading market intelligence…</h2></div></main>;
  if (error) return <main className="stockShell"><div className="card"><h2>Unable to load</h2><p>{error}</p><Link href="/ai">← Back to AI View</Link></div></main>;

  const t = data.technical;
  return <main className="stockShell">
    <div className="stockTop"><div><Link href={`/stock?instrument_id=${encodeURIComponent(new URLSearchParams(window.location.search).get("instrument_id"))}`}>← Stock Intelligence</Link></div><div className="muted">Upstox · {new Date(data.fetched_at).toLocaleString("en-IN")}</div></div>

    <section className="card heroStock">
      <div><div className="eyebrow">{stock?.sector || "OTHER"}</div><h1>{stock?.company_name || "Stock"}</h1><p>{stock?.symbol}</p></div>
      <div className="heroScore"><span className="label">LIVE / LAST PRICE</span><strong>{money(t.price)}</strong><div><span className={`badge ${t.change_pct >= 0 ? "buy" : "reduce"}`}>{pct(t.change_pct)}</span> <span className="badge">Tech {fmt(t.technical_score, 1)}/100</span></div></div>
    </section>

    <section className="grid four">
      <Metric label="TREND" value={<span className={`badge ${tone(t.trend)}`}>{t.trend}</span>} />
      <Metric label="RSI 14" value={fmt(t.momentum.rsi14, 1)} sub="<30 oversold · >70 overbought" />
      <Metric label="ATR %" value={pct(t.volatility.atr_pct)} sub="Daily volatility proxy" />
      <Metric label="20D VOLATILITY" value={pct(t.volatility.annualized_20d_pct)} sub="Annualized" />
    </section>

    <section className="card"><h2>Trend & moving averages</h2><div className="grid four"><Metric label="PRICE" value={money(t.price)} /><Metric label="SMA 20" value={money(t.moving_averages.sma20)} /><Metric label="SMA 50" value={money(t.moving_averages.sma50)} /><Metric label="SMA 200" value={money(t.moving_averages.sma200)} /></div></section>

    <section className="card"><h2>Momentum</h2><div className="metricsTable">
      <div><span>RSI (14)</span><strong>{fmt(t.momentum.rsi14, 1)}</strong></div>
      <div><span>MACD</span><strong>{fmt(t.momentum.macd, 2)}</strong></div>
      <div><span>MACD signal</span><strong>{fmt(t.momentum.macd_signal, 2)}</strong></div>
      <div><span>MACD histogram</span><strong>{fmt(t.momentum.macd_histogram, 2)}</strong></div>
      <div><span>1 month return</span><strong className={t.momentum.one_month >= 0 ? "positive" : "negative"}>{pct(t.momentum.one_month)}</strong></div>
      <div><span>3 month return</span><strong className={t.momentum.three_month >= 0 ? "positive" : "negative"}>{pct(t.momentum.three_month)}</strong></div>
      <div><span>6 month return</span><strong className={t.momentum.six_month >= 0 ? "positive" : "negative"}>{pct(t.momentum.six_month)}</strong></div>
      <div><span>1 year return</span><strong className={t.momentum.one_year >= 0 ? "positive" : "negative"}>{pct(t.momentum.one_year)}</strong></div>
    </div></section>

    <section className="card"><h2>Key market levels</h2><div className="grid four"><Metric label="52W HIGH" value={money(t.levels.week_52_high)} /><Metric label="52W LOW" value={money(t.levels.week_52_low)} /><Metric label="20D HIGH" value={money(t.levels.recent_20d_high)} /><Metric label="20D LOW" value={money(t.levels.recent_20d_low)} /></div></section>

    <section className="card"><h2>Trading reference</h2><div className="grid four"><Metric label="ENTRY ZONE" value={`${money(t.trade_plan.entry_zone.low)} – ${money(t.trade_plan.entry_zone.high)}`} /><Metric label="STOP LOSS" value={money(t.trade_plan.stop_loss)} /><Metric label="TARGET 1" value={money(t.trade_plan.target_1)} /><Metric label="TARGET 2" value={money(t.trade_plan.target_2)} /></div><div className="noticeBox"><strong>Risk / reward to Target 1: {fmt(t.trade_plan.risk_reward_to_target_1, 2)}x</strong><p>{t.trade_plan.note}</p><small>These are quantitative reference levels, not automatic buy/sell instructions.</small></div></section>

    <section className="card"><div className="sectionHead"><h2>Data quality</h2><span className="muted">{t.data_points} daily candles · last candle {t.last_candle || "—"}</span></div><p>Live quote status: {data.quote_status}. Historical candle status: {data.historical_status}.</p></section>
  </main>;
}
