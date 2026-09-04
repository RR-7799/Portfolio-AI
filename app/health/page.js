"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const money = v => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(v || 0));
const pct = v => Number(v || 0).toFixed(1) + "%";
function Badge({ children }) { const x = String(children || "").toUpperCase(); const cls = x === "HIGH" ? "reduce" : x === "MEDIUM" ? "watch" : "hold"; return <span className={`badge ${cls}`}>{children}</span>; }

export default function HealthPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/portfolio-health", { cache: "no-store" });
      const b = await r.json();
      if (!r.ok || !b.success) throw new Error(b.error || "Unable to load portfolio health.");
      setData(b);
    } catch (e) { setError(e.message || "Unable to load portfolio health."); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <main className="shell"><div className="card"><h2>Loading portfolio health…</h2></div></main>;
  if (error) return <main className="shell"><div className="card"><h2>Unable to load</h2><p>{error}</p><button onClick={load}>Retry</button></div></main>;

  const s = data.summary;
  return <main className="shell">
    <header className="topbar"><div><div className="eyebrow">PORTFOLIO AI / HEALTH</div><h1>Portfolio Health & Alerts</h1><p>Current portfolio condition, concentration risks and actionable warnings.</p></div><div style={{display:"flex",gap:8}}><button onClick={load}>Refresh</button><Link href="/command-center"><button>Command Center</button></Link><Link href="/"><button>Portfolio</button></Link></div></header>

    <section className="grid four">
      <div className="card"><span className="label">HEALTH SCORE</span><h2>{s.health_score}/100</h2><p>{s.health_score >= 75 ? "Healthy" : s.health_score >= 55 ? "Needs attention" : "High risk"}</p></div>
      <div className="card"><span className="label">PORTFOLIO VALUE</span><h2>{money(s.total_value)}</h2><p>{s.holdings} positions</p></div>
      <div className="card"><span className="label">HIGH-RISK CAPITAL</span><h2>{pct(s.high_risk_capital_pct)}</h2><p>Current model risk exposure</p></div>
      <div className="card"><span className="label">ALERTS</span><h2>{data.alerts.length}</h2><p><Badge>{s.alert_counts.HIGH} HIGH</Badge> <Badge>{s.alert_counts.MEDIUM} MEDIUM</Badge></p></div>
    </section>

    <section className="card"><div className="sectionHead"><h2>Priority alerts</h2><span className="muted">Generated {new Date(data.fetched_at).toLocaleString("en-IN")}</span></div>{data.alerts.length ? <div className="metricsTable">{data.alerts.map((a,i)=><div key={i} style={{display:"block"}}><div style={{display:"flex",justifyContent:"space-between",gap:12}}><strong>{a.title}</strong><Badge>{a.severity}</Badge></div><p style={{margin:"6px 0 0"}}>{a.detail}</p>{a.instrument ? <small>{a.instrument.company_name} · {a.instrument.symbol}</small> : null}</div>)}</div> : <p>No active alerts detected.</p>}</section>

    <section className="grid two">
      <div className="card"><h2>Sector exposure</h2>{data.sector_exposure.map(x=><div key={x.sector} style={{marginBottom:12}}><div style={{display:"flex",justifyContent:"space-between"}}><strong>{x.sector}</strong><span>{pct(x.weight)}</span></div><div className="bar"><span style={{width:`${Math.min(100,x.weight)}%`}} /></div></div>)}</div>
      <div className="card"><h2>Portfolio diagnostics</h2><div className="metricsTable">
        <div><span>Average AI score</span><strong>{s.average_ai_score ?? "—"}</strong></div>
        <div><span>Weak-score capital</span><strong>{pct(s.weak_score_capital_pct)}</strong></div>
        <div><span>High-risk capital</span><strong>{pct(s.high_risk_capital_pct)}</strong></div>
        <div><span>High alerts</span><strong>{s.alert_counts.HIGH}</strong></div>
        <div><span>Medium alerts</span><strong>{s.alert_counts.MEDIUM}</strong></div>
        <div><span>Total positions</span><strong>{s.holdings}</strong></div>
      </div></div>
    </section>

    <section className="card"><h2>Largest positions</h2><div style={{overflowX:"auto"}}><table><thead><tr><th>Company</th><th>Weight</th><th>Score</th><th>Risk</th><th>Freshness</th><th>Model action</th></tr></thead><tbody>{data.holdings.slice(0,15).map(r=><tr key={r.id}><td><strong>{r.company_name}</strong><small>{r.symbol}</small></td><td>{pct(r.weight)}<small>{money(r.current_value)}</small></td><td>{r.score == null ? "—" : Number(r.score).toFixed(1)}</td><td><Badge>{r.risk}</Badge></td><td>{r.freshness}</td><td>{r.action}</td></tr>)}</tbody></table></div></section>

    <section className="card"><h2>How to use this screen</h2><p>HIGH alerts deserve review first. Concentration alerts tell you when a position or sector has become too large. Data alerts reduce conviction when fundamentals are stale or missing. Health score is a model diagnostic, not a guarantee of returns.</p></section>
  </main>;
}
