import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as runPipeline } from "../run-pipeline/route";
import { GET as runDecisionEngine } from "../decision-engine/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const ENGINE_VERSION = "run_scan_v1_3";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return { success: false, error: `HTTP ${response.status}` };
  }
}

async function getCoverage(userId) {
  const [{ data: holdings, error: holdingsError }, { data: scores, error: scoresError }, { data: instruments, error: instrumentsError }] = await Promise.all([
    supabase.from("holdings").select("instrument_id,current_value").eq("user_id", userId),
    supabase.from("ai_scores").select("instrument_id,total_score").eq("user_id", userId),
    supabase.from("instruments").select("id,company_name,symbol,sector"),
  ]);

  if (holdingsError) throw new Error(`Coverage holdings query failed: ${holdingsError.message}`);
  if (scoresError) throw new Error(`Coverage scores query failed: ${scoresError.message}`);
  if (instrumentsError) throw new Error(`Coverage instruments query failed: ${instrumentsError.message}`);

  const instrumentMap = new Map((instruments || []).map((item) => [item.id, item]));
  const scoreMap = new Map((scores || []).map((item) => [item.instrument_id, item]));
  const uniqueHoldingIds = [...new Set((holdings || []).map((item) => item.instrument_id).filter(Boolean))];
  const scoredIds = new Set((scores || []).filter((item) => item.total_score !== null && item.total_score !== undefined).map((item) => item.instrument_id));

  const missing = uniqueHoldingIds.filter((id) => !scoredIds.has(id)).map((id) => {
    const score = scoreMap.get(id);
    const meta = instrumentMap.get(id) || {};
    return {
      instrument_id: id,
      company_name: meta.company_name || meta.symbol || "Unknown holding",
      symbol: meta.symbol || null,
      sector: meta.sector || "OTHER",
      status: score ? "NULL_SCORE" : "NO_AI_SCORE",
    };
  });

  return {
    total_positions: uniqueHoldingIds.length,
    scored_positions: uniqueHoldingIds.filter((id) => scoredIds.has(id)).length,
    unscored_positions: missing.length,
    coverage_pct: uniqueHoldingIds.length ? Number((uniqueHoldingIds.filter((id) => scoredIds.has(id)).length / uniqueHoldingIds.length * 100).toFixed(1)) : 100,
    missing,
  };
}

export async function POST(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    if (!token) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Sign-in session required." }, { status: 401 });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Invalid sign-in session." }, { status: 401 });

    const secret = process.env.PIPELINE_SECRET;
    if (!secret) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Pipeline is not configured." }, { status: 500 });

    const origin = new URL(request.url).origin;
    const pipelineRequest = new Request(`${origin}/api/run-pipeline?stage=all`, {
      method: "GET",
      headers: { "x-pipeline-secret": secret },
    });

    const pipelineResponse = await runPipeline(pipelineRequest);
    const pipelinePayload = await parseJsonResponse(pipelineResponse);

    // Alerts are auxiliary. If an older pipeline deployment still returns 502 at
    // portfolio_alerts, scoring and snapshot have already completed, so continue.
    const alertOnlyFailure = !pipelineResponse.ok && pipelinePayload?.failed_stage === "portfolio_alerts";
    if ((!pipelineResponse.ok || !pipelinePayload?.success) && !alertOnlyFailure) {
      return NextResponse.json({
        success: false,
        engine_version: ENGINE_VERSION,
        error: pipelinePayload?.error || "Portfolio scan failed.",
        pipeline: pipelinePayload,
      }, { status: pipelineResponse.status || 502 });
    }

    const pipelineWarning = alertOnlyFailure
      ? pipelinePayload?.stages?.find((stage) => stage.stage === "portfolio_alerts")?.data?.error || pipelinePayload?.error || "Alert stage failed; scan continued without blocking portfolio decisions."
      : pipelinePayload?.pipeline_summary?.alerts_warning || null;

    // The scoring pipeline is global/service-role based. The final portfolio decision
    // is user-scoped, so run it with the authenticated user's JWT immediately after scoring.
    const decisionRequest = new Request(`${origin}/api/decision-engine`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });

    const decisionResponse = await runDecisionEngine(decisionRequest);
    const decisionPayload = await parseJsonResponse(decisionResponse);

    if (!decisionResponse.ok || !decisionPayload?.success) {
      return NextResponse.json({
        success: false,
        engine_version: ENGINE_VERSION,
        failed_stage: "decision_engine_v3",
        error: decisionPayload?.error || "Decision engine failed after scan.",
        pipeline: pipelinePayload,
        decision_engine: decisionPayload,
      }, { status: decisionResponse.status || 502 });
    }

    const coverage = await getCoverage(data.user.id);
    const baseSummary = pipelinePayload.pipeline_summary || {};

    return NextResponse.json({
      success: true,
      engine_version: ENGINE_VERSION,
      user_id: data.user.id,
      scanned_at: new Date().toISOString(),
      pipeline_summary: {
        ...baseSummary,
        alerts_completed: alertOnlyFailure ? false : baseSummary.alerts_completed,
        alerts_warning: pipelineWarning,
        decision_engine_completed: true,
        decision_engine_version: decisionPayload.engine_version || null,
        decision_counts: decisionPayload.decision_counts || {},
        coverage,
      },
      decision_engine: {
        engine_version: decisionPayload.engine_version || null,
        decision_counts: decisionPayload.decision_counts || {},
      },
    });
  } catch (error) {
    console.error("Run scan error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Portfolio scan failed." }, { status: 500 });
  }
}
