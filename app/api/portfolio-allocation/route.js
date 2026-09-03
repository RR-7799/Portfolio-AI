import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "portfolio_allocation_v1_0";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const avg = (a, f = 0) => { const x = a.map(n).filter(v => v !== null); return x.length ? x.reduce((p,c) => p+c, 0) / x.length : f; };
const up = v => String(v || "").toUpperCase();

function actionFactor(action) {
  switch (up(action)) {
    case "BUY": return 1.30;
    case "ACCUMULATE": return 1.20;
    case "HOLD": return 1.00;
    case "WATCH": return 0.78;
    case "REDUCE": return 0.50;
    case "EXIT": return 0;
    default: return 0.80;
  }
}

function riskFactor(risk) {
  switch (up(risk)) {
    case "LOW": return 1.00;
    case "MODERATE": return 0.88;
    case "HIGH": return 0.62;
    case "CRITICAL": return 0.20;
    default: return 0.78;
  }
}

function buildAllocation(rows, portfolioValue, regime) {
  const candidates = rows.map(row => {
    const score = n(row.ai_score) ?? 50;
    const quality = avg([row.profitability_score && n(row.profitability_score) / 20 * 100, row.debt_score && n(row.debt_score) / 10 * 100, row.cashflow_score && n(row.cashflow_score) / 10 * 100, row.ownership_score && n(row.ownership_score) / 10 * 100], score);
    const confidence = n(row.confidence) ?? 70;
    const action = up(row.decision || row.action);
    const risk = up(row.risk_level);
    const regimeFactor = up(regime) === "BEAR" && ["BUY", "ACCUMULATE"].includes(action) ? 0.82 : up(regime) === "BULL" && ["BUY", "ACCUMULATE"].includes(action) ? 1.05 : 1;
    const conviction = clamp((score * 0.55) + (quality * 0.25) + (confidence * 0.20));
    const raw = conviction * actionFactor(action) * riskFactor(risk) * regimeFactor;
    const current = n(row.portfolio_weight_pct) || 0;
    return { ...row, current_weight_pct: current, conviction: +conviction.toFixed(1), raw_weight: raw };
  });

  const eligible = candidates.filter(x => x.decision !== "EXIT");
  const rawTotal = eligible.reduce((s,x) => s + x.raw_weight, 0);
  const maxWeight = up(regime) === "BEAR" ? 10 : 15;
  const preliminary = candidates.map(x => ({ ...x, target_weight_pct: x.decision === "EXIT" || rawTotal <= 0 ? 0 : clamp((x.raw_weight / rawTotal) * 100, 0, maxWeight) }));

  // Redistribute weight left behind by the per-position cap, without increasing EXIT positions.
  for (let pass = 0; pass < 4; pass++) {
    const total = preliminary.reduce((s,x) => s + x.target_weight_pct, 0);
    const remaining = 100 - total;
    if (remaining <= 0.05) break;
    const open = preliminary.filter(x => x.decision !== "EXIT" && x.target_weight_pct < maxWeight - 0.01);
    const openRaw = open.reduce((s,x) => s + x.raw_weight, 0);
    if (!open.length || openRaw <= 0) break;
    for (const x of open) {
      x.target_weight_pct = clamp(x.target_weight_pct + remaining * (x.raw_weight / openRaw), 0, maxWeight);
    }
  }

  return preliminary.map(x => {
    const delta = x.target_weight_pct - x.current_weight_pct;
    let priority = "LOW";
    if (x.decision === "EXIT") priority = "URGENT";
    else if (Math.abs(delta) >= 4 || x.decision === "BUY") priority = "HIGH";
    else if (Math.abs(delta) >= 2 || x.decision === "ACCUMULATE" || x.decision === "REDUCE") priority = "MEDIUM";
    const direction = delta > 0.5 ? "ADD" : delta < -0.5 ? "TRIM" : "HOLD";
    const reason = x.decision === "EXIT" ? "Remove capital because the decision engine identifies material thesis/risk impairment." :
      direction === "ADD" ? `Increase toward ${x.target_weight_pct.toFixed(1)}% based on conviction, decision, quality, risk and market regime.` :
      direction === "TRIM" ? `Reduce toward ${x.target_weight_pct.toFixed(1)}% because current exposure exceeds the adaptive risk/reward target.` :
      "Current exposure is broadly aligned with the adaptive target.";
    return {
      instrument_id: x.instrument_id,
      company_name: x.company_name,
      symbol: x.symbol,
      sector: x.sector,
      decision: x.decision,
      risk_level: x.risk_level,
      ai_score: x.ai_score,
      confidence: x.confidence,
      current_weight_pct: +x.current_weight_pct.toFixed(2),
      target_weight_pct: +x.target_weight_pct.toFixed(2),
      change_weight_pct: +delta.toFixed(2),
      direction,
      priority,
      reason,
      allocation_engine_version: ENGINE_VERSION
    };
  });
}

