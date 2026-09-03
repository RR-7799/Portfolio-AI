import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "decision_engine_v3_0";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:null;};
const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,v));
const avg=(a,f=null)=>{const x=a.map(n).filter(v=>v!==null);return x.length?x.reduce((p,c)=>p+c,0)/x.length:f;};
const pct=(v,max)=>{const x=n(v);return x===null?null:clamp(x/max*100);};
const up=v=>String(v||"").toUpperCase();

function percentile(value, peers){
  const v=n(value); const p=(peers||[]).map(n).filter(x=>x!==null).sort((a,b)=>a-b);
  if(v===null||p.length<3)return null;
  let below=0; for(const x of p)if(x<v)below++;
  return below/(p.length-1)*100;
}
function peerContext(row, peers){
  const valuationPct=percentile(row.valuation_score,peers.map(x=>x.valuation_score));
  const growthPct=percentile(row.growth_score,peers.map(x=>x.growth_score));
  const qualityRaw=avg([pct(row.profitability_score,20),pct(row.debt_score,10),pct(row.cashflow_score,10),pct(row.ownership_score,10)]);
  const qualityPct=percentile(qualityRaw,peers.map(x=>avg([pct(x.profitability_score,20),pct(x.debt_score,10),pct(x.cashflow_score,10),pct(x.ownership_score,10)])));
  const scorePct=percentile(row.total_score,peers.map(x=>x.total_score));
  return {valuation_pct:valuationPct,growth_pct:growthPct,quality_pct:qualityPct,score_pct:scorePct};
}

