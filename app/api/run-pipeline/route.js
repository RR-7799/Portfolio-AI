import { NextResponse } from "next/server";
import { GET as runBatchSync } from "../batch-sync-upstox/route";
import { GET as runFreshness } from "../freshness-report/route";
import { GET as runV42 } from "../score-portfolio-safe-v42/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ENGINE_VERSION = "pipeline_v1_0";
const BATCH_SIZE = 10;

function isAuthorized(request) {
  const configuredSecret = process.env.PIPELINE_SECRET;
  if (!configuredSecret) return false;

  const headerSecret = request.headers.get("x-pipeline-secret");
  const authHeader = request.headers.get("authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  return headerSecret === configuredSecret || bearerSecret === configuredSecret;
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {
      success: false,
      error: "Pipeline stage returned a non-JSON response",
      status: response.status,
    };
  }
}

async function runStage(label, handler, url) {
  const startedAt = Date.now();
  const response = await handler(new Request(url, { method: "GET" }));
  const payload = await parseJsonResponse(response);
  return {
    stage: label,
    http_status: response.status,
    duration_ms: Date.now() - startedAt,
    success: response.status >= 200 && response.status < 300 && payload?.success !== false,
    data: payload,
  };
}

export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        success: false,
        engine_version: ENGINE_VERSION,
        error: process.env.PIPELINE_SECRET
          ? "Unauthorized"
          : "PIPELINE_SECRET is not configured",
      },
      { status: 401 }
    );
  }

  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const requestedStage = String(searchParams.get("stage") || "all").toLowerCase();
  const stage = ["sync", "freshness", "score", "all"].includes(requestedStage)
    ? requestedStage
    : "all";
  const origin = new URL(request.url).origin;
  const stages = [];

  try {
    if (stage === "sync" || stage === "all") {
      let offset = 0;
      let finished = false;

      while (!finished) {
        const result = await runStage(
          `upstox_sync_${offset}`,
          runBatchSync,
          `${origin}/api/batch-sync-upstox?limit=${BATCH_SIZE}&offset=${offset}`
        );

        stages.push(result);

        if (!result.success) {
          return NextResponse.json(
            {
              success: false,
              engine_version: ENGINE_VERSION,
              failed_stage: result.stage,
              elapsed_ms: Date.now() - startedAt,
              stages,
            },
            { status: 502 }
          );
        }

        const nextOffset = result.data?.batch?.next_offset;
        finished = nextOffset === null || nextOffset === undefined;
        if (!finished) offset = Number(nextOffset);

        if (result.data?.batch?.returned === 0) {
          finished = true;
        }
      }
    }

    if (stage === "freshness" || stage === "all") {
      const result = await runStage(
        "freshness_audit",
        runFreshness,
        `${origin}/api/freshness-report`
      );
      stages.push(result);

      if (!result.success) {
        return NextResponse.json(
          {
            success: false,
            engine_version: ENGINE_VERSION,
            failed_stage: result.stage,
            elapsed_ms: Date.now() - startedAt,
            stages,
          },
          { status: 502 }
        );
      }
    }

    if (stage === "score" || stage === "all") {
      const result = await runStage(
        "safe_v4_2_score",
        runV42,
        `${origin}/api/score-portfolio-safe-v42`
      );
      stages.push(result);

      if (!result.success) {
        return NextResponse.json(
          {
            success: false,
            engine_version: ENGINE_VERSION,
            failed_stage: result.stage,
            elapsed_ms: Date.now() - startedAt,
            stages,
          },
          { status: 502 }
        );
      }
    }

    const syncStages = stages.filter((item) => item.stage.startsWith("upstox_sync_"));
    const syncResults = syncStages.flatMap((item) => item.data?.results || []);
    const syncSuccessful = syncResults.filter((item) => item.success === true).length;
    const syncFailed = syncResults.filter((item) => item.success === false && item.skipped !== true).length;

    const finalScoreStage = stages.find((item) => item.stage === "safe_v4_2_score");
    const freshnessStage = stages.find((item) => item.stage === "freshness_audit");

    return NextResponse.json({
      success: true,
      engine_version: ENGINE_VERSION,
      stage,
      elapsed_ms: Date.now() - startedAt,
      pipeline_summary: {
        sync_batches: syncStages.length,
        sync_successful: syncSuccessful,
        sync_failed: syncFailed,
        freshness_completed: Boolean(freshnessStage?.success),
        scoring_completed: Boolean(finalScoreStage?.success),
        scored: finalScoreStage?.data?.scored ?? null,
        buy_candidates: finalScoreStage?.data?.buy_candidates ?? null,
        average_score: finalScoreStage?.data?.average_score ?? null,
        freshness_counts: finalScoreStage?.data?.freshness_counts ?? freshnessStage?.data?.freshness_counts ?? null,
      },
      stages,
    });
  } catch (error) {
    console.error("Portfolio AI pipeline error:", error);

    return NextResponse.json(
      {
        success: false,
        engine_version: ENGINE_VERSION,
        stage,
        elapsed_ms: Date.now() - startedAt,
        error: error?.message || "Unknown pipeline error",
        stages,
      },
      { status: 500 }
    );
  }
}
