import { NextResponse } from "next/server";
import { GET as runBatchSync } from "../batch-sync-upstox/route";
import { GET as runFreshness } from "../freshness-report/route";
import { GET as runV42 } from "../score-portfolio-safe-v42/route";
import { GET as runSnapshot } from "../portfolio-snapshot/route";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ENGINE_VERSION = "pipeline_v1_1";
const BATCH_SIZE = 10;

function isAuthorized(request) {
  const configuredSecret = process.env.PIPELINE_SECRET;
  if (!configuredSecret) return false;
  const headerSecret = request.headers.get("x-pipeline-secret");
  const authHeader = request.headers.get("authorization");
  const bearerSecret = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return headerSecret === configuredSecret || bearerSecret === configuredSecret;
}

async function parseJsonResponse(response) {
  try { return await response.json(); }
  catch { return { success:false, error:"Pipeline stage returned a non-JSON response", status:response.status }; }
}

async function runStage(label, handler, url, headers = {}) {
  const startedAt = Date.now();
  const response = await handler(new Request(url, { method:"GET", headers }));
  const payload = await parseJsonResponse(response);
  return { stage:label, http_status:response.status, duration_ms:Date.now()-startedAt, success:response.status>=200&&response.status<300&&payload?.success!==false, data:payload };
}

export async function GET(request) {
  if (!isAuthorized(request)) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:process.env.PIPELINE_SECRET?"Unauthorized":"PIPELINE_SECRET is not configured" }, {status:401});

  const startedAt=Date.now();
  const {searchParams}=new URL(request.url);
  const requestedStage=String(searchParams.get("stage")||"all").toLowerCase();
  const stage=["sync","freshness","score","snapshot","all"].includes(requestedStage)?requestedStage:"all";
  const origin=new URL(request.url).origin;
  const stages=[];
  const pipelineHeaders={"x-pipeline-secret":process.env.PIPELINE_SECRET||""};

  try {
    if(stage==="sync"||stage==="all"){
      let offset=0,finished=false;
      while(!finished){
        const result=await runStage(`upstox_sync_${offset}`,runBatchSync,`${origin}/api/batch-sync-upstox?limit=${BATCH_SIZE}&offset=${offset}`);
        stages.push(result);
        if(!result.success) return NextResponse.json({success:false,engine_version:ENGINE_VERSION,failed_stage:result.stage,elapsed_ms:Date.now()-startedAt,stages},{status:502});
        const nextOffset=result.data?.batch?.next_offset;
        finished=nextOffset===null||nextOffset===undefined;
        if(!finished) offset=Number(nextOffset);
        if(result.data?.batch?.returned===0) finished=true;
      }
    }

    if(stage==="freshness"||stage==="all"){
      const result=await runStage("freshness_audit",runFreshness,`${origin}/api/freshness-report`);
      stages.push(result);
      if(!result.success) return NextResponse.json({success:false,engine_version:ENGINE_VERSION,failed_stage:result.stage,elapsed_ms:Date.now()-startedAt,stages},{status:502});
    }

    if(stage==="score"||stage==="all"){
      const result=await runStage("safe_v4_2_score",runV42,`${origin}/api/score-portfolio-safe-v42`);
      stages.push(result);
      if(!result.success) return NextResponse.json({success:false,engine_version:ENGINE_VERSION,failed_stage:result.stage,elapsed_ms:Date.now()-startedAt,stages},{status:502});
    }

    if(stage==="snapshot"||stage==="all"){
      const result=await runStage("portfolio_snapshot",runSnapshot,`${origin}/api/portfolio-snapshot`,pipelineHeaders);
      stages.push(result);
      if(!result.success) return NextResponse.json({success:false,engine_version:ENGINE_VERSION,failed_stage:result.stage,elapsed_ms:Date.now()-startedAt,stages},{status:502});
    }

    const syncStages=stages.filter(x=>x.stage.startsWith("upstox_sync_"));
    const syncResults=syncStages.flatMap(x=>x.data?.results||[]);
    const syncSuccessful=syncResults.filter(x=>x.success===true).length;
    const syncFailed=syncResults.filter(x=>x.success===false&&x.skipped!==true).length;
    const finalScoreStage=stages.find(x=>x.stage==="safe_v4_2_score");
    const freshnessStage=stages.find(x=>x.stage==="freshness_audit");
    const snapshotStage=stages.find(x=>x.stage==="portfolio_snapshot");

    return NextResponse.json({
      success:true,engine_version:ENGINE_VERSION,stage,elapsed_ms:Date.now()-startedAt,
      pipeline_summary:{
        sync_batches:syncStages.length,sync_successful:syncSuccessful,sync_failed:syncFailed,
        freshness_completed:Boolean(freshnessStage?.success),scoring_completed:Boolean(finalScoreStage?.success),
        snapshot_completed:Boolean(snapshotStage?.success),snapshot_users:snapshotStage?.data?.users??null,
        scored:finalScoreStage?.data?.scored??null,buy_candidates:finalScoreStage?.data?.buy_candidates??null,
        average_score:finalScoreStage?.data?.average_score??null,
        freshness_counts:finalScoreStage?.data?.freshness_counts??freshnessStage?.data?.freshness_counts??null,
      },
      stages,
    });
  } catch(error){
    console.error("Portfolio AI pipeline error:",error);
    return NextResponse.json({success:false,engine_version:ENGINE_VERSION,stage,elapsed_ms:Date.now()-startedAt,error:error?.message||"Unknown pipeline error",stages},{status:500});
  }
}
