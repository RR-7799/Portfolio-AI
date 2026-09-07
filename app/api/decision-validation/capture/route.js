import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTechnicalForIsin } from "../../../lib/upstox-technical";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const ENGINE_VERSION = "decision_validation_v1_0";
const SCORE_VERSION = "ai_scorer_v5_5";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const up = v => String(v || "").toUpperCase();

function authorized(request) {
  const secret = process.env.PIPELINE_SECRET || "";
  return !!secret && ((request.headers.get("x-pipeline-secret") || "") === secret || (request.headers.get("authorization") || "") === `Bearer ${secret}`);
}
function thesisAction(s) {
  const lt = n(s.long_term_score), risk = n(s.risk_score), conf = n(s.confidence), complete = n(s.data_completeness), fresh = up(s.freshness_status);
  const reliable = conf != null && conf >= 60 && complete != null && complete >= 60 && fresh !== "" && !["STALE", "VERY_STALE", "MISSING"].includes(fresh);
  if (!reliable || lt == null) return "WATCH";
  if (risk != null && risk < 25) return "EXIT";
  if (lt < 50) return "EXIT";
  if (lt < 70) return "REDUCE";
  if (lt < 80) return "HOLD";
  return "BUY";
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  try {
    const [{ data: scores, error: se }, { data: instruments, error: ie }] = await Promise.all([
      admin.from("ai_scores").select("user_id,instrument_id,long_term_score,short_term_score,risk_score,valuation_score,final_ai_score,confidence,data_completeness,freshness_status,score_version,calculated_at,updated_at").eq("score_version", SCORE_VERSION),
      admin.from("instruments").select("id,isin,symbol,company_name")
    ]);
    if (se) throw se; if (ie) throw ie;
    const im = new Map((instruments || []).map(x => [x.id, x]));
    const rows = [];
    for (const score of scores || []) {
      const instrument = im.get(score.instrument_id);
      if (!score.user_id || !score.instrument_id || !instrument) continue;
      let price = null, priceSource = null;
      if (instrument.isin) {
        try {
          const technical = await getTechnicalForIsin(instrument.isin, 90);
          price = n(technical?.price);
          priceSource = price != null ? `Upstox:${technical?.data_source || "market-data"}` : null;
        } catch (_) {}
      }
      rows.push({ user_id: score.user_id, instrument_id: score.instrument_id, score_version: SCORE_VERSION, snapshot_at: score.calculated_at || score.updated_at || new Date().toISOString(), long_term_score: score.long_term_score, short_term_score: score.short_term_score, risk_score: score.risk_score, valuation_score: score.valuation_score, final_ai_score: score.final_ai_score, confidence: score.confidence, data_completeness: score.data_completeness, freshness_status: score.freshness_status, thesis_action: thesisAction(score), reference_price: price, price_source: priceSource });
    }
    if (rows.length) {
      const { error } = await admin.from("decision_validation_ledger").insert(rows);
      if (error) throw error;
    }
    const withPrice = rows.filter(x => x.reference_price != null).length;
    const actions = rows.reduce((a, x) => { a[x.thesis_action] = (a[x.thesis_action] || 0) + 1; return a; }, {});
    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, score_version: SCORE_VERSION, captured: rows.length, with_reference_price: withPrice, action_counts: actions, elapsed_ms: Date.now() - started });
  } catch (error) {
    console.error("Decision validation capture error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Validation capture failed." }, { status: 500 });
  }
}
