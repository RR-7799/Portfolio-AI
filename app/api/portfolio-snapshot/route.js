import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "portfolio_snapshot_v1_0";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function authorized(request) {
  const secret = process.env.PIPELINE_SECRET;
  if (!secret) return false;
  const h = request.headers.get("x-pipeline-secret") || "";
  const a = request.headers.get("authorization") || "";
  return h === secret || a === `Bearer ${secret}`;
}

async function getRegime(origin) {
  try {
    const r = await fetch(`${origin}/api/market-regime`, { cache: "no-store" });
    const b = await r.json();
    if (!r.ok || !b.success) return null;
    return b.regime || null;
  } catch { return null; }
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Unauthorized" }, { status:401 });

  try {
    const [h, m, i, s, mf] = await Promise.all([
      supabase.from("holdings").select("user_id,instrument_id,current_value,invested_value,unrealized_pnl"),
      supabase.from("mf_holdings").select("user_id,mutual_fund_id,current_value,invested_value,unrealized_pnl"),
      supabase.from("instruments").select("id"),
      supabase.from("ai_scores").select("instrument_id,total_score,risk_level,score_breakdown"),
      supabase.from("mutual_funds").select("id")
    ]);
    if (h.error) throw new Error(h.error.message);
    if (m.error) throw new Error(m.error.message);
    if (s.error) throw new Error(s.error.message);

    const scoreMap = new Map((s.data||[]).map(x => [x.instrument_id, x]));
    const userIds = [...new Set([...(h.data||[]).map(x=>x.user_id), ...(m.data||[]).map(x=>x.user_id)].filter(Boolean))];
    const origin = new URL(request.url).origin;
    const regime = await getRegime(origin);

    const rows = [];
    for (const userId of userIds) {
      const stocks = (h.data||[]).filter(x=>x.user_id===userId);
      const mfs = (m.data||[]).filter(x=>x.user_id===userId);
      const stockValue = stocks.reduce((a,x)=>a+num(x.current_value),0);
      const mfValue = mfs.reduce((a,x)=>a+num(x.current_value),0);
      const invested = stocks.reduce((a,x)=>a+num(x.invested_value),0) + mfs.reduce((a,x)=>a+num(x.invested_value),0);
      const pnl = stocks.reduce((a,x)=>a+num(x.unrealized_pnl),0) + mfs.reduce((a,x)=>a+num(x.unrealized_pnl),0);
      const total = stockValue + mfValue;

      let weightedScore = 0, scoreWeight = 0, highRiskWeight = 0, weakWeight = 0;
      for (const x of stocks) {
        const value = num(x.current_value);
        const w = total > 0 ? value / total : 0;
        const score = scoreMap.get(x.instrument_id);
        if (score?.total_score != null) { weightedScore += num(score.total_score) * w; scoreWeight += w; }
        if (String(score?.risk_level||"").toUpperCase()==="HIGH") highRiskWeight += w;
        if (score?.total_score != null && num(score.total_score) < 55) weakWeight += w;
      }
      const avgScore = scoreWeight > 0 ? weightedScore / scoreWeight : null;
      const largestStockWeight = stocks.length ? Math.max(...stocks.map(x=>total>0?num(x.current_value)/total*100:0)) : 0;
      const health = Math.max(0, Math.min(100,
        (avgScore ?? 50) - Math.max(0, highRiskWeight*100-10)*0.7 - Math.max(0, weakWeight*100-15)*0.5 - Math.max(0, largestStockWeight-10)*0.8
      ));

      rows.push({ user_id:userId, total_value:total, invested_value:invested, unrealized_pnl:pnl, pnl_pct:invested>0?pnl/invested*100:0, stock_value:stockValue, mf_value:mfValue, stock_count:stocks.length, mf_count:mfs.length, average_ai_score:avgScore, health_score:health, high_risk_capital_pct:highRiskWeight*100, weak_score_capital_pct:weakWeight*100, bull_neutral_bear:regime?.label||null, portfolio_mode:regime?.portfolio_mode||null, summary:{ regime:regime?.label||null, score:regime?.score??null, confidence:regime?.confidence??null } });
    }

    if (rows.length) {
      const { error } = await supabase.from("portfolio_snapshots").insert(rows);
      if (error) throw new Error(`Snapshot insert failed: ${error.message}`);
    }

    if (regime) {
      const { error } = await supabase.from("market_regime_history").insert({ snapshot_at:new Date().toISOString(), regime:regime.label, score:num(regime.score), confidence:num(regime.confidence), portfolio_mode:regime.portfolio_mode||null, buy_multiplier:regime.buy_multiplier??null, position_target_multiplier:regime.position_target_multiplier??null, indicators:regime });
      if (error) throw new Error(`Regime history insert failed: ${error.message}`);
    }

    return NextResponse.json({ success:true, engine_version:ENGINE_VERSION, snapshot_at:new Date().toISOString(), users:rows.length, regime_recorded:Boolean(regime), rows:rows.map(x=>({user_id:x.user_id,total_value:x.total_value,health_score:x.health_score,average_ai_score:x.average_ai_score})) });
  } catch (error) {
    console.error("Portfolio snapshot error:", error);
    return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:error?.message||"Snapshot failed." }, { status:500 });
  }
}
