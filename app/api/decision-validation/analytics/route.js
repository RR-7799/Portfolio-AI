import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "decision_validation_analytics_v1_0";
const SCORE_VERSION = "ai_scorer_v5_5";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
function authorized(request) { const pipeline = process.env.PIPELINE_SECRET || ""; const cron = process.env.CRON_SECRET || ""; const auth = request.headers.get("authorization") || ""; return !!((pipeline && (request.headers.get("x-pipeline-secret") === pipeline || auth === `Bearer ${pipeline}`)) || (cron && auth === `Bearer ${cron}`)); }
const stats = xs => { const a = xs.map(n).filter(v => v != null).sort((a,b) => a-b); if (!a.length) return { count: 0, avg: null, median: null, positive_rate: null }; const mid = Math.floor(a.length/2); return { count:a.length, avg:Number((a.reduce((s,v)=>s+v,0)/a.length).toFixed(3)), median:Number((a.length%2?a[mid]:(a[mid-1]+a[mid])/2).toFixed(3)), positive_rate:Number(((a.filter(v=>v>0).length/a.length)*100).toFixed(1)) }; };
export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Unauthorized" }, { status:401 });
  try {
    const { data: rows, error } = await admin.from("decision_validation_ledger").select("thesis_action,long_term_score,risk_score,return_5d_pct,return_20d_pct,return_60d_pct,outcome_status,snapshot_at").eq("score_version", SCORE_VERSION).order("snapshot_at", { ascending:true }).limit(10000);
    if (error) throw error;
    const cohort = {};
    for (const action of ["BUY","HOLD","REDUCE","EXIT","WATCH"]) { const rs=(rows||[]).filter(r=>r.thesis_action===action); cohort[action]={ snapshots:rs.length, five_day:stats(rs.map(r=>r.return_5d_pct)), twenty_day:stats(rs.map(r=>r.return_20d_pct)), sixty_day:stats(rs.map(r=>r.return_60d_pct)) }; }
    const scored=(rows||[]).filter(r=>r.long_term_score!=null); const reliable=(rows||[]).filter(r=>r.outcome_status==="COMPLETE");
    return NextResponse.json({ success:true, engine_version:ENGINE_VERSION, score_version:SCORE_VERSION, snapshot_count:(rows||[]).length, complete_outcomes:reliable.length, pending_outcomes:(rows||[]).filter(r=>r.outcome_status!=="COMPLETE").length, cohort, long_term_bands:{ below_50:stats(scored.filter(r=>Number(r.long_term_score)<50).map(r=>r.return_20d_pct)), fifty_to_69:stats(scored.filter(r=>Number(r.long_term_score)>=50&&Number(r.long_term_score)<70).map(r=>r.return_20d_pct)), seventy_to_79:stats(scored.filter(r=>Number(r.long_term_score)>=70&&Number(r.long_term_score)<80).map(r=>r.return_20d_pct)), eighty_plus:stats(scored.filter(r=>Number(r.long_term_score)>=80).map(r=>r.return_20d_pct))} });
  } catch (error) { console.error("Decision validation analytics error:",error); return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:error?.message||"Validation analytics failed." }, { status:500 }); }
}