export async function GET(request) {
  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Authentication required." }, { status:401 });
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global:{ headers:{ Authorization:`Bearer ${token}` } } });
    const { data:userResult, error:userError } = await client.auth.getUser(token);
    if (userError || !userResult?.user) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Invalid session." }, { status:401 });
    const userId = userResult.user.id;

    const [h,i,s,mr] = await Promise.all([
      client.from("holdings").select("instrument_id,current_value").eq("user_id",userId),
      client.from("instruments").select("id,company_name,symbol,sector"),
      client.from("ai_scores").select("instrument_id,total_score,growth_score,profitability_score,debt_score,ownership_score,cashflow_score,valuation_score,risk_score,risk_level,action").eq("user_id",userId),
      client.from("market_regime_history").select("regime,portfolio_mode,snapshot_at").order("snapshot_at",{ascending:false}).limit(1)
    ]);
    for (const x of [h,i,s,mr]) if (x.error) throw new Error(x.error.message);

    const im = new Map((i.data||[]).map(x=>[x.id,x]));
    const sm = new Map((s.data||[]).map(x=>[x.instrument_id,x]));
    const total = (h.data||[]).reduce((a,x)=>a+(n(x.current_value)||0),0);
    const regime = mr.data?.[0]?.regime || null;
    const rows = (h.data||[]).map(x => {
      const score = sm.get(x.instrument_id)||{};
      const meta = im.get(x.instrument_id)||{};
      return {
        instrument_id:x.instrument_id,
        company_name:meta.company_name||meta.symbol||"Holding",
        symbol:meta.symbol||null,
        sector:meta.sector||"OTHER",
        portfolio_weight_pct:total>0?(n(x.current_value)||0)/total*100:0,
        ai_score:score.total_score,
        growth_score:score.growth_score,
        profitability_score:score.profitability_score,
        debt_score:score.debt_score,
        ownership_score:score.ownership_score,
        cashflow_score:score.cashflow_score,
        valuation_score:score.valuation_score,
        risk_score:score.risk_score,
        risk_level:score.risk_level,
        decision:score.action,
        confidence:null
      };
    });

    const allocations = buildAllocation(rows,total,regime);
    allocations.sort((a,b) => ({URGENT:0,HIGH:1,MEDIUM:2,LOW:3}[a.priority]??9)-({URGENT:0,HIGH:1,MEDIUM:2,LOW:3}[b.priority]??9) || Math.abs(b.change_weight_pct)-Math.abs(a.change_weight_pct));
    const summary = {
      portfolio_value:total,
      market_regime:regime,
      total_positions:allocations.length,
      add_count:allocations.filter(x=>x.direction==="ADD").length,
      trim_count:allocations.filter(x=>x.direction==="TRIM").length,
      exit_count:allocations.filter(x=>x.decision==="EXIT").length,
      high_priority_count:allocations.filter(x=>["URGENT","HIGH"].includes(x.priority)).length,
      target_weight_total:+allocations.reduce((s,x)=>s+x.target_weight_pct,0).toFixed(2)
    };
    return NextResponse.json({ success:true, engine_version:ENGINE_VERSION, generated_at:new Date().toISOString(), summary, allocations });
  } catch (error) {
    console.error("Portfolio allocation error:",error);
    return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:error?.message||"Portfolio allocation failed." }, { status:500 });
  }
}
