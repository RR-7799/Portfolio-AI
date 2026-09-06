import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ENGINE_VERSION = "final_decision_v4_0";
const SCORE_VERSION = "ai_scorer_v5_5";
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const up = v => String(v || "").toUpperCase();
function gradeLT(v){return v==null?"Unavailable":v>=90?"Exceptional":v>=80?"Excellent":v>=70?"Good":v>=60?"Average":v>=50?"Weak":"Poor";}
function gradeST(v){return v==null?"Unavailable":v>=90?"Exceptional setup":v>=80?"Strong":v>=70?"Positive":v>=60?"Neutral":v>=50?"Weak":"Poor setup";}
function gradeFinal(v){return v==null?"Unavailable":v>=90?"Exceptional":v>=85?"Very Strong":v>=75?"Strong":v>=65?"Good/Average":v>=55?"Weak":v>=45?"Poor":"Very Poor";}
function timing(st,val,regime){
  if(st==null) return "UNAVAILABLE";
  if(st>=80 && (val==null||val>=55) && regime!=="BEAR") return "FAVORABLE NOW";
  if(st>=70) return "POSITIVE SETUP";
  if(st<50) return "WAIT";
  return "NEUTRAL TIMING";
}
function decide({lt,st,risk,val,regime}){
  const reliable = true;
  const severeRisk = risk!=null && risk<25;
  if(!reliable) return {decision:"WATCH",conviction:"LOW",reason:"Data completeness, freshness or confidence is insufficient for a high-conviction portfolio action."};
  if(lt==null) return {decision:"WATCH",conviction:"LOW",reason:"V5.5 Long-Term score is unavailable; no investment thesis is promoted."};
  if(severeRisk) return {decision:"EXIT",conviction:"HIGH",reason:"Independent risk is severe enough that the current risk/reward is structurally unacceptable."};
  if(lt<50) return {decision:"EXIT",conviction:"HIGH",reason:"Long-term investment quality is below the minimum thesis threshold; the position should not be treated as a core holding."};
  if(lt<70) return {decision:"REDUCE",conviction:"HIGH",reason:"Long-term investment quality is below the hold threshold; capital allocation should be reduced unless the thesis strengthens."};
  if(lt<80) return {decision:"HOLD",conviction:"MEDIUM",reason:"The long-term thesis remains intact, but conviction is not high enough for a core BUY."};
  return {decision:"BUY",conviction:"HIGH",reason:"Long-term investment quality clears the core BUY threshold. Short-term conditions, valuation, risk and concentration should guide timing and position sizing, not override the thesis."};
}

export async function GET(request){
 try{
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Authentication required."},{status:401});
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:user,error:userError}=await client.auth.getUser(token);
  if(userError||!user?.user)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Invalid session."},{status:401});
  const instrumentId=new URL(request.url).searchParams.get("instrument_id");
  if(!instrumentId)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"instrument_id is required."},{status:400});
  const [h,i,s,m]=await Promise.all([
   client.from("holdings").select("instrument_id,current_value,invested_value,pnl_percentage,unrealized_pnl").eq("user_id",user.user.id).eq("instrument_id",instrumentId).maybeSingle(),
   client.from("instruments").select("id,company_name,symbol,sector").eq("id",instrumentId).maybeSingle(),
   client.from("ai_scores").select("instrument_id,long_term_score,short_term_score,risk_score,valuation_score,final_ai_score,confidence,data_completeness,freshness_status,score_version,score_breakdown,action,risk_level,rating,updated_at").eq("user_id",user.user.id).eq("instrument_id",instrumentId).maybeSingle(),
   client.from("market_regime_history").select("regime,portfolio_mode,snapshot_at").order("snapshot_at",{ascending:false}).limit(1).maybeSingle()
  ]);
  for(const x of [h,i,s,m]) if(x.error) throw new Error(x.error.message);
  if(!h.data)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Holding not found."},{status:404});
  const score=s.data||{};
  if(score.score_version!==SCORE_VERSION)return NextResponse.json({success:true,engine_version:ENGINE_VERSION,score_version:SCORE_VERSION,warning:"No V5.5 production score is available for this holding yet.",instrument:i.data||{id:instrumentId},portfolio:h.data,scores:null,decision:{decision:"WATCH",conviction:"LOW",reason:"V5.5 score is not available; no legacy score is promoted into the production decision."},model_action:null,market_regime:m.data||null,score_breakdown:{}});
  const totalRes=await client.from("holdings").select("current_value").eq("user_id",user.user.id);
  if(totalRes.error)throw new Error(totalRes.error.message);
  const total=(totalRes.data||[]).reduce((a,x)=>a+(n(x.current_value)||0),0);
  const weight=total>0?(n(h.data.current_value)||0)/total*100:null;
  const lt=n(score.long_term_score),st=n(score.short_term_score),risk=n(score.risk_score),val=n(score.valuation_score),final=n(score.final_ai_score),regime=m.data?.regime||"NEUTRAL";
  const d=decide({lt,st,risk,val,regime});
  const t=timing(st,val,regime);
  return NextResponse.json({success:true,engine_version:ENGINE_VERSION,score_version:SCORE_VERSION,instrument:i.data||{id:instrumentId},portfolio:{...h.data,weight_pct:weight==null?null:Number(weight.toFixed(2))},scores:{long_term:lt,long_term_grade:gradeLT(lt),short_term:st,short_term_grade:gradeST(st),risk,valuation,final,final_grade:gradeFinal(final),confidence:n(score.confidence),data_completeness:n(score.data_completeness),freshness_status:score.freshness_status||"MISSING",version:score.score_version},model_action:score.action||null,decision:d,timing:t,market_regime:m.data||null,score_breakdown:score.score_breakdown||{}});
 }catch(error){return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Final decision failed."},{status:500});}
}
