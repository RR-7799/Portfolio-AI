import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "portfolio_alerts_v1_6";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function userClient(token){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});}
function pipelineAuth(request){const secret=process.env.PIPELINE_SECRET; if(!secret)return false; const h=request.headers.get("x-pipeline-secret")||""; const a=request.headers.get("authorization")||""; return h===secret||a===`Bearer ${secret}`;}
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const up=v=>String(v||"").toUpperCase();

async function generateForAllUsers(){
 const [h,i,s,m]=await Promise.all([
  admin.from("holdings").select("user_id,instrument_id,current_value,invested_value,unrealized_pnl,pnl_percentage"),
  admin.from("instruments").select("id,company_name,symbol,sector"),
  // updated_at is the canonical score refresh timestamp written by the scoring engines.
  // Keep the latest two rows per instrument so alert comparisons remain scan-aware.
  admin.from("ai_scores").select("instrument_id,total_score,action,risk_level,rating,score_breakdown,updated_at").order("updated_at",{ascending:false}),
  admin.from("market_regime_history").select("regime,score,confidence,portfolio_mode,snapshot_at").order("snapshot_at",{ascending:false}).limit(2)
 ]);
 const queryErrors=[
  ["holdings",h.error],
  ["instruments",i.error],
  ["ai_scores",s.error],
  ["market_regime_history",m.error],
 ].filter(([,error])=>error);
 if(queryErrors.length) throw new Error(queryErrors.map(([name,error])=>`${name} query failed: ${error.message}`).join(" | "));
 const im=new Map((i.data||[]).map(x=>[x.id,x]));
 const scoreHistory=new Map();
 for(const row of (s.data||[])){
  const list=scoreHistory.get(row.instrument_id)||[];
  if(list.length<2)list.push(row);
  scoreHistory.set(row.instrument_id,list);
 }
 const sm=new Map([...scoreHistory].map(([id,list])=>[id,list[0]]));
 const users=[...new Set((h.data||[]).map(x=>x.user_id).filter(Boolean))];
 const regime=m.data?.[0]||null; const previous=m.data?.[1]||null; const alerts=[];
 for(const userId of users){
  const holdings=(h.data||[]).filter(x=>x.user_id===userId); const total=holdings.reduce((a,x)=>a+n(x.current_value),0); const sectorMap=new Map();
  for(const x of holdings){
   const meta=im.get(x.instrument_id)||{}; const sc=sm.get(x.instrument_id)||{}; const history=scoreHistory.get(x.instrument_id)||[]; const prior=history[1]||null;
   const b=sc.score_breakdown||{}; const freshness=b.freshness||{}; const priorFreshness=(prior?.score_breakdown||{}).freshness||{};
   const weight=total>0?n(x.current_value)/total*100:0; const pnl=n(x.pnl_percentage); const name=meta.company_name||meta.symbol||"Holding";
   const currentAction=up(sc.action); const priorAction=up(prior?.action); const currentRisk=up(sc.risk_level); const priorRisk=up(prior?.risk_level);
   const currentFresh=up(freshness.status); const priorFresh=up(priorFreshness.status);
   // Only attach an instrument_id when the referenced instrument exists. This prevents
   // one orphaned holding from failing the entire alert batch on the FK constraint.
   const alertInstrumentId=im.has(x.instrument_id)?x.instrument_id:null;
   if(weight>=15)alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:"CRITICAL",type:"CONCENTRATION",title:`${name} is oversized`,message:`Portfolio weight is ${weight.toFixed(1)}%, above the 15% concentration guardrail.`,dedupe_key:`CONCENTRATION:${x.instrument_id}:15`});
   if(currentRisk==="CRITICAL")alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:"CRITICAL",type:"CRITICAL_RISK",title:`${name} has critical risk`,message:`AI risk classification is CRITICAL with score ${sc.total_score??"—"}.`,dedupe_key:`CRITICAL_RISK:${x.instrument_id}`});
   if(currentAction==="EXIT")alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:"CRITICAL",type:"EXIT_SIGNAL",title:`Review ${name} for exit`,message:`Decision Engine is currently flagging EXIT.`,dedupe_key:`EXIT_SIGNAL:${x.instrument_id}`});
   if(pnl<=-25)alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:"CRITICAL",type:"DRAWDOWN",title:`${name} has severe drawdown`,message:`Current unrealized loss is ${pnl.toFixed(1)}%.`,dedupe_key:`DRAWDOWN:${x.instrument_id}:25`});
   if(prior){
    const currentScore=n(sc.total_score); const priorScore=n(prior.total_score); const delta=currentScore-priorScore;
    if(delta<=-10)alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:"CRITICAL",type:"SCORE_DROP",title:`${name} AI score fell sharply`,message:`AI score changed from ${priorScore.toFixed(1)} to ${currentScore.toFixed(1)} (${delta.toFixed(1)}) since the previous scan.`,dedupe_key:`SCORE_DROP:${x.instrument_id}:${Math.floor(currentScore/5)}`});
    else if(delta<=-5)alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:"WARNING",type:"SCORE_DROP",title:`${name} AI score declined`,message:`AI score changed from ${priorScore.toFixed(1)} to ${currentScore.toFixed(1)} (${delta.toFixed(1)}) since the previous scan.`,dedupe_key:`SCORE_DROP:${x.instrument_id}:${Math.floor(currentScore/5)}`});
    if(currentRisk!==priorRisk&&currentRisk){
     const worsened=["HIGH","CRITICAL"].includes(currentRisk)&&!["HIGH","CRITICAL"].includes(priorRisk); const improved=["LOW","MODERATE"].includes(currentRisk)&&["HIGH","CRITICAL"].includes(priorRisk);
     if(worsened)alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:currentRisk==="CRITICAL"?"CRITICAL":"WARNING",type:"RISK_CHANGE",title:`${name} risk worsened`,message:`AI risk classification moved from ${priorRisk||"UNKNOWN"} to ${currentRisk}.`,dedupe_key:`RISK_CHANGE:${x.instrument_id}:${priorRisk}:${currentRisk}`});
     else if(improved)alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:"INFO",type:"RISK_IMPROVEMENT",title:`${name} risk improved`,message:`AI risk classification moved from ${priorRisk} to ${currentRisk}.`,dedupe_key:`RISK_CHANGE:${x.instrument_id}:${priorRisk}:${currentRisk}`});
    }
    if(currentAction!==priorAction&&currentAction){const urgent=["EXIT","REDUCE"].includes(currentAction);alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:urgent?(currentAction==="EXIT"?"CRITICAL":"WARNING"):"INFO",type:"ACTION_CHANGE",title:`${name} action changed`,message:`AI action moved from ${priorAction||"UNKNOWN"} to ${currentAction}.`,dedupe_key:`ACTION_CHANGE:${x.instrument_id}:${priorAction}:${currentAction}`});}
    if(currentFresh!==priorFresh&&["STALE","VERY_STALE","MISSING"].includes(currentFresh))alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:"WARNING",type:"STALE_DATA",title:`${name} data became stale`,message:`Fundamental freshness changed from ${priorFresh||"UNKNOWN"} to ${currentFresh}.`,dedupe_key:`STALE_DATA_CHANGE:${x.instrument_id}:${priorFresh}:${currentFresh}`});
    const crossed15=pnl<=-15 && n(prior?.pnl_percentage)>-15; const crossed25=pnl<=-25 && n(prior?.pnl_percentage)>-25;
    if(crossed15&&!crossed25)alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:"WARNING",type:"DRAWDOWN",title:`${name} entered drawdown`,message:`Unrealized loss crossed -15% and is now ${pnl.toFixed(1)}%.`,dedupe_key:`DRAWDOWN_CROSS:${x.instrument_id}:15`});
    if(crossed25)alerts.push({user_id:userId,instrument_id:alertInstrumentId,severity:"CRITICAL",type:"DRAWDOWN",title:`${name} entered severe drawdown`,message:`Unrealized loss crossed -25% and is now ${pnl.toFixed(1)}%.`,dedupe_key:`DRAWDOWN_CROSS:${x.instrument_id}:25`});
   }
   const sector=meta.sector||"OTHER"; sectorMap.set(sector,(sectorMap.get(sector)||0)+n(x.current_value));
  }
  for(const [sector,value] of sectorMap){const weight=total>0?value/total*100:0;if(weight>=40)alerts.push({user_id:userId,instrument_id:null,severity:"CRITICAL",type:"SECTOR_CONCENTRATION",title:`${sector} exposure is very high`,message:`Sector exposure is ${weight.toFixed(1)}% of the portfolio.`,dedupe_key:`SECTOR_CONCENTRATION:${sector}:40`});else if(weight>=30)alerts.push({user_id:userId,instrument_id:null,severity:"WARNING",type:"SECTOR_CONCENTRATION",title:`${sector} exposure is high`,message:`Sector exposure is ${weight.toFixed(1)}% of the portfolio.`,dedupe_key:`SECTOR_CONCENTRATION:${sector}:30`});}
  if(regime&&previous&&regime.regime!==previous.regime)alerts.push({user_id:userId,instrument_id:null,severity:regime.regime==="BEAR"?"CRITICAL":"WARNING",type:"REGIME_CHANGE",title:`Market regime changed to ${regime.regime}`,message:`Market regime moved from ${previous.regime} to ${regime.regime} with score ${n(regime.score).toFixed(0)}/100.`,dedupe_key:`REGIME_CHANGE:${previous.regime}:${regime.regime}`});
 }
 return alerts;
}

