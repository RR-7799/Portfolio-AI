import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "portfolio_health_v1_0";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function money(v) { return num(v) || 0; }

function addAlert(alerts, severity, type, title, detail, instrument = null) {
  alerts.push({ severity, type, title, detail, instrument });
}

export async function GET() {
  try {
    const [h, i, s, f] = await Promise.all([
      supabase.from("holdings").select("instrument_id,current_value,invested_value,unrealized_pnl,pnl_percentage"),
      supabase.from("instruments").select("id,symbol,company_name,sector"),
      supabase.from("ai_scores").select("instrument_id,total_score,action,rating,risk_level,updated_at,score_breakdown"),
      supabase.from("fundamentals").select("instrument_id,financial_year,shareholding_date"),
    ]);
    if (h.error) throw new Error(h.error.message);
    if (i.error) throw new Error(i.error.message);
    if (s.error) throw new Error(s.error.message);
    if (f.error) throw new Error(f.error.message);

    const instruments = new Map((i.data || []).map(x => [x.id, x]));
    const scores = new Map((s.data || []).map(x => [x.instrument_id, x]));
    const fundamentals = new Map((f.data || []).map(x => [x.instrument_id, x]));

    const byId = new Map();
    for (const row of h.data || []) {
      const p = byId.get(row.instrument_id) || { current_value: 0, invested_value: 0, unrealized_pnl: 0 };
      p.current_value += money(row.current_value);
      p.invested_value += money(row.invested_value);
      p.unrealized_pnl += money(row.unrealized_pnl);
      byId.set(row.instrument_id, p);
    }
    const total = [...byId.values()].reduce((a, x) => a + x.current_value, 0);
    const rows = [...byId.entries()].map(([id, p]) => {
      const inst = instruments.get(id) || {};
      const score = scores.get(id) || {};
      const b = score.score_breakdown || {};
      return {
        id, company_name: inst.company_name || "Unknown", symbol: inst.symbol || "—", sector: inst.sector || "OTHER",
        current_value: p.current_value, invested_value: p.invested_value,
        pnl: p.unrealized_pnl, pnl_pct: p.invested_value ? (p.unrealized_pnl / p.invested_value) * 100 : 0,
        weight: total ? (p.current_value / total) * 100 : 0,
        score: num(score.total_score), action: score.action || "WATCH", risk: score.risk_level || "UNKNOWN",
        freshness: b.freshness?.status || "MISSING", confidence: num(b.confidence ?? b.freshness?.effective_confidence),
        financial_year: fundamentals.get(id)?.financial_year || null,
      };
    }).sort((a, b) => b.weight - a.weight);

    const alerts = [];
    const sectorMap = new Map();
    for (const r of rows) sectorMap.set(r.sector, (sectorMap.get(r.sector) || 0) + r.weight);

    for (const r of rows) {
      if (r.weight >= 10) addAlert(alerts, "HIGH", "CONCENTRATION", "Oversized position", `${r.company_name} is ${r.weight.toFixed(1)}% of the portfolio.`, r);
      else if (r.weight >= 7) addAlert(alerts, "MEDIUM", "CONCENTRATION", "Large position", `${r.company_name} is ${r.weight.toFixed(1)}% of the portfolio.`, r);
      if (r.risk === "HIGH") addAlert(alerts, r.weight >= 5 ? "HIGH" : "MEDIUM", "RISK", "High model risk", `${r.company_name} is classified HIGH risk.`, r);
      if (["STALE", "VERY_STALE", "MISSING"].includes(r.freshness)) addAlert(alerts, "MEDIUM", "DATA", "Weak data freshness", `${r.company_name} has ${r.freshness.toLowerCase()} fundamental data.`, r);
      if (r.action === "REDUCE" && r.score !== null && r.score < 55) addAlert(alerts, "HIGH", "DECISION", "Strong reduce signal", `${r.company_name} has a ${r.score.toFixed(1)} score with REDUCE action.`, r);
      if (r.pnl_pct <= -20) addAlert(alerts, "HIGH", "DRAWDOWN", "Large unrealized loss", `${r.company_name} is down ${Math.abs(r.pnl_pct).toFixed(1)}% on your position.`, r);
    }
    for (const [sector, weight] of sectorMap) {
      if (weight >= 25) addAlert(alerts, "HIGH", "SECTOR", "Sector concentration", `${sector} represents ${weight.toFixed(1)}% of the portfolio.`);
      else if (weight >= 20) addAlert(alerts, "MEDIUM", "SECTOR", "Elevated sector exposure", `${sector} represents ${weight.toFixed(1)}% of the portfolio.`);
    }

    const highRiskCapital = rows.filter(r => r.risk === "HIGH").reduce((a, r) => a + r.weight, 0);
    const weakCapital = rows.filter(r => r.score !== null && r.score < 55).reduce((a, r) => a + r.weight, 0);
    const avgScore = rows.filter(r => r.score !== null).length ? rows.filter(r => r.score !== null).reduce((a, r) => a + r.score, 0) / rows.filter(r => r.score !== null).length : null;
    const healthScore = Math.max(0, Math.min(100, (avgScore ?? 50) - Math.max(0, highRiskCapital - 10) * 0.7 - Math.max(0, weakCapital - 15) * 0.5 - Math.max(0, rows[0]?.weight - 10 || 0) * 0.8));

    alerts.sort((a, b) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.severity] - ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[b.severity])));
    const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const a of alerts) counts[a.severity] += 1;

    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, fetched_at: new Date().toISOString(), summary: {
      health_score: Number(healthScore.toFixed(1)), total_value: total, holdings: rows.length, average_ai_score: avgScore === null ? null : Number(avgScore.toFixed(1)), high_risk_capital_pct: Number(highRiskCapital.toFixed(1)), weak_score_capital_pct: Number(weakCapital.toFixed(1)), alert_counts: counts,
    }, sector_exposure: [...sectorMap.entries()].map(([sector, weight]) => ({ sector, weight: Number(weight.toFixed(2)) })).sort((a,b)=>b.weight-a.weight), alerts, holdings: rows });
  } catch (error) {
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Portfolio health failed." }, { status: 500 });
  }
}
