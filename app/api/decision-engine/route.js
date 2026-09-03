import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "decision_engine_v5_1";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const n = v => { const x=Number(v); return Number.isFinite(x)?x:null; };
const up = v => String(v||"").toUpperCase();
const gradeLT=v=>v==null?"Unavailable":v>=90?"Exceptional":v>=80?"Excellent":v>=70?"Good":v>=60?"Average":v>=50?"Weak":"Poor";
const gradeST=v=>v==null?"Unavailable":v>=90?"Exceptional setup":v>=80?"Strong":v>=70?"Positive":v>=60?"Neutral":v>=50?"Weak":"Poor setup";
const gradeFinal=v=>v==null?"Unavailable":v>=90?"Exceptional":v>=85?"Very Strong":v>=75?"Strong":v>=65?"Good/Average":v>=55?"Weak":v>=45?"Poor":"Very Poor";

function decide(x){
 const lt=n(x.long_term_score),st=n(x.short_term_score),risk=n(x.risk_score),val=n(x.valuation_score),final=n(x.final_ai_score),conf=n(x.confidence),weight=n(x.weight),pnl=n(x.pnl),fresh=up(x.freshness),regime=up(x.regime);
 const reliable=(conf==null||conf>=60)&&!["VERY_STALE","MISSING"].includes(fresh),critical=risk!=null&&risk<40,highRisk=risk!=null&&risk<55,concentrated=weight!=null&&weight>=12,strongCore=lt!=null&&lt>=80,goodCore=lt!=null&&lt>=70,weakCore=lt!=null&&lt<60,strongSetup=st!=null&&st>=80,weakSetup=st!=null&&st<50;
 let action,reason,conviction;
 if(!reliable){action="WATCH";reason="Conviction is limited by data completeness, freshness or confidence; incomplete data cannot force a portfolio action.";conviction="LOW";}
 else if(critical&&weakCore){action="EXIT";reason="Long-term business quality is weak and independent risk signals are critical; the investment thesis is materially impaired.";conviction="HIGH";}
 else if(strongCore&&weakSetup){action="HOLD / WAIT FOR BETTER ENTRY";reason="Strong long-term business quality, but the current short-term setup does not justify aggressive buying.";conviction="HIGH";}
 else if(weakCore&&strongSetup){action="SHORT-TERM OPPORTUNITY / NOT A CORE BUY";reason="The current technical setup is attractive, but long-term business quality is not strong enough to treat this as a core investment.";conviction="MEDIUM";}
 else if(concentrated&&(highRisk||(val!=null&&val<35))){action="REDUCE";reason="The thesis may remain intact, but portfolio concentration combined with risk or valuation makes the current position too aggressive.";conviction="HIGH";}
 else if(goodCore&&strongSetup&&(risk==null||risk>=55)&&(val==null||val>=45)&&!concentrated&&regime!=="BEAR"){action="ACCUMULATE";reason="Good long-term quality is supported by a strong current setup, manageable risk and acceptable valuation.";conviction="HIGH";}
 else if(strongCore&&(st==null||st>=60)&&(risk==null||risk>=55)&&(val==null||val>=40)){action="HOLD";reason="Long-term quality is strong; current conditions support holding, while evidence is not strong enough to justify aggressive adding.";conviction="HIGH";}
 else if(goodCore){action=weakSetup?"HOLD / WAIT FOR BETTER ENTRY":"HOLD";reason=weakSetup?"Long-term thesis is good, but current momentum is weak; wait for a better entry rather than confusing business quality with timing.":"Long-term thesis remains constructive, but current evidence does not justify aggressive accumulation.";conviction="MEDIUM";}
 else if(weakCore&&(risk==null||risk<55)){action="REDUCE";reason="Long-term business quality is weak and risk is not low enough to justify maintaining a large position.";conviction="MEDIUM";}
 else if(regime==="BEAR"&&final!=null&&final<75){action="HOLD / WAIT";reason="The thesis is not necessarily broken, but a defensive market regime raises the hurdle for fresh capital.";conviction="MEDIUM";}
 else{action="WATCH";reason="Mixed long-term quality, current opportunity, risk and valuation signals need confirmation.";conviction="LOW";}
 if(pnl!=null&&pnl<=-25&&weakCore&&action==="HOLD"){action="REDUCE";reason="A large drawdown is occurring alongside weak long-term business quality; the position no longer has enough thesis support.";conviction="MEDIUM";}
 return{action,reason,conviction};
}

