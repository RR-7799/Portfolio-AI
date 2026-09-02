"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const money = (v) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(v || 0));
const pct = (v) => `${Number(v || 0).toFixed(1)}%`;

function Badge({ children }) {
  const v = String(children || "").toUpperCase();
  const cls = v.startsWith("ACCUMULATE") ? "buy" : v.startsWith("HOLD") ? "hold" : ["REDUCE","EXIT"].includes(v) ? "reduce" : "watch";
  return <span className={`badge ${cls}`}>{children}</span>;
}

export default function CommandCenterPage() {
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState(100000);
  const [filter, setFilter] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/portfolio-command-center", { cache: "no-store" })
      .then(async r => { const b = await r.json(); if (!r.ok || !b.success) throw new Error(b.error || "Unable to load command center"); return b; })
      .then(setData).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.ranking.filter(r => filter === "ALL" || r.decision.startsWith(filter));
  }, [data, filter]);

  if (loading) return <main className="shell"><section className="card"><h2>Loading Portfolio Command Center…</h2></section></main>;
  if (error) return <main className="shell"><section className="card"><h2>Unable to load</h2><p>{error}</p><Link href="/">Back to Portfolio</Link></section></main>;

  const top = data.capital_plan.top_opportunities || [];
  const reduce = data.capital_plan.reduce_candidates || [];
  const totalAddPct = top.reduce((s, r) => s + Number(r.add_room_pct || 0), 0) || 1;
  const allocations = top.map(r => ({ ...r, suggested_amount: Math.max(0, Number(amount || 0)) * (Number(r.add_room_pct || 0) / totalAddPct) }));

  return <main className="shell">
    <header className="topbar"><div><div className="eyebrow">PORTFOLIO AI / COMMAND CENTER</div><h1>Where Should Your Next ₹ Go?</h1><p>Ranks your existing holdings by opportunity, risk, freshness and position size.</p></div><div style={{display:"flex",gap:8}}><Link href="/decisions"><button>Decisions</button></Link><Link href="/ai"><button>AI View</button></Link><Link href="/"><button>Portfolio</button></Link></div></header>

    <section className="grid" style={{gridTemplateColumns:"repeat(5,minmax(0,1fr))"}}>
      <div className="card"><span className="label">PORTFOLIO</span><h2>{money(data.portfolio.current_value)}</h2></div>
      <div className="card"><span className="label">ACCUMULATE</span><h2>{data.summary.accumulate}</h2></div>
      <div className="card"><span className="label">HOLD</span><h2>{data.summary.hold}</h2></div>
      <div className="card"><span className="label">REDUCE</span><h2>{data.summary.reduce}</h2></div>
      <div className="card"><span className="label">EXIT</span><h2>{data.summary.exit}</h2></div>
    </section>

    <section className="card"><div className="sectionHead"><div><h2>Capital planner</h2><p>Illustrative allocation of new money across the strongest current opportunities.</p></div><input type="number" min="0" value={amount} onChange={e => setAmount(Number(e.target.value || 0))} style={{width:170,padding:12,border:"1px solid #d9dee8",borderRadius:10}} /></div>
      {allocations.length ? <div className="grid three" style={{marginTop:16}}>{allocations.slice(0,6).map(r => <div className="metricBox" key={r.id}><span>#{r.rank} {r.company_name}</span><strong>{money(r.suggested_amount)}</strong><small>{r.decision} · score {r.score ?? "—"} · current {pct(r.weight_pct)}</small></div>)}</div> : <p>No current holdings meet the accumulation criteria.</p>}
    </section>

    <section className="card"><h2>Top opportunities</h2><div style={{overflowX:"auto"}}><table><thead><tr><th>#</th><th>Company</th><th>Opportunity</th><th>Score</th><th>Weight</th><th>Risk</th><th>Freshness</th><th>Decision</th></tr></thead><tbody>{top.map(r => <tr key={r.id}><td>{r.rank}</td><td><strong>{r.company_name}</strong><small>{r.symbol} · {r.sector}</small></td><td>{r.opportunity_score}</td><td>{r.score == null ? "—" : Number(r.score).toFixed(1)}</td><td>{pct(r.weight_pct)}</td><td>{r.risk}</td><td>{r.freshness}</td><td><Badge>{r.decision}</Badge><small>{r.reason}</small></td></tr>)}</tbody></table></div></section>

    <section className="card"><div className="sectionHead"><h2>Portfolio ranking</h2><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{["ALL","ACCUMULATE","HOLD","WATCH","REDUCE","EXIT"].map(x => <button key={x} onClick={() => setFilter(x)} style={{fontWeight:filter===x?800:400}}>{x}</button>)}</div></div><div style={{overflowX:"auto",marginTop:14}}><table><thead><tr><th>#</th><th>Company</th><th>Value</th><th>Weight</th><th>Score</th><th>Model</th><th>Decision</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{r.rank}</td><td><strong>{r.company_name}</strong><small>{r.symbol}</small></td><td>{money(r.current_value)}</td><td>{pct(r.weight_pct)}</td><td>{r.score == null ? "—" : Number(r.score).toFixed(1)}</td><td><Badge>{r.action}</Badge><small>{r.risk} · {r.confidence ?? "—"}% conf.</small></td><td><Badge>{r.decision}</Badge><small>{r.reason}</small></td></tr>)}</tbody></table></div></section>

    <section className="card"><h2>Capital to review / redeploy</h2>{reduce.length ? <div className="grid three">{reduce.slice(0,6).map(r => <div className="metricBox" key={r.id}><span>{r.decision}</span><strong>{r.company_name}</strong><small>{money(r.current_value)} · {pct(r.weight_pct)} · score {r.score ?? "—"}</small><p>{r.reason}</p></div>)}</div> : <p>No major reduction/exit candidates under the current rules.</p>}</section>

    <div className="card"><small>Engine: {data.engine_version}. This is a ranking/allocation aid, not an automatic trade executor. Technical/live-price data is intentionally not refreshed for every holding in this screen to avoid excessive market-data calls.</small></div>
  </main>;
}