async function persistAlerts(generated){
 if(!generated.length)return {persisted:0,warning:null};
 const deduped=[...new Map(generated.map(x=>[`${x.user_id}|${x.dedupe_key}`,x])).values()]; const users=[...new Set(deduped.map(x=>x.user_id))]; const existingKeys=new Set();
 for(const userId of users){const keys=deduped.filter(x=>x.user_id===userId).map(x=>x.dedupe_key).filter(Boolean);for(let offset=0;offset<keys.length;offset+=500){const chunk=keys.slice(offset,offset+500);const {data,error}=await admin.from("portfolio_alerts").select("dedupe_key").eq("user_id",userId).in("dedupe_key",chunk);if(error)return {persisted:0,warning:`Alert lookup failed: ${error.message}`};for(const row of data||[])if(row.dedupe_key)existingKeys.add(`${userId}|${row.dedupe_key}`);}}
 const fresh=deduped.filter(x=>!existingKeys.has(`${x.user_id}|${x.dedupe_key}`)); if(!fresh.length)return {persisted:0,warning:null};
 const chunkSize=25; const chunks=[]; for(let i=0;i<fresh.length;i+=chunkSize)chunks.push(fresh.slice(i,i+chunkSize));
 const results=await Promise.all(chunks.map(async chunk=>{
  const result=await admin.from("portfolio_alerts").insert(chunk);
  if(!result.error)return {persisted:chunk.length,warning:null};
  const individual=await Promise.all(chunk.map(async alert=>{const one=await admin.from("portfolio_alerts").insert(alert);if(!one.error)return {ok:true};if(one.error.code==="23505")return {ok:false};return {ok:false,error:one.error.message};}));
  const persisted=individual.filter(x=>x.ok).length; const errors=individual.map(x=>x.error).filter(Boolean); return {persisted,warning:errors[0]||null};
 }));
 const persisted=results.reduce((sum,x)=>sum+(x.persisted||0),0); const warning=results.map(x=>x.warning).find(Boolean)||null;
 return {persisted,warning:warning?`Some alerts could not be saved: ${warning}`:null};
}

