import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ENGINE_VERSION="final_decision_v2_0";
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null;};
const up=v=>String(v||"").toUpperCase();
function gradeLT(v){return v==null?"Unavailable":v>=90?"Exceptional":v>=80?"Excellent":v>=70?"Good":v>=60?"Average":v>=50?"Weak":"Poor";}
function gradeST(v){return v==null?"Unavailable":v>=90?"Exceptional setup":v>=80?"Strong":v>=70?"Positive":v>=60?"Neutral":v>=50?"Weak":"Poor setup";}
function gradeFinal(v){return v==null?"Unavailable":v>=90?"Exceptional":v>=85?"Very Strong":v>=75?"Strong":v>=65?"Good/Average":v>=55?"Weak":v>=45?"Poor":"Very Poor";}
function decide(s){
 const lt=n(s.long_term_score??s.total_score),st=n(s.short_term_score),risk=n(s.risk_score),val=n(s.valuation_score),conf=n(s.confidence),weight=n(s.weight),fresh=up(s.freshness_status),regime=up(s.regime);
 if(lt==null||conf!=null&&conf<45||["MISSING","VERY_STALE"].includes(fresh))return {decision:"WATCH",conviction:"LOW",reason:"Data quality or freshness is too weak for a high-conviction portfolio action."};
 if(lt>=80&&st!=null&&st<55)return {decision:"HOLD / WAIT FOR BETTER ENTRY",conviction:"HIGH",reason:"Strong long-term business quality, but the current short-term setup does not justify aggressive buying."};
 if(lt<65&&st!=null&&st>=80)return {decision:"SHORT-TERM OPPORTUNITY / NOT A CORE BUY",conviction:"MEDIUM",reason:"Current setup is attractive, but long-term business quality is not strong enough to treat this as a core investment."};
 if(risk!=null&&risk<40&&lt<60)return {decision:"EXIT",conviction:"HIGH",reason:"Long-term quality is weak and independent risk signals are critical; the investment thesis is materially impaired."};
 if(weight!=null&&weight>=12&&(risk!=null&&risk<55||val!=null&&val<35))return {decision:"REDUCE",conviction:"HIGH",reason:"Portfolio concentration combined with risk or valuation makes the current position too aggressive."};
 if(lt>=75&&st!=null&&st>=70&&(risk==null||risk>=55)&&(val==null||val>=45)&&regime!=="BEAR")return {decision:"ACCUMULATE",conviction:"HIGH",reason:"Good long-term quality is supported by a positive current setup, manageable risk and acceptable valuation."};
 if(lt>=70)return {decision:"HOLD",conviction:"MEDIUM",reason:st!=null&&st<50?"Long-term thesis remains constructive, but current momentum is weak; wait for a better entry.":"Long-term thesis remains constructive, but the evidence does not justify aggressive accumulation."};
 if(lt<60)return {decision:"WATCH",conviction:"LOW",reason:"Long-term quality is not strong enough for a core position; wait for improving fundamentals or clearer evidence."};
 return {decision:"WATCH",conviction:"LOW",reason:"Mixed long-term quality and current opportunity signals need confirmation."};
}
export async function GET(request){
 try{
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Authentication required."},{status:401});
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:user,error:userError}=await client.auth.getUser(token);if(userError||!user)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Invalid session."},{status:401});
  const instrumentId=new URL(request.url).searchParams.get("instrument_id");if(!instrumentId)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"instrument_id is required."},{status:400});
  const [h,i,s,m]=await Promise.all([
   client.from("holdings").select("instrument_id,current_value,invested_value,pnl_percentage,unrealized_pnl").eq("user_id",user.id).eq("instrument_id",instrumentId).maybeSingle(),
   client.from("instruments").select("id,company_name,symbol,sector").eq("id",instrumentId).maybeSingle(),
   client.from("ai_scores").select("instrument_id,total_score,long_term_score,short_term_score,risk_score,valuation_score,final_ai_score,confidence,data_completeness,freshness_status,score_version,score_breakdown,action,risk_level,rating,updated_at").eq("user_id",user.id).eq("instrument_id",instrumentId).maybeSingle(),
   client.from("market_regime_history").select("regime,portfolio_mode,snapshot_at").order("snapshot_at",{ascending:false}).limit(1).maybeSingle()
  ]);
  for(const x of [h,i,s,m])if(x.error)throw new Error(x.error.message);if(!h.data)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Holding not found."},{status:404});
  const score=s.data||{},holding=h.data,totalWeight=n(holding.current_value),lt=n(score.long_term_score??score.total_score),st=n(score.short_term_score),risk=n(score.risk_score),val=n(score.valuation_score),final=n(score.final_ai_score??score.total_score);
  const totalRes=await client.from("holdings").select("current_value").eq("user_id",user.id);if(totalRes.error)throw new Error(totalRes.error.message);const total=(totalRes.data||[]).reduce((a,x)=>a+(n(x.current_value)||0),0);const weight=total>0?(totalWeight||0)/total*100:null;
  const d=decide({...score,long_term_score:lt,short_term_score:st,risk_score:risk,valuation_score:val,final_ai_score:final,weight,regime:m.data?.regime||"NEUTRAL"});
  return NextResponse.json({success:true,engine_version:ENGINE_VERSION,instrument:i.data||{id:instrumentId},portfolio:{...holding,weight_pct:weight==null?null:Number(weight.toFixed(2))},scores:{long_term:lt,long_term_grade:gradeLT(lt),short_term:st,short_term_grade:gradeST(st),risk,valuation,final:final,final_grade:gradeFinal(final),confidence:n(score.confidence),data_completeness:n(score.data_completeness),freshness_status:score.freshness_status||"MISSING",version:score.score_version||"legacy"},model_action:score.action||null,decision:d,market_regime:m.data||null,score_breakdown:score.score_breakdown||{}});
 }catch(error){return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Final decision failed."},{status:500});}
}
