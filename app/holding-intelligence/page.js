"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

const rank = { EXIT: 0, REDUCE: 1, "HOLD & TRIM": 2, WATCH: 3, HOLD: 4, "BUY MORE": 5 };
function badgeClass(decision) { if (decision === "EXIT" || decision === "REDUCE") return "badge reduce"; if (decision === "BUY MORE" || decision === "HOLD") return "badge hold"; return "badge watch"; }
function factorLabel(key) { return ({ growth_score:"Growth", profitability_score:"Profitability", debt_score:"Debt", ownership_score:"Ownership", cashflow_score:"Cash flow", valuation_score:"Valuation", risk_score:"Risk" })[key] || key; }
function factorRows(score) { return ["growth_score","profitability_score","debt_score","ownership_score","cashflow_score","valuation_score","risk_score"].map(k => [k, score?.[k]]).filter(([,v]) => v !== null && v !== undefined && Number.isFinite(Number(v))); }

export default function HoldingIntelligencePage() {
  const [data, setData] = useState(null), [selected, setSelected] = useState(""), [error, setError] = useState("");
  useEffect(() => { let active = true; (async () => { try { const session = await fetch("/api/auth/session").then(r=>r.ok?r.json():null).catch(()=>null); const token=session?.access_token||session?.session?.access_token; const res=await fetch("/api/decision-engine",{headers:token?{Authorization:`Bearer ${token}`}:{}}); const json=await res.json(); if(!res.ok||!json.success) throw new Error(json.error||"Unable to load decisions."); if(active){setData(json);setSelected(json.decisions?.[0]?.instrument_id||"");} } catch(e){if(active)setError(e.message);} })(); return ()=>{active=false;}; }, []);
  const holding=useMemo(()=>data?.decisions?.find(x=>x.instrument_id===selected)||data?.decisions?.[0],[data,selected]);
  const score=holding?.ai_score == null ? null : data ? null : null;

  return <main style={{maxWidth:1180,margin:"0 auto",padding:"32px 20px 80px"}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"center",marginBottom:24}}><div><div className="eyebrow">HOLDING INTELLIGENCE</div><h1 style={{margin:"6px 0 4px"}}>Investment Decision Center</h1><div className="muted">Exact portfolio data behind the current decision.</div></div><Link href="/dashboard">← Dashboard</Link></div>
    {error&&<div className="card" style={{marginBottom:20}}>{error}</div>}{!data&&!error&&<div className="card">Loading holding intelligence…</div>}
    {data&&holding&&<>
      <div className="card" style={{marginBottom:20}}><div style={{display:"flex",justifyContent:"space-between",gap:20,flexWrap:"wrap"}}><div><div className="muted">{holding.symbol||""}{holding.sector?` • ${holding.sector}`:""}</div><h2 style={{margin:"6px 0"}}>{holding.company_name}</h2><span className={badgeClass(holding.decision)}>{holding.decision}</span></div><div style={{textAlign:"right"}}><div className="muted">Confidence</div><strong style={{fontSize:28}}>{holding.confidence}%</strong></div></div><p style={{margin:"18px 0 0",fontSize:17}}>{holding.reason}</p></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:14,marginBottom:20}}>{[["AI Score",holding.ai_score==null?"—":`${holding.ai_score}/100"],["Risk",holding.risk_level||"—"],["Portfolio Weight",`${holding.portfolio_weight_pct}%"],["P&L",`${holding.pnl_pct}%"],["Data Freshness",holding.freshness_status],["Market Regime",holding.market_regime||"—"]].map(([label,value])=><div className="card" key={label}><div className="muted">{label}</div><strong style={{display:"block",marginTop:7,fontSize:20}}>{value}</strong></div>)}</div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1.4fr) minmax(280px,1fr)",gap:20}}>
        <div className="card"><div className="eyebrow">EVIDENCE</div><h3 style={{marginTop:8}}>Actual score factors</h3><div style={{display:"grid",gap:10,marginTop:14}}>{factorRows(holding).map(([key,value])=><div key={key} style={{display:"grid",gridTemplateColumns:"130px 1fr 55px",alignItems:"center",gap:10}}><span>{factorLabel(key)}</span><div style={{height:8,background:"#e5e7eb",borderRadius:8,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.max(0,Math.min(100,Number(value)))}%`,background:"currentColor"}}/></div><strong>{Number(value).toFixed(1)}</strong></div>)}</div><p className="muted" style={{marginTop:14,fontSize:12}}>Only factor scores stored with the current AI score are shown. No inferred fundamentals.</p></div>
        <div className="card"><div className="eyebrow">DECISION CONTEXT</div><h3 style={{marginTop:8}}>Model action</h3><p>{holding.model_action||"No model action available"}</p><h3>Decision rule</h3><p className="muted">{holding.reason}</p><h3>Checks</h3><ul className="muted" style={{paddingLeft:20}}><li>Score: {holding.ai_score==null?"not available":"available"}</li><li>Risk: {holding.risk_level||"not available"}</li><li>Weight: {holding.portfolio_weight_pct}%</li><li>Freshness: {holding.freshness_status}</li><li>Regime: {holding.market_regime||"not available"}</li></ul></div>
      </div>
      <div className="card" style={{marginTop:20}}><div className="eyebrow">PORTFOLIO DECISIONS</div><div style={{display:"grid",gap:8,marginTop:12}}>{(data.decisions||[]).map(x=><button key={x.instrument_id} onClick={()=>setSelected(x.instrument_id)} style={{textAlign:"left",padding:12,borderRadius:10,border:x.instrument_id===holding.instrument_id?"2px solid currentColor":"1px solid #ddd",background:"transparent",cursor:"pointer"}}><div style={{display:"flex",justifyContent:"space-between",gap:10}}><strong>{x.company_name}</strong><span className={badgeClass(x.decision)}>{x.decision}</span></div><div className="muted" style={{marginTop:5}}>{x.ai_score==null?"No score":`Score ${x.ai_score}`} • Weight {x.portfolio_weight_pct}% • Confidence {x.confidence}%</div></button>)}</div></div>
      <div className="muted" style={{marginTop:14,fontSize:12}}>Engine: {data.engine_version} • Generated {new Date(data.generated_at).toLocaleString()}</div>
    </>}
  </main>;
}
