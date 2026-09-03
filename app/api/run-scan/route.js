import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as runPipeline } from "../run-pipeline/route";
import { GET as runDecisionEngine } from "../decision-engine/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const ENGINE_VERSION = "run_scan_v1_1";

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

export async function POST(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    if (!token) {
      return NextResponse.json(
        { success: false, engine_version: ENGINE_VERSION, error: "Sign-in session required." },
        { status: 401 }
      );
    }

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return NextResponse.json(
        { success: false, engine_version: ENGINE_VERSION, error: "Invalid sign-in session." },
        { status: 401 }
      );
    }

    const secret = process.env.PIPELINE_SECRET;
    if (!secret) {
      return NextResponse.json(
        { success: false, engine_version: ENGINE_VERSION, error: "Pipeline is not configured." },
        { status: 500 }
      );
    }

    const origin = new URL(request.url).origin;
    const pipelineRequest = new Request(`${origin}/api/run-pipeline?stage=all`, {
      method: "GET",
      headers: { "x-pipeline-secret": secret },
    });

    const pipelineResponse = await runPipeline(pipelineRequest);
    const pipelinePayload = await parseJsonResponse(pipelineResponse);

    if (!pipelineResponse.ok || !pipelinePayload?.success) {
      return NextResponse.json(
        {
          success: false,
          engine_version: ENGINE_VERSION,
          error: pipelinePayload?.error || "Portfolio scan failed.",
          pipeline: pipelinePayload,
        },
        { status: pipelineResponse.status || 502 }
      );
    }

    // The scoring pipeline is global/service-role based. The final portfolio decision
    // is user-scoped, so run it with the authenticated user's JWT immediately after scoring.
    const decisionRequest = new Request(`${origin}/api/decision-engine`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const decisionResponse = await runDecisionEngine(decisionRequest);
    const decisionPayload = await parseJsonResponse(decisionResponse);

    if (!decisionResponse.ok || !decisionPayload?.success) {
      return NextResponse.json(
        {
          success: false,
          engine_version: ENGINE_VERSION,
          failed_stage: "decision_engine_v2",
          error: decisionPayload?.error || "Decision engine failed after scan.",
          pipeline: pipelinePayload,
          decision_engine: decisionPayload,
        },
        { status: decisionResponse.status || 502 }
      );
    }

    return NextResponse.json({
      success: true,
      engine_version: ENGINE_VERSION,
      user_id: data.user.id,
      scanned_at: new Date().toISOString(),
      pipeline_summary: {
        ...(pipelinePayload.pipeline_summary || {}),
        decision_engine_completed: true,
        decision_engine_version: decisionPayload.engine_version || null,
        decision_counts: decisionPayload.decision_counts || {},
      },
      decision_engine: {
        engine_version: decisionPayload.engine_version || null,
        decision_counts: decisionPayload.decision_counts || {},
      },
    });
  } catch (error) {
    console.error("Run scan error:", error);
    return NextResponse.json(
      {
        success: false,
        engine_version: ENGINE_VERSION,
        error: error?.message || "Portfolio scan failed.",
      },
      { status: 500 }
    );
  }
}
