import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "decision_engine_v1_0";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

function userClient(token) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
}

function decision(score, risk, weight, pnl, freshness, regime) {
  const s = n(score);
  const r = String(risk || "").toUpperCase();
  const f = String(freshness || "").toUpperCase();
  const m = String(regime || "").toUpperCase();

  if (s < 45 || (r === "CRITICAL" && s < 65)) return ["EXIT", "Very weak AI score or critical risk", 90];
  if (s < 55 || (r === "HIGH" && pnl <= -15)) return ["REDUCE", "Weak score or high-risk drawdown", 84];
  if (weight >= 15 && s < 80) return ["HOLD & TRIM", "Position concentration is too high", 82];
  if (f === "MISSING" || f === "VERY_STALE") return ["WATCH", "Fundamental data is too stale for conviction", 78];
  if (s >= 85 && r !== "HIGH" && weight < 12 && f !== "STALE" && f !== "AGING" && m !== "BEAR") return ["BUY MORE", "Strong score with acceptable risk and concentration", 86];
  if (s >= 75 && r !== "HIGH" && weight < 15) return ["HOLD", "Healthy score and acceptable portfolio weight", 76];
  if (m === "BEAR" && s < 80) return ["HOLD", "Market regime is bearish; avoid aggressive adding", 73];
  return ["WATCH", "Mixed signals require confirmation", 68];
}

async function buildForUser(client, userId) {
  const [h, i, s, mr] = await Promise.all([
    client.from("holdings").select("instrument_id,current_value,invested_value,pnl_percentage,unrealized_pnl").eq("user_id", userId),
    client.from("instruments").select("id,company_name,symbol,sector"),
    client.from("ai_scores").select("instrument_id,total_score,action,risk_level,rating,score_breakdown,updated_at,calculated_at"),
    client.from("market_regime_history").select("regime,portfolio_mode,snapshot_at").order("snapshot_at", { ascending: false }).limit(1)
  ]);
  for (const x of [h, i, s, mr]) if (x.error) throw new Error(x.error.message);

  const im = new Map((i.data || []).map(x => [x.id, x]));
  const sm = new Map((s.data || []).map(x => [x.instrument_id, x]));
  const total = (h.data || []).reduce((a, x) => a + n(x.current_value), 0);
  const regime = mr.data?.[0]?.regime || null;

  const results = (h.data || []).map((holding) => {
    const meta = im.get(holding.instrument_id) || {};
    const score = sm.get(holding.instrument_id) || {};
    const freshness = score.score_breakdown?.freshness?.status || "MISSING";
    const weight = total > 0 ? n(holding.current_value) / total * 100 : 0;
    const pnl = holding.pnl_percentage ?? (n(holding.invested_value) > 0 ? n(holding.unrealized_pnl) / n(holding.invested_value) * 100 : 0);
    const [action, reason, confidence] = decision(score.total_score, score.risk_level, weight, pnl, freshness, regime);
    return {
      instrument_id: holding.instrument_id,
      company_name: meta.company_name || meta.symbol || "Holding",
      symbol: meta.symbol || null,
      sector: meta.sector || null,
      portfolio_weight_pct: Number(weight.toFixed(2)),
      pnl_pct: Number(n(pnl).toFixed(2)),
      ai_score: score.total_score ?? null,
      risk_level: score.risk_level || null,
      rating: score.rating || null,
      model_action: score.action || null,
      freshness_status: freshness,
      decision: action,
      confidence,
      reason,
      market_regime: regime,
    };
  });

  const rank = { "EXIT": 0, "REDUCE": 1, "HOLD & TRIM": 2, "WATCH": 3, "HOLD": 4, "BUY MORE": 5 };
  results.sort((a, b) => rank[a.decision] - rank[b.decision] || (b.confidence - a.confidence));
  return { user_id: userId, market_regime: regime, portfolio_value: total, decisions: results };
}

export async function GET(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Authentication required." }, { status: 401 });
    const client = userClient(token);
    const { data: userResult, error: userError } = await client.auth.getUser(token);
    if (userError || !userResult?.user) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Invalid session." }, { status: 401 });
    const portfolio = await buildForUser(client, userResult.user.id);
    const counts = {};
    for (const x of portfolio.decisions) counts[x.decision] = (counts[x.decision] || 0) + 1;
    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, generated_at: new Date().toISOString(), ...portfolio, decision_counts: counts });
  } catch (error) {
    console.error("Decision engine error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Decision engine failed." }, { status: 500 });
  }
}