export async function GET(request){
 try{
  const auth=request.headers.get("authorization")||""; const token=auth.replace(/^Bearer\s+/i,"").trim();
  if(pipelineAuth(request)){const generated=await generateForAllUsers();const result=await persistAlerts(generated);return NextResponse.json({success:true,engine_version:ENGINE_VERSION,mode:"pipeline",generated:generated.length,persisted:result.persisted,warning:result.warning});}
  if(!token)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Authentication required."},{status:401});
  const supabase=userClient(token); const {data:userResult,error:userError}=await supabase.auth.getUser(token); if(userError||!userResult?.user)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Invalid session."},{status:401});
  const {data,error}=await supabase.from("portfolio_alerts").select("id,instrument_id,severity,type,title,message,is_read,created_at").eq("user_id",userResult.user.id).order("created_at",{ascending:false}).limit(100); if(error)throw new Error(error.message);
  const alerts=data||[]; return NextResponse.json({success:true,engine_version:ENGINE_VERSION,generated_at:new Date().toISOString(),summary:{alert_count:alerts.length,critical:alerts.filter(x=>x.severity==="CRITICAL").length,warning:alerts.filter(x=>x.severity==="WARNING").length,info:alerts.filter(x=>x.severity==="INFO").length,unread:alerts.filter(x=>!x.is_read).length},alerts});
 }catch(error){console.error("Portfolio alerts error",error);return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Portfolio alerts failed."},{status:500});}
}

export async function PATCH(request){
 try{const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return NextResponse.json({success:false,error:"Authentication required."},{status:401});const supabase=userClient(token);const {data:u,error:ue}=await supabase.auth.getUser(token);if(ue||!u?.user)return NextResponse.json({success:false,error:"Invalid session."},{status:401});const body=await request.json();const id=String(body?.id||"");if(!id)return NextResponse.json({success:false,error:"Alert id is required."},{status:400});const {error}=await supabase.from("portfolio_alerts").update({is_read:true}).eq("id",id).eq("user_id",u.user.id);if(error)throw new Error(error.message);return NextResponse.json({success:true,updated:true,id});}catch(error){return NextResponse.json({success:false,error:error?.message||"Unable to update alert."},{status:500});}
}
