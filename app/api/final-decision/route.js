import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ENGINE_VERSION = "final_decision_v3_0";
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const up = v => String(v || "").toUpperCase();
function gradeLT(v){return v==null?"Unavailable":v>=90?"Exceptional":v>=80?"Excellent":v>=70?"Good":v>=60?"Average":v>=50?"Weak":"Poor";}
function gradeST(v){return v==null?"Unavailable":v>=90?"Exceptional setup":v>=80?"Strong":v>=70?"Positive":v>=60?"Neutral":v>=50?"Weak":"Poor setup";}
function gradeFinal(v){return v==null?"Unavailable":v>=90?"Exceptional":v>=85?"Very Strong":v>=75?"Strong":v>=65?"Good/Average":v>=55?"Weak":v>=45?"Poor":"Very Poor";}
function decide(x){
 const lt=n(x.long_term_score),st=n(x.short_term_score),risk=n(x.risk_score),val=n(x.valuation_score),final=n(x.final_ai_score),conf=n(x.confidence),complete=n(x.data_completeness),weight=n(x.weight),regime=up(x.regime),fresh=up(x.freshness);
 const reliable=conf!=null&&conf>=60&&complete!=null&&complete>=60&&!['STALE','VERY_STALE','MISSING'].includes(fresh);
 const severeRisk=risk!=null&&risk<25;
 const highRisk=risk!=null&&risk<55;
 const concentrated=weight!=null&&weight>=12;
 const severeDowntrend=st!=null&&st<35;
 const brokenLongTerm=lt!=null&&lt<50;
 const weakLongTerm=lt!=null&&lt<70;
 const strongLongTerm=lt!=null&&lt>=80;
 const goodLongTerm=lt!=null&&lt>=70;
 const strongSetup=st!=null&&st>=80;
 const weakSetup=st!=null&&st<50;
 if(!reliable)return{decision:"WATCH",conviction:"LOW",reason:"Data completeness, freshness or confidence is insufficient for a high-conviction portfolio action."};
 if(brokenLongTerm||severeRisk)return{decision:"EXIT",conviction:"HIGH",reason:brokenLongTerm?"Long-term investment quality is below the minimum thesis threshold; the position should not be treated as a core holding.":"Independent risk is severe enough that the current risk/reward is structurally unacceptable."};
 if(weakLongTerm||final!=null&&final<60||highRisk||concentrated)return{decision:"REDUCE",conviction:"HIGH",reason:weakLongTerm?"Long-term investment quality is below the hold threshold; capital allocation should be reduced unless the thesis strengthens.":highRisk?"Independent risk has deteriorated enough to reduce capital allocation.":concentrated?"Position concentration is too high for the current conviction and should be brought down.":"The combined evidence is below the minimum level for maintaining the current allocation."};
 if(lt!=null&&lt>=50&&lt<70&&strongSetup)return{decision:"SHORT-TERM OPPORTUNITY / NOT A CORE BUY",conviction:"MEDIUM",reason:"The current setup is strong, but long-term quality is below the core-investment threshold; treat this as a tactical opportunity rather than a core buy."};
 if(goodLongTerm&&weakSetup)return{decision:"HOLD / WAIT FOR BETTER ENTRY",conviction:"HIGH",reason:"The long-term thesis is intact, but short-term conditions are weak; do not confuse business quality with entry timing."};
 if(strongLongTerm&&st!=null&&!severeDowntrend&&risk>=55&&val>=45&&!concentrated&&regime!=="BEAR"&&final!=null&&final>=85)return{decision:"BUY",conviction:"HIGH",reason:"Long-term quality is very strong and the current setup, risk, valuation, confidence and portfolio concentration all clear the buy gate."};
 if(strongLongTerm&&strongSetup&&risk>=55&&val>=45&&!concentrated&&regime!=="BEAR")return{decision:"ACCUMULATE",conviction:"HIGH",reason:"Strong long-term quality and strong current setup support adding capital within portfolio risk and valuation limits."};
 if(goodLongTerm&&strongSetup&&risk>=55&&val>=45&&!concentrated&&regime!=="BEAR")return{decision:"ACCUMULATE",conviction:"MEDIUM",reason:"Good long-term quality is supported by a strong setup, manageable risk and acceptable valuation."};
 if(goodLongTerm)return{decision:"HOLD",conviction:"MEDIUM",reason:"The long-term thesis remains intact, but the evidence does not currently justify aggressive accumulation."};
 if(regime==="BEAR"&&final!=null&&final<75)return{decision:"HOLD / WAIT",conviction:"MEDIUM",reason:"The thesis is not necessarily broken, but a bearish market regime raises the hurdle for fresh capital."};
 return{decision:"WATCH",conviction:"LOW",reason:"Signals are mixed and do not satisfy the explicit buy, accumulate, hold, reduce or exit gates."};
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
   client.from("ai_scores").select("instrument_id,long_term_score,short_term_score,risk_score,valuation_score,final_ai_score,total_score,confidence,data_completeness,freshness_status,score_version,score_breakdown,action,risk_level,rating,updated_at").eq("user_id",user.user.id).eq("instrument_id",instrumentId).maybeSingle(),
   client.from("market_regime_history").select("regime,portfolio_mode,snapshot_at").order("snapshot_at",{ascending:false}).limit(1).maybeSingle()
  ]);
  for(const x of [h,i,s,m])if(x.error)throw new Error(x.error.message);
  if(!h.data)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Holding not found."},{status:404});
  const score=s.data||{};
  if(score.score_version!=="ai_scorer_v5_5")return NextResponse.json({success:true,engine_version:ENGINE_VERSION,warning:"No V5.5 production score is available for this holding yet.",instrument:i.data||{id:instrumentId},portfolio:h.data,scores:null,decision:{decision:"WATCH",conviction:"LOW",reason:"V5.5 score is not available; no legacy score is promoted into the production decision."},model_action:null,market_regime:m.data||null,score_breakdown:{}});
  const totalRes=await client.from("holdings").select("current_value").eq("user_id",user.user.id);
  if(totalRes.error)throw new Error(totalRes.error.message);
  const total=(totalRes.data||[]).reduce((a,x)=>a+(n(x.current_value)||0),0);
  const weight=total>0?(n(h.data.current_value)||0)/total*100:null;
  const lt=n(score.long_term_score),st=n(score.short_term_score),risk=n(score.risk_score),val=n(score.valuation_score),final=n(score.final_ai_score);
  const d=decide({long_term_score:lt,short_term_score:st,risk_score:risk,valuation_score:val,final_ai_score:final,confidence:n(score.confidence),data_completeness:n(score.data_completeness),freshness:score.freshness_status,weight,regime:m.data?.regime||"NEUTRAL"});
  return NextResponse.json({success:true,engine_version:ENGINE_VERSION,instrument:i.data||{id:instrumentId},portfolio:{...h.data,weight_pct:weight==null?null:Number(weight.toFixed(2))},scores:{long_term:lt,long_term_grade:gradeLT(lt),short_term:st,short_term_grade:gradeST(st),risk,valuation,final,final_grade:gradeFinal(final),confidence:n(score.confidence),data_completeness:n(score.data_completeness),freshness_status:score.freshness_status||"MISSING",version:score.score_version},model_action:score.action||null,decision:d,market_regime:m.data||null,score_breakdown:score.score_breakdown||{}});
 }catch(error){return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Final decision failed."},{status:500});}
}
