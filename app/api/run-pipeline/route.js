import { NextResponse } from "next/server";
import { GET as runBatchSync } from "../batch-sync-upstox/route";
import { GET as runFreshness } from "../freshness-report/route";
import { GET as runV55 } from "../scoring-v5-5/route";
import { GET as runSnapshot } from "../portfolio-snapshot/route";
import { GET as runAlerts } from "../portfolio-alerts/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const ENGINE_VERSION = "pipeline_v2_1";
const BATCH_SIZE = 10;

function isAuthorized(request) {
  const secret = process.env.PIPELINE_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-pipeline-secret");
  const auth = request.headers.get("authorization");
  return header === secret || (auth?.startsWith("Bearer ") && auth.slice(7) === secret);
}

async function parseResponse(response) {
  try { return await response.json(); }
  catch { return { success: false, error: "Pipeline stage returned non-JSON response", status: response.status }; }
}

async function runPipelineStage(label, handler, url, headers = {}) {
  const started = Date.now();
  try {
    const response = await handler(new Request(url, { method: "GET", headers }));
    const data = await parseResponse(response);
    return { stage: label, http_status: response.status, duration_ms: Date.now() - started, success: response.status >= 200 && response.status < 300 && data?.success !== false, data };
  } catch (error) {
    return { stage: label, http_status: 500, duration_ms: Date.now() - started, success: false, data: { success: false, error: error?.message || `${label} failed` } };
  }
}

export async function GET(request) {
  if (!isAuthorized(request)) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: process.env.PIPELINE_SECRET ? "Unauthorized" : "PIPELINE_SECRET is not configured" }, { status: 401 });
  const started = Date.now();
  const { searchParams } = new URL(request.url);
  const requestedStage = String(searchParams.get("stage") || "all").toLowerCase();
  const selectedStage = ["sync", "freshness", "score", "snapshot", "alerts", "all"].includes(requestedStage) ? requestedStage : "all";
  const origin = new URL(request.url).origin;
  const stages = [];
  const headers = { "x-pipeline-secret": process.env.PIPELINE_SECRET || "" };
  try {
    if (selectedStage === "sync" || selectedStage === "all") {
      let offset = 0, finished = false;
      while (!finished) {
        const result = await runPipelineStage(`upstox_sync_${offset}`, runBatchSync, `${origin}/api/batch-sync-upstox?limit=${BATCH_SIZE}&offset=${offset}`);
        stages.push(result);
        if (!result.success) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, failed_stage: result.stage, elapsed_ms: Date.now() - started, stages }, { status: 502 });
        const next = result.data?.batch?.next_offset;
        finished = next == null || result.data?.batch?.returned === 0;
        if (!finished) offset = Number(next);
      }
    }
    if (selectedStage === "freshness" || selectedStage === "all") {
      const result = await runPipelineStage("freshness_audit", runFreshness, `${origin}/api/freshness-report`);
      stages.push(result);
      if (!result.success) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, failed_stage: result.stage, elapsed_ms: Date.now() - started, stages }, { status: 502 });
    }
    if (selectedStage === "score" || selectedStage === "all") {
      const result = await runPipelineStage("ai_scorer_v5_5", runV55, `${origin}/api/scoring-v5-5`, headers);
      stages.push(result);
      if (!result.success) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, failed_stage: result.stage, elapsed_ms: Date.now() - started, stages }, { status: 502 });
    }
    if (selectedStage === "snapshot" || selectedStage === "all") {
      const result = await runPipelineStage("portfolio_snapshot", runSnapshot, `${origin}/api/portfolio-snapshot`, headers);
      stages.push(result);
      if (!result.success) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, failed_stage: result.stage, elapsed_ms: Date.now() - started, stages }, { status: 502 });
    }
    if (selectedStage === "alerts" || selectedStage === "all") stages.push(await runPipelineStage("portfolio_alerts", runAlerts, `${origin}/api/portfolio-alerts`, headers));

    const syncStages = stages.filter(x => x.stage.startsWith("upstox_sync_"));
    const syncResults = syncStages.flatMap(x => x.data?.results || []);
    const score = stages.find(x => x.stage === "ai_scorer_v5_5");
    const fresh = stages.find(x => x.stage === "freshness_audit");
    const snapshot = stages.find(x => x.stage === "portfolio_snapshot");
    const alerts = stages.find(x => x.stage === "portfolio_alerts");
    const alertsWarning = alerts && !alerts.success ? alerts.data?.error || alerts.data?.message || `Alert stage failed with HTTP ${alerts.http_status}.` : alerts?.data?.warning || null;
    return NextResponse.json({
      success: true,
      engine_version: ENGINE_VERSION,
      stage: selectedStage,
      elapsed_ms: Date.now() - started,
      pipeline_summary: {
        sync_batches: syncStages.length,
        sync_successful: syncResults.filter(x => x.success === true).length,
        sync_failed: syncResults.filter(x => x.success === false && x.skipped !== true).length,
        freshness_completed: Boolean(fresh?.success),
        scoring_completed: Boolean(score?.success),
        score_history_completed: Boolean(score?.success && (score?.data?.summary?.history_stored || 0) > 0),
        score_history_stored: score?.data?.summary?.history_stored ?? null,
        score_history_failed: score?.data?.summary?.failed ?? null,
        snapshot_completed: Boolean(snapshot?.success),
        alerts_completed: Boolean(alerts?.success),
        alerts_generated: alerts?.data?.new_alerts ?? null,
        alerts_candidates: alerts?.data?.generated ?? null,
        alerts_warning: alertsWarning,
        snapshot_users: snapshot?.data?.users ?? null,
        scored: score?.data?.summary?.scored ?? null,
        buy_candidates: null,
        average_final_ai_score: score?.data?.summary?.average_final_ai_score ?? null,
      },
      stages,
    });
  } catch (error) {
    console.error("Portfolio AI pipeline error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, stage: selectedStage, elapsed_ms: Date.now() - started, error: error?.message || "Unknown pipeline error", stages }, { status: 500 });
  }
}
