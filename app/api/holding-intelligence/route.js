import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "holding_intelligence_v2_0";
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
function userClient(token) { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } }); }
function gradeLT(v){return v==null?"Unavailable":v>=90?"Exceptional":v>=80?"Excellent":v>=70?"Good":v>=60?"Average":v>=50?"Weak":"Poor";}
function gradeST(v){return v==null?"Unavailable":v>=90?"Exceptional setup":v>=80?"Strong":v>=70?"Positive":v>=60?"Neutral":v>=50?"Weak":"Poor setup";}
function gradeFinal(v){return v==null?"Unavailable":v>=90?"Exceptional":v>=85?"Very Strong":v>=75?"Strong":v>=65?"Good/Average":v>=55?"Weak":v>=45?"Poor":"Very Poor";}
function evidenceFromScore(score) {
  const labels = { growth_score:"Growth", profitability_score:"Profitability", debt_score:"Debt / leverage", ownership_score:"Ownership", cashflow_score:"Operating cash flow", valuation_score:"Valuation" };
  return Object.entries(labels).map(([key,factor])=>({factor,score:n(score?.[key])})).filter(x=>x.score!==null).sort((a,b)=>b.score-a.score);
}
export async function GET(request){
  try{
    const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
    if(!token)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Authentication required."},{status:401});
    const client=userClient(token);
    const {data:authData,error:authError}=await client.auth.getUser(token);
    if(authError||!authData?.user)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Invalid session."},{status:401});
    const instrumentId=new URL(request.url).searchParams.get("instrument_id");
    if(!instrumentId)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"instrument_id is required."},{status:400});
    const [h,i,s,mr]=await Promise.all([
      client.from("holdings").select("instrument_id,current_value,invested_value,pnl_percentage,unrealized_pnl").eq("user_id",authData.user.id).eq("instrument_id",instrumentId).maybeSingle(),
      client.from("instruments").select("id,company_name,symbol,sector").eq("id",instrumentId).maybeSingle(),
      client.from("ai_scores").select("instrument_id,total_score,long_term_score,short_term_score,final_ai_score,risk_score,valuation_score,confidence,data_completeness,freshness_status,score_version,rating,action,risk_level,ai_summary,score_breakdown,score_date,calculated_at,updated_at").eq("instrument_id",instrumentId).eq("user_id",authData.user.id).maybeSingle(),
      client.from("market_regime_history").select("regime,portfolio_mode,snapshot_at").order("snapshot_at",{ascending:false}).limit(1).maybeSingle()
    ]);
    for(const x of [h,i,s,mr])if(x.error)throw new Error(x.error.message);
    if(!h.data)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Holding not found."},{status:404});
    const holding=h.data,score=s.data||{};
    const pnl=holding.pnl_percentage??(n(holding.invested_value)>0?n(holding.unrealized_pnl)/n(holding.invested_value)*100:0);
    const lt=n(score.long_term_score??score.total_score),st=n(score.short_term_score),risk=n(score.risk_score),valuation=n(score.valuation_score),final=n(score.final_ai_score??score.total_score);
    const breakdown=score.score_breakdown&&typeof score.score_breakdown==="object"?score.score_breakdown:{};
    const freshness=score.freshness_status||breakdown.freshness?.status||"MISSING";
    const evidence=evidenceFromScore(score);
    const strengths=evidence.filter(x=>x.score>=75).slice(0,4), weaknesses=evidence.filter(x=>x.score<60).slice(0,4);
    const invalidation=[];
    if(lt!=null)invalidation.push(`Long-term score deteriorates materially from ${lt.toFixed(1)}.`);
    if(risk!=null&&risk<55)invalidation.push("Risk remains elevated or deteriorates further.");
    if(["STALE","VERY_STALE","MISSING"].includes(String(freshness).toUpperCase()))invalidation.push("Financial data needs to become current before adding conviction.");
    invalidation.push("Portfolio weight crosses the concentration guardrail.");
    return NextResponse.json({
      success:true,engine_version:ENGINE_VERSION,generated_at:new Date().toISOString(),instrument:i.data||{id:instrumentId},
      holding:{...holding,pnl_pct:Number(n(pnl)?.toFixed(2)||0)},
      scores:{long_term:lt,long_term_grade:gradeLT(lt),short_term:st,short_term_grade:gradeST(st),risk,valuation,final:final,final_grade:gradeFinal(final),confidence:n(score.confidence),data_completeness:n(score.data_completeness),freshness_status:freshness,score_version:score.score_version||"legacy"},
      score,
      evidence,strengths,weaknesses,invalidation_checks:invalidation,market_regime:mr.data||null,
      decision:{action:score.action||null,reason:breakdown.reason||score.ai_summary||"Decision explanation is not available."}
    });
  }catch(error){
    console.error("Holding intelligence v2 error:",error);
    return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Holding intelligence failed."},{status:500});
  }
}
