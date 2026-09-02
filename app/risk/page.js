"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const money = (n) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(n || 0));
const pct = (n) => `${Number(n || 0).toFixed(1)}%`;

function riskTone(risk) {
  const r = String(risk || "").toUpperCase();
  if (r === "LOW") return "buy";
  if (r === "HIGH") return "reduce";
  return "watch";
}

function riskPoints(risk) {
  const r = String(risk || "").toUpperCase();
  return r === "HIGH" ? 100 : r === "MODERATE" ? 55 : 20;
}

function concentrationPoints(weight, limit) {
  if (weight >= limit * 1.5) return 100;
  if (weight >= limit) return 75;
  if (weight >= limit * 0.75) return 40;
  return 10;
}

export default function RiskPage() {
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) load(data.session.user.id); else setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      if (next) load(next.user.id); else { setRows([]); setLoading(false); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  async function load(userId) {
    setLoading(true); setError("");
    try {
      const { data: holdings, error: hErr } = await supabase
        .from("holdings")
        .select("instrument_id,current_value,invested_value")
        .eq("user_id", userId);
      if (hErr) throw hErr;

      const ids = [...new Set((holdings || []).map((x) => x.instrument_id).filter(Boolean))];
      if (!ids.length) { setRows([]); return; }

      const [{ data: instruments, error: iErr }, { data: scores, error: sErr }] = await Promise.all([
        supabase.from("instruments").select("id,symbol,company_name,sector").in("id", ids),
        supabase.from("ai_scores").select("instrument_id,total_score,risk_level,rating,action,score_breakdown,updated_at").in("instrument_id", ids),
      ]);
      if (iErr) throw iErr;
      if (sErr) throw sErr;

      const im = new Map((instruments || []).map((x) => [x.id, x]));
      const sm = new Map((scores || []).map((x) => [x.instrument_id, x]));
      const byId = new Map();
      for (const h of holdings || []) {
        const p = byId.get(h.instrument_id) || { current_value: 0, invested_value: 0 };
        p.current_value += Number(h.current_value || 0);
        p.invested_value += Number(h.invested_value || 0);
        byId.set(h.instrument_id, p);
      }

      const total = [...byId.values()].reduce((s, x) => s + x.current_value, 0);
      const merged = ids.map((id) => {
        const inst = im.get(id) || {};
        const score = sm.get(id) || {};
        const pos = byId.get(id) || {};
        const weight = total ? (pos.current_value / total) * 100 : 0;
        const risk = String(score.risk_level || "UNKNOWN").toUpperCase();
        const stockLimit = risk === "HIGH" ? 4 : risk === "MODERATE" ? 7 : 10;
        const excess = Math.max(0, weight - stockLimit);
        return {
          id,
          company_name: inst.company_name || "Unknown Stock",
          symbol: inst.symbol || "—",
          sector: inst.sector || "OTHER",
          value: pos.current_value || 0,
          weight,
          risk,
          score: Number(score.total_score ?? 0),
          action: score.action || "WATCH",
          rating: score.rating || "—",
          stock_limit: stockLimit,
          excess,
        };
      });
      setRows(merged.sort((a, b) => b.weight - a.weight));
    } catch (e) {
      console.error(e);
      setError(e.message || "Unable to load portfolio risk.");
    } finally {
      setLoading(false);
    }
  }

  const totalValue = useMemo(() => rows.reduce((s, r) => s + r.value, 0), [rows]);

  const sectorRows = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const x = map.get(r.sector) || { sector: r.sector, value: 0, count: 0, highRiskValue: 0 };
      x.value += r.value;
      x.count += 1;
      if (r.risk === "HIGH") x.highRiskValue += r.value;
      map.set(r.sector, x);
    }
    return [...map.values()].map((x) => ({
      ...x,
      weight: totalValue ? x.value / totalValue * 100 : 0,
      riskWeight: totalValue ? x.highRiskValue / totalValue * 100 : 0,
    })).sort((a, b) => b.weight - a.weight);
  }, [rows, totalValue]);

  const summary = useMemo(() => {
    const high = rows.filter((r) => r.risk === "HIGH");
    const moderate = rows.filter((r) => r.risk === "MODERATE");
    const stockConcentration = rows.length ? Math.max(...rows.map((r) => r.weight), 0) : 0;
    const top5 = rows.slice().sort((a, b) => b.weight - a.weight).slice(0, 5).reduce((s, r) => s + r.weight, 0);
    const sectorTop = sectorRows[0]?.weight || 0;
    const highRiskWeight = totalValue ? high.reduce((s, r) => s + r.value, 0) / totalValue * 100 : 0;
    const raw = stockConcentration * 0.35 + top5 * 0.20 + sectorTop * 0.20 + highRiskWeight * 0.15 + (moderate.length ? 10 : 0);
    return {
      riskScore: Math.min(100, Math.max(0, raw)),
      highRiskWeight,
      stockConcentration,
      top5,
      sectorTop,
      highCount: high.length,
    };
  }, [rows, sectorRows, totalValue]);

  const warnings = useMemo(() => {
    const out = [];
    if (summary.stockConcentration > 10) out.push(`Largest stock is ${pct(summary.stockConcentration)} of the portfolio — concentration is above the 10% core-position ceiling.`);
    if (summary.top5 > 45) out.push(`Top 5 holdings represent ${pct(summary.top5)} — portfolio dependency on a few names is high.`);
    if (summary.sectorTop > 25) out.push(`${sectorRows[0]?.sector || "Top sector"} is ${pct(summary.sectorTop)} — sector concentration is above the 25% soft ceiling.`);
    if (summary.highRiskWeight > 10) out.push(`${pct(summary.highRiskWeight)} of portfolio value is in model HIGH-risk holdings.`);
    for (const r of rows.filter((x) => x.excess > 0).slice(0, 5)) out.push(`${r.company_name}: ${pct(r.weight)} position vs ${pct(r.stock_limit)} suggested maximum for its current risk tier.`);
    return out;
  }, [rows, sectorRows, summary]);

  if (!session) return <main className="shell"><section className="card"><h1>Sign in required</h1><p>Please sign in on the main dashboard first.</p><Link href="/">Go to Dashboard</Link></section></main>;

  const riskLabel = summary.riskScore >= 70 ? "HIGH" : summary.riskScore >= 45 ? "MODERATE" : "LOW";

  return <main className="shell">
    <header className="topbar">
      <div><div className="eyebrow">PORTFOLIO AI / RISK ENGINE</div><h1>Portfolio Risk</h1><p>Concentration and risk-tier analysis using your current holdings and AI risk classifications.</p></div>
      <div style={{display:"flex",gap:8}}><Link href="/command-center"><button>Command Center</button></Link><Link href="/ai"><button>AI View</button></Link></div>
    </header>

    {error && <div className="error">{error}</div>}
    {loading ? <section className="card"><h2>Loading risk engine…</h2></section> : <>
      <section className="grid four">
        <div className="card"><span className="label">PORTFOLIO RISK</span><h2>{summary.riskScore.toFixed(0)}/100</h2><p><span className={`badge ${riskTone(riskLabel)}`}>{riskLabel}</span></p></div>
        <div className="card"><span className="label">LARGEST POSITION</span><h2>{pct(summary.stockConcentration)}</h2><p>Single-stock weight</p></div>
        <div className="card"><span className="label">TOP 5 WEIGHT</span><h2>{pct(summary.top5)}</h2><p>Concentration proxy</p></div>
        <div className="card"><span className="label">HIGH-RISK EXPOSURE</span><h2>{pct(summary.highRiskWeight)}</h2><p>{summary.highCount} high-risk holdings</p></div>
      </section>

      <section className="card"><div className="sectionHead"><h2>Risk warnings</h2><span className="muted">Position and sector limits are model guardrails, not regulatory limits.</span></div>{warnings.length ? <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : <p>No major concentration warning from the current model.</p>}</section>

      <section className="card"><h2>Sector exposure</h2>{sectorRows.map((s) => <div key={s.sector} style={{marginBottom:14}}><div style={{display:"flex",justifyContent:"space-between",gap:12}}><strong>{s.sector}</strong><span>{pct(s.weight)} · {s.count} names</span></div><div className="bar"><span style={{width:`${Math.min(100, s.weight)}%`}} /></div>{s.riskWeight > 0 ? <small>{pct(s.riskWeight)} is in HIGH-risk holdings</small> : null}</div>)}</section>

      <section className="card"><h2>Position risk map</h2><div style={{overflowX:"auto"}}><table><thead><tr><th>Company</th><th>Weight</th><th>Risk</th><th>Score</th><th>Suggested max</th><th>Gap</th><th>Action</th></tr></thead><tbody>{rows.map((r) => <tr key={r.id}><td><strong>{r.company_name}</strong><small>{r.symbol} · {r.sector}</small></td><td>{pct(r.weight)}<small>{money(r.value)}</small></td><td><span className={`badge ${riskTone(r.risk)}`}>{r.risk}</span></td><td>{r.score.toFixed(1)}</td><td>{pct(r.stock_limit)}</td><td className={r.excess > 0 ? "negative" : "positive"}>{r.excess > 0 ? `-${pct(r.excess)}` : "Within limit"}</td><td>{r.action}</td></tr>)}</tbody></table></div></section>

      <section className="card"><h2>Risk methodology</h2><p>This screen combines single-stock concentration, top-5 concentration, sector concentration, and the portfolio share classified HIGH risk by the existing AI model. It is a portfolio-risk proxy, not a statistical covariance model.</p><div className="grid four"><div className="metricBox"><span>Single stock</span><strong>10%</strong><small>Soft ceiling for low-risk names</small></div><div className="metricBox"><span>Moderate risk</span><strong>7%</strong><small>Suggested maximum</small></div><div className="metricBox"><span>High risk</span><strong>4%</strong><small>Suggested maximum</small></div><div className="metricBox"><span>Sector ceiling</span><strong>25%</strong><small>Soft concentration ceiling</small></div></div></section>
    </>}
  </main>;
}