function decisionV3(input){
 const {score,risk,weight,pnl,freshness,regime,modelAction,growth,profitability,debt,ownership,cashflow,valuation,riskScore,peer}=input;
 const s=n(score)||0,r=up(risk),f=up(freshness),m=up(regime),growthP=pct(growth,20),profitP=pct(profitability,20),debtP=pct(debt,10),ownershipP=pct(ownership,10),cashP=pct(cashflow,10),valuationP=pct(valuation,15),riskP=pct(riskScore,15);
 const thesis=clamp(avg([growthP,profitP,debtP,cashP],s)),quality=clamp(avg([profitP,debtP,cashP,ownershipP],s));
 const relativeAvailable=peer&&peer.score_pct!==null;
 const relativeStrength=relativeAvailable?avg([peer.score_pct,peer.growth_pct,peer.quality_pct]):null;
 const relativeValue=peer?.valuation_pct;
 const strongThesis=thesis>=65&&quality>=58&&(relativeStrength===null||relativeStrength>=45);
 const brokenThesis=thesis<40&&quality<46&&(relativeStrength===null||relativeStrength<35);
 const criticalRisk=r==="CRITICAL"||(riskP!==null&&riskP<30),highRisk=r==="HIGH"||(riskP!==null&&riskP<50);
 const stale=["MISSING","VERY_STALE"].includes(f),severeDrawdown=(n(pnl)||0)<=-25,overweight=(n(weight)||0)>=15;
 const weakMomentum=up(modelAction)==="REDUCE";
 const relativelyCheap=relativeValue!==null?relativeValue>=65:(valuationP!==null&&valuationP>=65);
 const relativelyExpensive=relativeValue!==null?relativeValue<=25:(valuationP!==null&&valuationP<35);
 const strongRelativeGrowth=peer?.growth_pct!==null&&peer?.growth_pct>=65;
 const weakRelativeQuality=peer?.quality_pct!==null&&peer?.quality_pct<30;
 let action,reason,confidence;
 if(brokenThesis&&criticalRisk){action="EXIT";reason="Thesis is materially weak and risk is critical";confidence=94;}
 else if(criticalRisk&&!strongThesis&&s<50){action="EXIT";reason="Multiple independent signals indicate thesis impairment";confidence=91;}
 else if(overweight&&(relativelyExpensive||highRisk||s<60)){action="REDUCE";reason="Position size is high relative to current risk/reward";confidence=87;}
 else if(highRisk&&severeDrawdown&&!strongThesis){action="REDUCE";reason="High risk and severe drawdown are not supported by the current thesis";confidence=86;}
 else if(strongThesis&&relativelyCheap&&(riskP===null||riskP>=55)&&!stale&&m!=="BEAR"){action="ACCUMULATE";reason=strongRelativeGrowth?"Strong thesis with favorable relative growth and valuation":"Strong thesis with attractive relative valuation and manageable risk";confidence=87;}
 else if(s>=82&&quality>=65&&!criticalRisk&&!highRisk&&!stale&&!relativelyExpensive&&m!=="BEAR"&&(weight||0)<12&&(relativeStrength===null||relativeStrength>=65)){action="BUY";reason="Strong absolute score plus strong relative peer position and acceptable portfolio weight";confidence=90;}
 else if(strongThesis&&!weakRelativeQuality&&(s>=52||weakMomentum)){action="HOLD";reason=weakMomentum?"Long-term thesis remains intact despite weaker momentum":"Thesis remains intact; current relative opportunity does not justify aggressive adding";confidence=82;}
 else if(stale){action="WATCH";reason="Conviction is limited because fundamental data is stale";confidence=77;}
 else if(m==="BEAR"&&s<75){action="HOLD";reason="Thesis is not broken, but the market regime argues against aggressive adding";confidence=76;}
 else{action="WATCH";reason="Mixed absolute and relative signals need confirmation";confidence=70;}
 if(action==="HOLD"&&overweight&&(relativelyExpensive||highRisk)){action="REDUCE";reason="Thesis remains intact, but concentration and risk/reward warrant trimming";confidence=84;}
 if(action==="ACCUMULATE"&&overweight){action="HOLD";reason="Strong thesis, but the existing position is already large enough";confidence=85;}
 const regimeAdj=m==="BEAR"&&["BUY","ACCUMULATE"].includes(action)?-8:m==="BULL"&&["HOLD","WATCH"].includes(action)?3:0;
 confidence=clamp(confidence+regimeAdj,55,97);
 return {action,reason,confidence,diagnostics:{thesis_score:+thesis.toFixed(1),quality_score:+quality.toFixed(1),relative_strength:+(relativeStrength??0).toFixed(1),relative_value_percentile:relativeValue===null?null:+relativeValue.toFixed(1),relative_growth_percentile:peer?.growth_pct===null?null:+peer.growth_pct.toFixed(1),relative_quality_percentile:peer?.quality_pct===null?null:+peer.quality_pct.toFixed(1),normalized_components:{growth:growthP===null?null:+growthP.toFixed(1),profitability:profitP===null?null:+profitP.toFixed(1),debt:debtP===null?null:+debtP.toFixed(1),ownership:ownershipP===null?null:+ownershipP.toFixed(1),cashflow:cashP===null?null:+cashP.toFixed(1),valuation:valuationP===null?null:+valuationP.toFixed(1),risk:riskP===null?null:+riskP.toFixed(1)},signals:{strong_thesis:strongThesis,broken_thesis:brokenThesis,critical_risk:criticalRisk,high_risk:highRisk,overweight,severe_drawdown:severeDrawdown,relatively_cheap:relativelyCheap,relatively_expensive:relativelyExpensive,stale_data:stale}};
}

async function buildForUser(client,userId){
 const [h,i,s,mr]=await Promise.all([
  client.from("holdings").select("instrument_id,current_value,invested_value,pnl_percentage,unrealized_pnl").eq("user_id",userId),
  client.from("instruments").select("id,company_name,symbol,sector"),
  client.from("ai_scores").select("instrument_id,total_score,growth_score,profitability_score,debt_score,ownership_score,cashflow_score,valuation_score,risk_score,action,risk_level,rating,score_breakdown,updated_at,calculated_at").eq("user_id",userId),
  client.from("market_regime_history").select("regime,portfolio_mode,snapshot_at").order("snapshot_at",{ascending:false}).limit(1)
 ]);
 for(const x of[h,i,s,mr])if(x.error)throw new Error(x.error.message);
 const im=new Map((i.data||[]).map(x=>[x.id,x])),sm=new Map((s.data||[]).map(x=>[x.instrument_id,x]));
 const total=(h.data||[]).reduce((a,x)=>a+(n(x.current_value)||0),0),regime=mr.data?.[0]?.regime||null;
 const rows=(h.data||[]).map(x=>{const sc=sm.get(x.instrument_id)||{};const meta=im.get(x.instrument_id)||{};return {...sc,holding:x,meta,sector:meta.sector||"OTHER"};});
 const results=rows.map(row=>{
  const sc=row,holding=row.holding,meta=row.meta,freshness=sc.score_breakdown?.freshness?.status||"MISSING";
  const weight=total>0?(n(holding.current_value)||0)/total*100:0,pnl=holding.pnl_percentage??((n(holding.invested_value)||0)>0?(n(holding.unrealized_pnl)||0)/(n(holding.invested_value)||1)*100:0);
  const peers=rows.filter(x=>x.sector===row.sector&&x.instrument_id!==row.instrument_id).map(x=>x);
  const peer=peerContext(sc,peers);
  const d=decisionV3({score:sc.total_score,risk:sc.risk_level,weight,pnl,freshness,regime,modelAction:sc.action,growth:sc.growth_score,profitability:sc.profitability_score,debt:sc.debt_score,ownership:sc.ownership_score,cashflow:sc.cashflow_score,valuation:sc.valuation_score,riskScore:sc.risk_score,peer});
  return {instrument_id:row.instrument_id,company_name:meta.company_name||meta.symbol||"Holding",symbol:meta.symbol||null,sector:row.sector,portfolio_weight_pct:+weight.toFixed(2),pnl_pct:+(n(pnl)||0).toFixed(2),ai_score:sc.total_score??null,risk_level:sc.risk_level||null,rating:sc.rating||null,model_action:sc.action||null,freshness_status:freshness,growth_score:sc.growth_score??null,profitability_score:sc.profitability_score??null,debt_score:sc.debt_score??null,ownership_score:sc.ownership_score??null,cashflow_score:sc.cashflow_score??null,valuation_score:sc.valuation_score??null,risk_score:sc.risk_score??null,decision:d.action,confidence:d.confidence,reason:d.reason,market_regime:regime,...d.diagnostics};
 });
 const rank={EXIT:0,REDUCE:1,"HOLD & TRIM":2,WATCH:3,HOLD:4,ACCUMULATE:5,BUY:6};results.sort((a,b)=>(rank[a.decision]??99)-(rank[b.decision]??99)||(b.confidence-a.confidence));
 return {user_id:userId,market_regime:regime,portfolio_value:total,decisions:results};
}
async function persistFinalActions(decisions,userId){let updated=0;for(const item of decisions||[]){if(!item.instrument_id||!item.decision)continue;const {error}=await admin.from("ai_scores").update({action:item.decision,updated_at:new Date().toISOString()}).eq("instrument_id",item.instrument_id).eq("user_id",userId);if(error)throw new Error(`Decision persistence failed for ${item.company_name||item.instrument_id}: ${error.message}`);updated++;}return updated;}
export async function GET(request){try{const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Authentication required."},{status:401});const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});const {data:userResult,error:userError}=await client.auth.getUser(token);if(userError||!userResult?.user)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Invalid session."},{status:401});const userId=userResult.user.id;const portfolio=await buildForUser(client,userId);const persisted=await persistFinalActions(portfolio.decisions,userId);const decision_counts={};for(const x of portfolio.decisions)decision_counts[x.decision]=(decision_counts[x.decision]||0)+1;return NextResponse.json({success:true,engine_version:ENGINE_VERSION,generated_at:new Date().toISOString(),...portfolio,decision_counts,persisted_actions:persisted});}catch(error){console.error("Decision engine V3 error:",error);return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Decision engine failed."},{status:500});}}
