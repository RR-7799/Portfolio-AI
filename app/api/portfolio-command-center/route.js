import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "portfolio_command_center_v2_2";
const SCORE_VERSION = "ai_scorer_v5_5";
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const up = (v) => String(v || "").toUpperCase();

function userClient(token) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

function decision(row, weight) {
  const lt = n(row.long_term_score), risk = n(row.risk_score);
  const confidence = n(row.confidence), completeness = n(row.data_completeness);
  const fresh = up(row.freshness_status);
  if (lt == null || confidence == null || confidence < 60 || completeness == null || completeness < 60 || !fresh || ["MISSING", "STALE", "VERY_STALE"].includes(fresh)) return ["WATCH", 1, "V5.5 data quality is insufficient for a reliable thesis decision."];
  if (risk != null && risk < 25) return ["EXIT", 0, "Severe risk is a safety override."];
  if (lt < 50) return ["EXIT", 0, "Long-Term Score is below the core-investment threshold."];
  if (lt < 70) return ["REDUCE", 0, "Long-Term Score is below the core-investment threshold."];
  if (lt < 80) return ["HOLD", 3, "Long-Term thesis remains constructive; current conditions do not justify aggressive adding."];
  return ["BUY", 6, "Long-Term Score supports a core BUY thesis."];
}

export async function GET(request) {
  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Authentication required." }, { status: 401 });
    const supabase = userClient(token);
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth?.user) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Invalid session." }, { status: 401 });
    const userId = auth.user.id;

    const [h, i, s, m] = await Promise.all([
      supabase.from("holdings").select("instrument_id,current_value,invested_value,quantity").eq("user_id", userId).not("instrument_id", "is", null),
      supabase.from("instruments").select("id,symbol,company_name,sector"),
      supabase.from("ai_scores").select("instrument_id,long_term_score,short_term_score,risk_score,valuation_score,final_ai_score,confidence,data_completeness,freshness_status,score_version,risk_level,rating,updated_at").eq("user_id", userId).eq("score_version", SCORE_VERSION),
      supabase.from("market_regime_history").select("regime,portfolio_mode,snapshot_at").order("snapshot_at", { ascending: false }).limit(1)
    ]);
    for (const x of [h, i, s, m]) if (x.error) throw x.error;

    const inst = new Map((i.data || []).map(x => [x.id, x]));
    const scores = new Map((s.data || []).map(x => [x.instrument_id, x]));
    const positions = new Map();
    for (const r of h.data || []) {
      const p = positions.get(r.instrument_id) || { current_value: 0, invested_value: 0, quantity: 0 };
      p.current_value += n(r.current_value) || 0; p.invested_value += n(r.invested_value) || 0; p.quantity += n(r.quantity) || 0;
      positions.set(r.instrument_id, p);
    }
    const total = [...positions.values()].reduce((a, p) => a + p.current_value, 0);
    const regime = m.data?.[0]?.regime || "NEUTRAL";
    const rows = [];
    for (const [id, p] of positions) {
      const x = inst.get(id) || {}, sc = scores.get(id) || {}, weight = total ? p.current_value / total * 100 : 0;
      const [action, priority, reason] = decision(sc, weight);
      rows.push({ id, company_name: x.company_name || "Unknown Stock", symbol: x.symbol || "—", sector: x.sector || "OTHER", current_value: p.current_value, invested_value: p.invested_value, quantity: p.quantity, weight_pct: +weight.toFixed(2), long_term_score: n(sc.long_term_score), short_term_score: n(sc.short_term_score), risk_score: n(sc.risk_score), valuation_score: n(sc.valuation_score), final_ai_score: n(sc.final_ai_score), confidence: n(sc.confidence), data_completeness: n(sc.data_completeness), freshness: sc.freshness_status || "MISSING", score_version: SCORE_VERSION, action, risk: sc.risk_level || "—", rating: sc.rating || "—", priority, reason, updated_at: sc.updated_at || null });
    }
    rows.sort((a, b) => a.priority - b.priority || (b.long_term_score ?? 0) - (a.long_term_score ?? 0));
    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, score_version: SCORE_VERSION, market_regime: regime, portfolio: { current_value: total, stock_count: rows.length }, summary: { core_quality: rows.filter(r => (r.long_term_score ?? 0) >= 70).length, buy: rows.filter(r => r.action === "BUY").length, hold: rows.filter(r => r.action === "HOLD").length, watch: rows.filter(r => r.action === "WATCH").length, reduce: rows.filter(r => r.action === "REDUCE").length, exit: rows.filter(r => r.action === "EXIT").length }, ranking: rows });
  } catch (error) {
    console.error("Command center v2.2 error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Command center failed." }, { status: 500 });
  }
}