async function buildForUser(client,userId){
 const [h,i,s,mr]=await Promise.all([
  client.from("holdings").select("instrument_id,current_value,invested_value,pnl_percentage,unrealized_pnl").eq("user_id",userId),
  client.from("instruments").select("id,company_name,symbol,sector"),
  client.from("ai_scores").select("instrument_id,total_score,long_term_score,short_term_score,final_ai_score,risk_score,valuation_score,confidence,data_completeness,freshness_status,score_version,score_breakdown,action,risk_level,rating,updated_at,calculated_at").eq("user_id",userId),
  client.from("market_regime_history").select("regime,portfolio_mode,snapshot_at").order("snapshot_at",{ascending:false}).limit(1)
 ]);
 for(const x of [h,i,s,mr])if(x.error)throw new Error(x.error.message);
 const im=new Map((i.data||[]).map(x=>[x.id,x])),sm=new Map((s.data||[]).map(x=>[x.instrument_id,x])),total=(h.data||[]).reduce((a,x)=>a+(n(x.current_value)||0),0),regime=mr.data?.[0]?.regime||"NEUTRAL";
 const results=(h.data||[]).map(row=>{const sc=sm.get(row.instrument_id)||{},meta=im.get(row.instrument_id)||{},lt=n(sc.long_term_score),st=n(sc.short_term_score),risk=n(sc.risk_score),val=n(sc.valuation_score),final=n(sc.final_ai_score),weight=total>0?(n(row.current_value)||0)/total*100,pnl=row.pnl_percentage??((n(row.invested_value)||0)>0?(n(row.unrealized_pnl)||0)/(n(row.invested_value)||1)*100:null),d=decide({long_term_score:lt,short_term_score:st,risk_score:risk,valuation_score:val,final_ai_score:final,confidence:sc.confidence,data_completeness:sc.data_completeness,freshness:sc.freshness_status,weight,pnl,regime});return{instrument_id:row.instrument_id,company_name:meta.company_name||meta.symbol||"Holding",symbol:meta.symbol||null,sector:meta.sector||"OTHER",is_existing_holding:true,portfolio_weight_pct:+weight.toFixed(2),pnl_pct:pnl==null?null:+Number(pnl).toFixed(2),long_term_score:lt,long_term_grade:gradeLT(lt),short_term_score:st,short_term_grade:gradeST(st),risk_score:risk,valuation_score:val,final_ai_score:final,final_grade:gradeFinal(final),confidence:n(sc.confidence),data_completeness:n(sc.data_completeness),freshness_status:sc.freshness_status||"MISSING",score_version:sc.score_version||"legacy",model_action:sc.action||null,risk_level:sc.risk_level||null,rating:sc.rating||null,decision:d.action,conviction:d.conviction,reason:d.reason,score_breakdown:sc.score_breakdown||{},market_regime:regime};});
 const rank={EXIT:0,REDUCE:1,"SHORT-TERM OPPORTUNITY / NOT A CORE BUY":2,"HOLD / WAIT FOR BETTER ENTRY":3,"HOLD / WAIT":4,WATCH:5,HOLD:6,ACCUMULATE:7,BUY:8};results.sort((a,b)=>(rank[a.decision]??99)-(rank[b.decision]??99)||(b.confidence||0)-(a.confidence||0));return{user_id:userId,market_regime:regime,portfolio_value:total,decisions:results};
}
async function persist(decisions,userId){let updated=0;for(const item of decisions||[]){if(!item.instrument_id||!item.decision)continue;const{error}=await admin.from("ai_scores").update({action:item.decision,updated_at:new Date().toISOString()}).eq("instrument_id",item.instrument_id).eq("user_id",userId);if(error)throw new Error(`Decision persistence failed for ${item.company_name||item.instrument_id}: ${error.message}`);updated++;}return updated;}
export async function GET(request){try{const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Authentication required."},{status:401});const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});const{data:u,error:ue}=await client.auth.getUser(token);if(ue||!u?.user)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Invalid session."},{status:401});const portfolio=await buildForUser(client,u.user.id),persisted=await persist(portfolio.decisions,u.user.id),decision_counts={};for(const x of portfolio.decisions)decision_counts[x.decision]=(decision_counts[x.decision]||0)+1;return NextResponse.json({success:true,engine_version:ENGINE_VERSION,generated_at:new Date().toISOString(),...portfolio,decision_counts,persisted_actions:persisted});}catch(error){console.error("Decision engine v5.1 error:",error);return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Decision engine failed."},{status:500});}}
