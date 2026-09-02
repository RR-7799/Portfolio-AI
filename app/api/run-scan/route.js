import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { GET as runPipeline } from "../run-pipeline/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const ENGINE_VERSION = "run_scan_v1_0";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

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

    const response = await runPipeline(pipelineRequest);
    const payload = await response.json();

    if (!response.ok || !payload?.success) {
      return NextResponse.json(
        {
          success: false,
          engine_version: ENGINE_VERSION,
          error: payload?.error || "Portfolio scan failed.",
          pipeline: payload,
        },
        { status: response.status || 502 }
      );
    }

    return NextResponse.json({
      success: true,
      engine_version: ENGINE_VERSION,
      user_id: data.user.id,
      scanned_at: new Date().toISOString(),
      pipeline_summary: payload.pipeline_summary || null,
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
