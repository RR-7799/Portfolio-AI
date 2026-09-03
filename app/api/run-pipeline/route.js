import { NextResponse } from "next/server";
import { GET as runBatchSync } from "../batch-sync-upstox/route";
import { GET as runFreshness } from "../freshness-report/route";
import { GET as runV50 } from "../calculate-score/route";
import { GET as runSnapshot } from "../portfolio-snapshot/route";
import { GET as runAlerts } from "../portfolio-alerts/route";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const ENGINE_VERSION = "pipeline_v1_6";
const BATCH_SIZE = 10;
function isAuthorized(request){const s=process.env.PIPELINE_SECRET;if(!s)return false;const h=request.headers.get("x-pipeline-secret");const a=request.headers.get("authorization");return h===s||(a?.startsWith("Bearer ")&&a.slice(7)===s);}
async function parseJsonResponse(r){try{return await r.json();}catch{return {success:false,error:"Pipeline stage returned a non-JSON response",status:r.status};}}
async function runStage(label,handler,url,headers={}){const t=Date.now();try{const r=await handler(new Request(url,{method:"GET",headers}));const payload=await parseJsonResponse(r);return {stage:label,http_status:r.status,duration_ms:Date.now()-t,success:r.status>=200&&r.status<300&&payload?.success!==false,data:payload};}catch(error){return {stage:label,http_status:500,duration_ms:Date.now()-t,success:false,data:{success:false,error:error?.message||`${label} threw an exception.`}};}}
export async function GET(request){
 if(!isAuthorized(request))return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:process.env.PIPELINE_SECRET?"Unauthorized":"PIPELINE_SECRET is not configured"},{status:401});
 const startedAt=Date.now();const {searchParams}=new URL(request.url);const requested=String(searchParams.get("stage")||"all").toLowerCase();const stage=["sync","freshness","score","snapshot","alerts","all"].includes(requested)?requested:"all";const origin=new URL(request.url).origin;const stages=[];const headers={"x-pipeline-secret":process.env.PIPELINE_SECRET||""};
 try{
  if(stage==="sync"||stage==="all"){let offset=0,finished=false;while(!finished){const r=await runStage(`upstox_sync_${offset}`,runBatchSync,`${origin}/api/batch-sync-upstox?limit=${BATCH_SIZE}&offset=${offset}`);stages.push(r);if(!r.success)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,failed_stage:r.stage,elapsed_ms:Date.now()-startedAt,stages},{status:502});const next=r.data?.batch?.next_offset;finished=next===null||next===undefined||r.data?.batch?.returned===0;if(!finished)offset=Number(next);}}
  if(stage==="freshness"||stage==="all"){const r=await runStage("freshness_audit",runFreshness,`${origin}/api/freshness-report`);stages.push(r);if(!r.success)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,failed_stage:r.stage,elapsed_ms:Date.now()-startedAt,stages},{status:502});}
  if(stage==="score"||stage==="all"){const r=await runStage("ai_scorer_v5",runV50,`${origin}/api/calculate-score`);stages.push(r);if(!r.success)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,failed_stage:r.stage,elapsed_ms:Date.now()-startedAt,stages},{status:502});}
  if(stage==="snapshot"||stage==="all"){const r=await runStage("portfolio_snapshot",runSnapshot,`${origin}/api/portfolio-snapshot`,headers);stages.push(r);if(!r.success)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,failed_stage:r.stage,elapsed_ms:Date.now()-startedAt,stages},{status:502});}
  if(stage==="alerts"||stage==="all"){const r=await runStage("portfolio_alerts",runAlerts,`${origin}/api/portfolio-alerts`,headers);stages.push(r);}
  const syncStages=stages.filter(x=>x.stage.startsWith("upstox_sync_"));const syncResults=syncStages.flatMap(x=>x.data?.results||[]);const finalScore=stages.find(x=>x.stage==="ai_scorer_v5");const freshness=stages.find(x=>x.stage==="freshness_audit");const snapshot=stages.find(x=>x.stage==="portfolio_snapshot");const alerts=stages.find(x=>x.stage==="portfolio_alerts");
  const alertsWarning=alerts&&!alerts.success?(alerts.data?.error||alerts.data?.message||`Alert stage failed with HTTP ${alerts.http_status}.`):alerts?.data?.warning||null;
  return NextResponse.json({success:true,engine_version:ENGINE_VERSION,stage,elapsed_ms:Date.now()-startedAt,pipeline_summary:{sync_batches:syncStages.length,sync_successful:syncResults.filter(x=>x.success===true).length,sync_failed:syncResults.filter(x=>x.success===false&&x.skipped!==true).length,freshness_completed:Boolean(freshness?.success),scoring_completed:Boolean(finalScore?.success),snapshot_completed:Boolean(snapshot?.success),alerts_completed:Boolean(alerts?.success),alerts_generated:alerts?.data?.new_alerts??null,alerts_candidates:alerts?.data?.generated??null,alerts_warning:alertsWarning,snapshot_users:snapshot?.data?.users??null,scored:finalScore?.data?.summary?.scored??finalScore?.data?.scored??null,buy_candidates:finalScore?.data?.results?.filter?.(x=>x.action==="BUY")?.length??null,average_score:finalScore?.data?.summary?.average_final_ai_score??finalScore?.data?.average_score??null,freshness_counts:finalScore?.data?.freshness_counts??freshness?.data?.freshness_counts??null},stages});
 }catch(error){console.error("Portfolio AI pipeline error:",error);return NextResponse.json({success:false,engine_version:ENGINE_VERSION,stage,elapsed_ms:Date.now()-startedAt,error:error?.message||"Unknown pipeline error",stages},{status:500});}
}
