import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "portfolio_command_center_v1_0";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function decision(row, weight) {
  const score = num(row.total_score);
  const risk = String(row.risk_level || "UNKNOWN").toUpperCase();
  const action = String(row.action || "WATCH").toUpperCase();
  const f = String(row.freshness_status || "MISSING").toUpperCase();
  const confidence = num(row.confidence);

  if (["MISSING", "VERY_STALE"].includes(f)) return { decision: score >= 70 ? "WATCH" : "HOLD", priority: 1, reason: "Data freshness limits conviction." };
  if (risk === "HIGH" && score < 65) return { decision: weight >= 4 ? "REDUCE" : "EXIT", priority: 0, reason: "Weak score combined with high model risk." };
  if ((action === "BUY" || score >= 82) && confidence >= 75 && risk !== "HIGH") {
    if (weight >= 10) return { decision: "HOLD", priority: 2, reason: "Strong candidate, but already highly concentrated." };
    if (weight >= 6) return { decision: "ACCUMULATE ON PULLBACK", priority: 5, reason: "Strong score, with a meaningful existing position." };
    return { decision: "ACCUMULATE", priority: 6, reason: "Strong score, confidence and manageable position size." };
  }
  if (score >= 72) return { decision: weight >= 10 ? "HOLD / TRIM ON STRENGTH" : "HOLD", priority: 3, reason: weight >= 10 ? "Good quality but portfolio weight is high." : "Good quality without a strong enough edge for aggressive buying." };
  if (score >= 58) return { decision: "WATCH", priority: 1, reason: "Mixed model signals." };
  return { decision: weight >= 6 ? "REDUCE" : "EXIT", priority: 0, reason: "Weak model score; capital is better redeployed." };
}

export async function GET() {
  try {
    const [h, i, s] = await Promise.all([
      supabase.from("holdings").select("instrument_id,current_value,invested_value,quantity").not("instrument_id","is",null),
      supabase.from("instruments").select("id,symbol,company_name,sector"),
      supabase.from("ai_scores").select("instrument_id,total_score,action,risk_level,rating,score_breakdown,updated_at"),
    ]);
    if (h.error) throw h.error;
    if (i.error) throw i.error;
    if (s.error) throw s.error;

    const inst = new Map((i.data || []).map(x => [x.id, x]));
    const scores = new Map((s.data || []).map(x => [x.instrument_id, x]));
    const positions = new Map();
    for (const row of h.data || []) {
      const p = positions.get(row.instrument_id) || { current_value: 0, invested_value: 0, quantity: 0 };
      p.current_value += num(row.current_value); p.invested_value += num(row.invested_value); p.quantity += num(row.quantity);
      positions.set(row.instrument_id, p);
    }
    const total = [...positions.values()].reduce((a, p) => a + p.current_value, 0);
    const rows = [];
    for (const [id, p] of positions) {
      const x = inst.get(id) || {};
      const score = scores.get(id) || {};
      const b = score.score_breakdown || {};
      const f = b.freshness || {};
      const weight = total ? (p.current_value / total) * 100 : 0;
      const d = decision({ ...score, confidence: b.confidence ?? f.effective_confidence, freshness_status: f.status }, weight);
      const rawScore = score.total_score == null ? null : num(score.total_score);
      const freshnessPenalty = ["MISSING","VERY_STALE","STALE"].includes(String(f.status||"").toUpperCase()) ? 0.7 : 1;
      const riskPenalty = String(score.risk_level||"").toUpperCase() === "HIGH" ? 0.65 : String(score.risk_level||"").toUpperCase() === "MODERATE" ? 0.88 : 1;
      const opportunity = rawScore == null ? 0 : rawScore * freshnessPenalty * riskPenalty * (1 - Math.min(weight, 12) / 30);
      rows.push({ id, company_name: x.company_name || "Unknown Stock", symbol: x.symbol || "—", sector: x.sector || "OTHER", current_value: p.current_value, invested_value: p.invested_value, quantity: p.quantity, weight_pct: Number(weight.toFixed(2)), score: rawScore, action: score.action || "WATCH", risk: score.risk_level || "—", rating: score.rating || "—", confidence: b.confidence ?? f.effective_confidence ?? null, freshness: f.status || "MISSING", decision: d.decision, reason: d.reason, opportunity_score: Number(opportunity.toFixed(1)), updated_at: score.updated_at || null });
    }

    rows.sort((a,b) => b.opportunity_score - a.opportunity_score);
    rows.forEach((r, idx) => { r.rank = idx + 1; });

    const investable = rows.filter(r => ["ACCUMULATE","ACCUMULATE ON PULLBACK"].includes(r.decision));
    const reduce = rows.filter(r => ["REDUCE","EXIT","HOLD / TRIM ON STRENGTH"].includes(r.decision));
    const targetWeights = investable.map(r => ({ ...r, target_weight_pct: clamp(4 + Math.max(0, r.score - 75) * 0.22, 4, 9) })).sort((a,b) => b.opportunity_score - a.opportunity_score);
    const targetSum = targetWeights.reduce((a,r) => a + r.target_weight_pct, 0) || 1;
    targetWeights.forEach(r => { r.normalized_target_pct = Number((r.target_weight_pct / targetSum * 100).toFixed(1)); r.add_room_pct = Number(Math.max(0, r.normalized_target_pct - r.weight_pct).toFixed(1)); });

    return NextResponse.json({ success:true, engine_version:ENGINE_VERSION, portfolio:{ current_value:total, stock_count:rows.length }, summary:{ accumulate:rows.filter(r=>r.decision.startsWith("ACCUMULATE")).length, hold:rows.filter(r=>r.decision.startsWith("HOLD")).length, watch:rows.filter(r=>r.decision==="WATCH").length, reduce:reduce.length, exit:rows.filter(r=>r.decision==="EXIT").length }, ranking:rows, capital_plan:{ top_opportunities:targetWeights.slice(0,10), reduce_candidates:reduce.sort((a,b)=>a.opportunity_score-b.opportunity_score).slice(0,10) } });
  } catch (error) {
    console.error("Portfolio command center error:", error);
    return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:error?.message || "Command center failed." }, { status:500 });
  }
}
