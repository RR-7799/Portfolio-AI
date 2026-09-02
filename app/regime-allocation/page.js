"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const money = (v) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(v || 0));
const pct = (v) => `${Number(v || 0).toFixed(1)}%`;

function Badge({ children }) {
  const v = String(children || "").toUpperCase();
  const cls = v === "BULL" || v === "ACCUMULATE" ? "buy" : v === "BEAR" || v === "EXIT" || v === "REDUCE" ? "reduce" : "watch";
  return <span className={`badge ${cls}`}>{children}</span>;
}

export default function RegimeAllocationPage() {
  const [session, setSession] = useState(null);
  const [cash, setCash] = useState("100000");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: s }) => {
      if (!mounted) return;
      setSession(s.session);
      if (s.session) load(s.session.access_token, cash);
      else setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      if (next) load(next.access_token, cash); else { setData(null); setLoading(false); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  async function load(token, amount = cash) {
    setLoading(true); setError("");
    try {
      const r = await fetch(`/api/regime-aware-allocation?cash=${encodeURIComponent(Number(amount || 0))}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const b = await r.json();
      if (!r.ok || !b.success) throw new Error(b.error || "Unable to load regime-aware allocation.");
      setData(b);
    } catch (e) { setError(e.message || "Unable to load allocation."); }
    finally { setLoading(false); }
  }

  const quickAmounts = useMemo(() => [10000, 50000, 100000, 500000], []);

  if (!session) return <main className="shell"><section className="card"><h1>Sign in required</h1><p>Please sign in on the main dashboard first.</p><Link href="/">Go to Dashboard</Link></section></main>;
  if (loading && !data) return <main className="shell"><section className="card"><h2>Building regime-aware allocation…</h2></section></main>;

  const r = data?.regime;
  const p = data?.portfolio;

  return <main className="shell">
    <header className="topbar">
      <div><div className="eyebrow">PORTFOLIO AI / REGIME-AWARE ALLOCATION</div><h1>Where Should New Money Go?</h1><p>Market regime, portfolio position size, AI score, freshness and risk are combined before capital is allocated.</p></div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><Link href="/market-regime"><button>Market Regime</button></Link><Link href="/rebalance"><button>Rebalancer</button></Link><Link href="/command-center"><button>Command Center</button></Link></div>
    </header>

    {error && <div className="error">{error}</div>}

    {data && <>
      <section className="card heroStock">
        <div><span className="label">CURRENT MARKET MODE</span><h1><Badge>{r.label}</Badge></h1><p>{r.guidance}</p></div>
        <div className="heroScore"><span className="label">REGIME SCORE</span><strong>{Number(r.score).toFixed(1)}/100</strong><div><span className="badge">Confidence {r.confidence}%</span></div></div>
      </section>

      <section className="grid four">
        <div className="card"><span className="label">NEW CASH</span><h2>{money(p.new_cash)}</h2><p>Edit below and recalculate.</p></div>
        <div className="card"><span className="label">DEPLOYABLE NOW</span><h2>{money(p.deployable_cash)}</h2><p>After regime overlay</p></div>
        <div className="card"><span className="label">RESERVE</span><h2>{money(p.reserve_cash)}</h2><p>Held back intentionally</p></div>
        <div className="card"><span className="label">QUALIFIED</span><h2>{data.summary.eligible}</h2><p>Current allocation candidates</p></div>
      </section>

      <section className="card">
        <div className="sectionHead"><div><h2>Capital control</h2><p>In bear/neutral conditions the engine deliberately keeps part of fresh cash in reserve.</p></div><strong>{r.portfolio_mode}</strong></div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center",marginTop:12}}><input type="number" min="0" value={cash} onChange={e=>setCash(e.target.value)} style={{padding:12,border:"1px solid #d9dee8",borderRadius:10,width:180}}/><button onClick={()=>load(session.access_token,cash)} className="primaryAction">Recalculate</button>{quickAmounts.map(a=><button key={a} onClick={()=>{setCash(String(a));load(session.access_token,a)}}>{money(a)}</button>)}</div>
      </section>

      {data.warnings?.length ? <section className="card"><h2>Allocation warnings</h2>{data.warnings.map((w,i)=><p key={i}>⚠ {w}</p>)}</section> : null}

      <section className="card">
        <div className="sectionHead"><h2>Recommended deployment</h2><span className="muted">Allocated {money(p.allocated_cash)} · Unallocated {money(p.unallocated_deployable)}</span></div>
        {data.allocations?.length ? <div style={{overflowX:"auto",marginTop:12}}><table><thead><tr><th>#</th><th>Company</th><th>Score</th><th>Current</th><th>Target</th><th>Opportunity</th><th>Share</th><th>Suggested</th><th>Why</th></tr></thead><tbody>{data.allocations.map((x,i)=><tr key={x.id}><td>{i+1}</td><td><strong>{x.company_name}</strong><small>{x.symbol} · {x.sector}</small></td><td>{x.score == null ? "—" : Number(x.score).toFixed(1)}</td><td>{pct(x.current_weight)}</td><td>{pct(x.target_weight)}</td><td>{Number(x.opportunity_score).toFixed(1)}</td><td>{pct(x.allocation_pct_of_deployable)}</td><td><strong>{money(x.recommended_amount)}</strong></td><td>{x.reason}</td></tr>)}</tbody></table></div> : <div className="metricBox"><strong>No stock clears the current regime-adjusted hurdle.</strong><p>Keep the reserve until a stronger opportunity appears or the regime improves.</p></div>}
      </section>

      <section className="card"><h2>Full ranking</h2><div style={{overflowX:"auto"}}><table><thead><tr><th>#</th><th>Company</th><th>Opportunity</th><th>Score</th><th>Risk</th><th>Freshness</th><th>Eligible</th><th>Reason</th></tr></thead><tbody>{(data.ranking || []).map(x=><tr key={x.id}><td>{x.rank || "—"}</td><td><strong>{x.company_name}</strong><small>{x.symbol} · {x.sector}</small></td><td>{Number(x.opportunity_score).toFixed(1)}</td><td>{x.score == null ? "—" : Number(x.score).toFixed(1)}</td><td><Badge>{x.risk}</Badge></td><td>{x.freshness}</td><td>{x.eligible ? <Badge>ACCUMULATE</Badge> : <Badge>BLOCKED</Badge>}</td><td>{x.reason}</td></tr>)}</tbody></table></div></section>

      <section className="grid two">
        <div className="card"><h2>Regime rules</h2><div className="metricsTable"><div><span>BULL</span><strong>100% deploy · score ≥72</strong></div><div><span>NEUTRAL</span><strong>70% deploy · score ≥82</strong></div><div><span>BEAR</span><strong>35% deploy · score ≥90</strong></div></div></div>
        <div className="card"><h2>Risk caps</h2><div className="metricsTable"><div><span>LOW risk</span><strong>10% max target</strong></div><div><span>MODERATE risk</span><strong>7% max target</strong></div><div><span>HIGH risk</span><strong>4% max target</strong></div></div></div>
      </section>

      <section className="card"><small>Engine: {data.engine_version}. The suggested amounts are a rules-based portfolio allocation aid, not trade execution or a guarantee of returns.</small></section>
    </>}
  </main>;
}
