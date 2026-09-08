import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ENGINE_VERSION = "rebalance_v1_6";
const SCORE_VERSION = "ai_scorer_v5_5";
const n = x => { const v = Number(x); return Number.isFinite(v) ? v : null; };
const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
const badFreshness = new Set(["MISSING","STALE","VERY_STALE"]);
const highRisk = new Set(["HIGH","VERY HIGH","CRITICAL"]);

function thesisAction(longTermScore, riskScore) {
  const lt = n(longTermScore);
  if (lt == null) return "WATCH";
  if (n(riskScore) !== null && n(riskScore) < 25) return "EXIT";
  if (lt < 50) return "EXIT";
  if (lt < 70) return "REDUCE";
  if (lt < 80) return "HOLD";
  return "BUY";
}

function allocationEligibility({ longTermScore, risk, confidence, dataCompleteness, freshness }) {
  const lt = n(longTermScore);
  if (lt == null || lt < 70) return false;
  if (highRisk.has(String(risk || "").toUpperCase())) return false;
  if (n(confidence) !== null && n(confidence) < 60) return false;
  if (n(dataCompleteness) !== null && n(dataCompleteness) < 60) return false;
  if (badFreshness.has(String(freshness || "MISSING").toUpperCase())) return false;
  return true;
}

function targetWeight({ longTermScore, risk, currentWeight, eligible }) {
  const lt = n(longTermScore);
  const current = Math.max(n(currentWeight) || 0, 0);
  if (!eligible || lt == null) return null;
  let base = lt >= 82 ? 8 : lt >= 80 ? 7.5 : lt >= 75 ? 7 : 5.5;
  const r = String(risk || "UNKNOWN").toUpperCase();
  if (r === "MODERATE" || r === "LOW-MODERATE") base *= 0.85;
  if (current > 12) base = Math.min(base, 8);
  return Number(clamp(base,0,10).toFixed(2));
}

export async function GET(request) {
  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i,"").trim();
    if (!token) return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Authentication required."},{status:401});
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});
    const {data:user,error:ue} = await client.auth.getUser(token);
    if (ue || !user?.user) return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Invalid session."},{status:401});
    const {searchParams} = new URL(request.url);
    const cash = n(searchParams.get("cash")) ?? 0;
    const {data:holdings,error:hErr} = await client.from("holdings").select("instrument_id,current_value,invested_value,quantity").eq("user_id",user.user.id);
    if (hErr) throw new Error(hErr.message);
    const ids = [...new Set((holdings||[]).map(x=>x.instrument_id).filter(Boolean))];
    if (!ids.length) return NextResponse.json({success:true,engine_version:ENGINE_VERSION,score_version:SCORE_VERSION,portfolio:{current_value:cash},rows:[],actions:[],warnings:["No stock holdings found."]});
    const [{data:instruments,error:iErr},{data:scores,error:sErr}] = await Promise.all([
      client.from("instruments").select("id,symbol,company_name,sector").in("id",ids),
      client.from("ai_scores").select("instrument_id,final_ai_score,long_term_score,short_term_score,risk_score,valuation_score,action,risk_level,rating,score_version,score_breakdown,confidence,data_completeness,freshness_status").eq("user_id",user.user.id).in("instrument_id",ids)
    ]);
    if (iErr) throw new Error(iErr.message);
    if (sErr) throw new Error(sErr.message);
    const im = new Map((instruments||[]).map(x=>[x.id,x]));
    const sm = new Map((scores||[]).filter(x=>x.score_version===SCORE_VERSION).map(x=>[x.instrument_id,x]));
    const byId = new Map();
    for (const h of holdings||[]) {
      const p = byId.get(h.instrument_id) || {current_value:0,invested_value:0,quantity:0};
      p.current_value += Number(h.current_value||0);
      p.invested_value += Number(h.invested_value||0);
      p.quantity += Number(h.quantity||0);
      byId.set(h.instrument_id,p);
    }
    const stockValue = [...byId.values()].reduce((a,b)=>a+b.current_value,0);
    const totalValue = stockValue + cash;
    const rows = ids.map(id => {
      const inst = im.get(id)||{}, score = sm.get(id)||{}, pos = byId.get(id)||{};
      const currentWeight = totalValue ? pos.current_value/totalValue*100 : 0;
      const longTermScore = score.long_term_score ?? null;
      const thesis = thesisAction(longTermScore, score.risk_score);
      const eligible = allocationEligibility({longTermScore,risk:score.risk_level,confidence:score.confidence,dataCompleteness:score.data_completeness,freshness:score.freshness_status});
      const target = targetWeight({longTermScore,risk:score.risk_level,currentWeight,eligible});
      return {id,company_name:inst.company_name||"Unknown",symbol:inst.symbol||"—",sector:inst.sector||"OTHER",current_value:pos.current_value||0,current_weight:Number(currentWeight.toFixed(2)),score:score.final_ai_score??null,long_term_score:longTermScore,short_term_score:score.short_term_score??null,risk_score:score.risk_score??null,valuation_score:score.valuation_score??null,risk:score.risk_level||"—",action:thesis,scorer_action:score.action||null,score_version:score.score_version||"MISSING",confidence:score.confidence??null,data_completeness:score.data_completeness??null,freshness:score.freshness_status||"MISSING",allocation_eligible:eligible,target_weight:target,difference:target==null?null:Number((target-currentWeight).toFixed(2))};
    }).sort((a,b)=>{
      if (a.allocation_eligible !== b.allocation_eligible) return a.allocation_eligible ? -1 : 1;
      return (b.long_term_score??-Infinity)-(a.long_term_score??-Infinity);
    });
    const deployable = Math.max(totalValue,0);
    const actions = rows.map(r => {
      if (!r.allocation_eligible || r.target_weight == null) return {...r,action_plan:r.action==="EXIT"?"TRIM/EXIT":"HOLD",estimated_rupees:0};
      const delta = deployable*(r.difference/100);
      let actionPlan = "HOLD";
      if (r.action === "EXIT" && r.current_weight > 0.5) actionPlan = "TRIM/EXIT";
      else if (r.allocation_eligible && r.difference > 1.0) actionPlan = "ADD";
      else if (r.action === "REDUCE" && r.difference < -0.5) actionPlan = "TRIM";
      return {...r,action_plan:actionPlan,estimated_rupees:Number(Math.abs(delta).toFixed(0))};
    });
    const warnings = [];
    const top = rows.slice().sort((a,b)=>b.current_weight-a.current_weight).slice(0,5).reduce((s,r)=>s+r.current_weight,0);
    if (top > 55) warnings.push(`Top 5 holdings represent ${top.toFixed(1)}% of portfolio.`);
    const high = rows.filter(r=>highRisk.has(r.risk)).reduce((s,r)=>s+r.current_weight,0);
    if (high > 20) warnings.push(`High-risk holdings represent ${high.toFixed(1)}% of portfolio.`);
    const eligibleCount = rows.filter(r=>r.allocation_eligible).length;
    if (eligibleCount) warnings.push(`${eligibleCount} long-term candidates meet the V5.5 fundamentals, data-quality and risk gates. Short-term score is not used for eligibility.`);
    const missing = rows.filter(r=>r.score_version!==SCORE_VERSION).length;
    if (missing) warnings.push(`${missing} holding(s) have no V5.5 score; no allocation change is recommended for them.`);
    return NextResponse.json({success:true,engine_version:ENGINE_VERSION,score_version:SCORE_VERSION,portfolio:{stock_value:stockValue,cash,total_value:totalValue},rows:actions,warnings});
  } catch (error) {
    return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Rebalance failed."},{status:500});
  }
}
