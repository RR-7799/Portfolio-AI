"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const money = v => v == null ? "—" : new Intl.NumberFormat("en-IN", { style:"currency", currency:"INR", maximumFractionDigits:0 }).format(Number(v));
const pct = v => v == null ? "—" : `${Number(v).toFixed(1)}%`;

export default function HistoryPage(){
  const [data,setData]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[days,setDays]=useState("90");

  async function load(){
    setLoading(true); setError("");
    try{
      const {data:s}=await supabase.auth.getSession();
      if(!s.session) throw new Error("Please sign in on the main dashboard first.");
      const r=await fetch(`/api/portfolio-history?days=${days}`,{headers:{Authorization:`Bearer ${s.session.access_token}`},cache:"no-store"});
      const b=await r.json();
      if(!r.ok||!b.success) throw new Error(b.error||"Unable to load history.");
      setData(b);
    }catch(e){setError(e.message||"Unable to load history.");}
    finally{setLoading(false);}
  }
  useEffect(()=>{load()},[days]);

  const points=useMemo(()=>data?.history||[],[data]);
  const latest=data?.latest||{};
  const min=Math.min(...points.map(x=>Number(x.total_value||0)), Number(latest.total_value||0));
  const max=Math.max(...points.map(x=>Number(x.total_value||0)), Number(latest.total_value||0));

  if(loading) return <main className="shell"><section className="card"><h2>Loading portfolio history…</h2></section></main>;
  if(error) return <main className="shell"><section className="card"><h2>Unable to load</h2><p>{error}</p><Link href="/"><button>Back to Portfolio</button></Link></section></main>;

  return <main className="shell">
    <header className="topbar"><div><div className="eyebrow">PORTFOLIO AI / HISTORY</div><h1>Portfolio History</h1><p>Snapshot-based history of portfolio value, AI health and market regime.</p></div><div style={{display:"flex",gap:8}}><select value={days} onChange={e=>setDays(e.target.value)} style={{padding:"10px 12px",border:"1px solid #d9dee8",borderRadius:10}}><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">1 year</option></select><button onClick={load}>Refresh</button><Link href="/"><button>Portfolio</button></Link></div></header>

    <section className="grid four">
      <div className="card"><span className="label">LATEST VALUE</span><h2>{money(latest.total_value)}</h2><p>{data.count} snapshots</p></div>
      <div className="card"><span className="label">PERIOD CHANGE</span><h2>{money(data.period?.value_change)}</h2><p className={Number(data.period?.value_change||0)>=0?"positive":"negative"}>{pct(data.period?.value_change_pct)}</p></div>
      <div className="card"><span className="label">HEALTH SCORE</span><h2>{latest.health_score==null?"—":Number(latest.health_score).toFixed(1)}</h2><p>Latest snapshot</p></div>
      <div className="card"><span className="label">MARKET REGIME</span><h2>{latest.bull_neutral_bear||"—"}</h2><p>{latest.portfolio_mode||"—"}</p></div>
    </section>

    <section className="card"><div className="sectionHead"><h2>Portfolio value timeline</h2><span className="muted">Range {money(min)} — {money(max)}</span></div>{points.length<2?<p>History needs at least two snapshots before a trend becomes meaningful.</p>:<div style={{display:"grid",gap:10}}>{points.map((x,i)=>{const w=max>min?((Number(x.total_value)-min)/(max-min))*100:100;return <div key={`${x.snapshot_at}-${i}`} className="metricBox"><div style={{display:"flex",justifyContent:"space-between",gap:12}}><strong>{new Date(x.snapshot_at).toLocaleString("en-IN")}</strong><strong>{money(x.total_value)}</strong></div><div className="bar" style={{marginTop:10}}><span style={{width:`${Math.max(2,Math.min(100,w))}%`}} /></div><small>AI {x.average_ai_score==null?"—":Number(x.average_ai_score).toFixed(1)} · Health {x.health_score==null?"—":Number(x.health_score).toFixed(1)} · {x.bull_neutral_bear||"—"}</small></div>})}</div>}</section>

    <section className="card"><h2>Latest snapshot</h2><div className="metricsTable"><div><span>Invested value</span><strong>{money(latest.invested_value)}</strong></div><div><span>Unrealized P/L</span><strong>{money(latest.unrealized_pnl)}</strong></div><div><span>P/L %</span><strong>{pct(latest.pnl_pct)}</strong></div><div><span>Average AI score</span><strong>{latest.average_ai_score==null?"—":Number(latest.average_ai_score).toFixed(1)}</strong></div><div><span>High-risk capital</span><strong>{pct(latest.high_risk_capital_pct)}</strong></div><div><span>Weak-score capital</span><strong>{pct(latest.weak_score_capital_pct)}</strong></div><div><span>Stocks / MF</span><strong>{latest.stock_count??"—"} / {latest.mf_count??"—"}</strong></div><div><span>Portfolio mode</span><strong>{latest.portfolio_mode||"—"}</strong></div></div></section>

    <section className="card"><h2>What this history enables</h2><p>Once snapshots accumulate, Portfolio AI can detect day-over-day deterioration, regime changes, score drift, portfolio drawdowns and improvement trends instead of evaluating only the current state.</p></section>
  </main>;
}
