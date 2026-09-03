import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "portfolio_alerts_v1_7";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function userClient(token){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});}
function pipelineAuth(request){const secret=process.env.PIPELINE_SECRET;if(!secret)return false;const h=request.headers.get("x-pipeline-secret")||"";const a=request.headers.get("authorization")||"";return h===secret||a===`Bearer ${secret}`;}
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const up=v=>String(v||"").toUpperCase();

async function generateForAllUsers(){
 const [h,i,s,m]=await Promise.all([
  admin.from("holdings").select("user_id,instrument_id,current_value,pnl_percentage"),
  admin.from("instruments").select("id,company_name,symbol,sector"),
  admin.from("ai_scores").select("instrument_id,total_score,action,risk_level,score_breakdown,updated_at").order("updated_at",{ascending:false}),
  admin.from("market_regime_history").select("regime,score,snapshot_at").order("snapshot_at",{ascending:false}).limit(2)
 ]);
 const errors=[["holdings",h.error],["instruments",i.error],["ai_scores",s.error],["market_regime_history",m.error]].filter(([,e])=>e);
 if(errors.length)throw new Error(errors.map(([name,e])=>`${name} query failed: ${e.message}`).join(" | "));
 const im=new Map((i.data||[]).map(x=>[x.id,x]));
 const history=new Map();
 for(const row of s.data||[]){const list=history.get(row.instrument_id)||[];if(list.length<2)list.push(row);history.set(row.instrument_id,list);}
 const users=[...new Set((h.data||[]).map(x=>x.user_id).filter(Boolean))];
 const regime=m.data?.[0]||null,previousRegime=m.data?.[1]||null,alerts=[];
 for(const userId of users){
  const holdings=(h.data||[]).filter(x=>x.user_id===userId);const total=holdings.reduce((a,x)=>a+n(x.current_value),0);const sectorMap=new Map();
  for(const x of holdings){
   const meta=im.get(x.instrument_id)||{};const rows=history.get(x.instrument_id)||[];const sc=rows[0]||{};const prior=rows[1]||null;const name=meta.company_name||meta.symbol||"Holding";const aid=im.has(x.instrument_id)?x.instrument_id:null;
   const action=up(sc.action),priorAction=up(prior?.action);const risk=up(sc.risk_level),priorRisk=up(prior?.risk_level);const pnl=n(x.pnl_percentage),priorPnl=n(prior?.pnl_percentage);
   const weight=total>0?n(x.current_value)/total*100:0;const sector=meta.sector||"OTHER";sectorMap.set(sector,(sectorMap.get(sector)||0)+n(x.current_value));
   if(prior){
    const scoreDelta=n(sc.total_score)-n(prior.total_score);
    if(scoreDelta<=-10)alerts.push({user_id:userId,instrument_id:aid,severity:"CRITICAL",type:"SCORE_DROP",title:`${name} AI score fell sharply`,message:`AI score changed from ${n(prior.total_score).toFixed(1)} to ${n(sc.total_score).toFixed(1)} (${scoreDelta.toFixed(1)}) since the previous scan.`,dedupe_key:`SCORE_DROP:${x.instrument_id}:${Math.floor(n(sc.total_score)/5)}`});
    else if(scoreDelta<=-5)alerts.push({user_id:userId,instrument_id:aid,severity:"WARNING",type:"SCORE_DROP",title:`${name} AI score declined`,message:`AI score changed from ${n(prior.total_score).toFixed(1)} to ${n(sc.total_score).toFixed(1)} (${scoreDelta.toFixed(1)}) since the previous scan.`,dedupe_key:`SCORE_DROP:${x.instrument_id}:${Math.floor(n(sc.total_score)/5)}`});
    if(action!==priorAction&&action){const urgent=["EXIT","REDUCE"].includes(action);alerts.push({user_id:userId,instrument_id:aid,severity:action==="EXIT"?"CRITICAL":urgent?"WARNING":"INFO",type:"ACTION_CHANGE",title:`${name} action changed`,message:`AI action moved from ${priorAction||"UNKNOWN"} to ${action}.`,dedupe_key:`ACTION_CHANGE:${x.instrument_id}:${priorAction}:${action}`});}
    if(risk!==priorRisk&&risk){const worsened=["HIGH","CRITICAL"].includes(risk)&&!["HIGH","CRITICAL"].includes(priorRisk);const improved=["LOW","MODERATE"].includes(risk)&&["HIGH","CRITICAL"].includes(priorRisk);if(worsened)alerts.push({user_id:userId,instrument_id:aid,severity:risk==="CRITICAL"?"CRITICAL":"WARNING",type:"RISK_CHANGE",title:`${name} risk worsened`,message:`AI risk moved from ${priorRisk||"UNKNOWN"} to ${risk}.`,dedupe_key:`RISK_CHANGE:${x.instrument_id}:${priorRisk}:${risk}`});else if(improved)alerts.push({user_id:userId,instrument_id:aid,severity:"INFO",type:"RISK_IMPROVEMENT",title:`${name} risk improved`,message:`AI risk moved from ${priorRisk} to ${risk}.`,dedupe_key:`RISK_CHANGE:${x.instrument_id}:${priorRisk}:${risk}`});}
    if(pnl<=-15&&priorPnl>-15)alerts.push({user_id:userId,instrument_id:aid,severity:"WARNING",type:"DRAWDOWN",title:`${name} entered drawdown`,message:`Unrealized loss crossed -15% and is now ${pnl.toFixed(1)}%.`,dedupe_key:`DRAWDOWN_CROSS:${x.instrument_id}:15`});
    if(pnl<=-25&&priorPnl>-25)alerts.push({user_id:userId,instrument_id:aid,severity:"CRITICAL",type:"DRAWDOWN",title:`${name} entered severe drawdown`,message:`Unrealized loss crossed -25% and is now ${pnl.toFixed(1)}%.`,dedupe_key:`DRAWDOWN_CROSS:${x.instrument_id}:25`});
   }
   if(weight>=15)alerts.push({user_id:userId,instrument_id:aid,severity:"WARNING",type:"CONCENTRATION",title:`${name} is oversized`,message:`Portfolio weight is ${weight.toFixed(1)}%. Review concentration and position sizing.`,dedupe_key:`CONCENTRATION:${x.instrument_id}:15`});
  }
  for(const [sector,value] of sectorMap){const weight=total>0?value/total*100:0;if(weight>=40)alerts.push({user_id:userId,instrument_id:null,severity:"CRITICAL",type:"SECTOR_CONCENTRATION",title:`${sector} exposure is very high`,message:`Sector exposure is ${weight.toFixed(1)}% of the portfolio.`,dedupe_key:`SECTOR_CONCENTRATION:${sector}:40`});else if(weight>=30)alerts.push({user_id:userId,instrument_id:null,severity:"WARNING",type:"SECTOR_CONCENTRATION",title:`${sector} exposure is high`,message:`Sector exposure is ${weight.toFixed(1)}% of the portfolio.`,dedupe_key:`SECTOR_CONCENTRATION:${sector}:30`});}
  if(regime&&previousRegime&&regime.regime!==previousRegime.regime)alerts.push({user_id:userId,instrument_id:null,severity:regime.regime==="BEAR"?"CRITICAL":"WARNING",type:"REGIME_CHANGE",title:`Market regime changed to ${regime.regime}`,message:`Market regime moved from ${previousRegime.regime} to ${regime.regime}.`,dedupe_key:`REGIME_CHANGE:${previousRegime.regime}:${regime.regime}`});
 }
 return alerts;
}

async function persistAlerts(generated){
 if(!generated.length)return {persisted:0,warning:null};
 const deduped=[...new Map(generated.map(x=>[`${x.user_id}|${x.dedupe_key}`,x])).values()];const users=[...new Set(deduped.map(x=>x.user_id))];const existing=new Set();
 for(const userId of users){const keys=deduped.filter(x=>x.user_id===userId).map(x=>x.dedupe_key).filter(Boolean);for(let o=0;o<keys.length;o+=500){const {data,error}=await admin.from("portfolio_alerts").select("dedupe_key").eq("user_id",userId).in("dedupe_key",keys.slice(o,o+500));if(error)return {persisted:0,warning:`Alert lookup failed: ${error.message}`};for(const row of data||[])if(row.dedupe_key)existing.add(`${userId}|${row.dedupe_key}`);}}
 const fresh=deduped.filter(x=>!existing.has(`${x.user_id}|${x.dedupe_key}`));if(!fresh.length)return {persisted:0,warning:null};
 const chunks=[];for(let i=0;i<fresh.length;i+=25)chunks.push(fresh.slice(i,i+25));
 const results=await Promise.all(chunks.map(async chunk=>{const r=await admin.from("portfolio_alerts").insert(chunk);if(!r.error)return {persisted:chunk.length};const one=await Promise.all(chunk.map(async alert=>{const q=await admin.from("portfolio_alerts").insert(alert);return q.error?{ok:false,error:q.error.message}:{ok:true};}));return {persisted:one.filter(x=>x.ok).length,warning:one.map(x=>x.error).find(Boolean)||null};}));
 return {persisted:results.reduce((a,x)=>a+(x.persisted||0),0),warning:results.map(x=>x.warning).find(Boolean)?`Some alerts could not be saved: ${results.map(x=>x.warning).find(Boolean)}`:null};
}

export async function GET(request){try{const auth=request.headers.get("authorization")||"";const token=auth.replace(/^Bearer\s+/i,"").trim();if(pipelineAuth(request)){const generated=await generateForAllUsers();const result=await persistAlerts(generated);return NextResponse.json({success:true,engine_version:ENGINE_VERSION,mode:"pipeline",generated:generated.length,persisted:result.persisted,warning:result.warning});}if(!token)return NextResponse.json({success:false,error:"Authentication required."},{status:401});const supabase=userClient(token);const {data:u,error:ue}=await supabase.auth.getUser(token);if(ue||!u?.user)return NextResponse.json({success:false,error:"Invalid session."},{status:401});const {data,error}=await supabase.from("portfolio_alerts").select("id,instrument_id,severity,type,title,message,is_read,created_at").eq("user_id",u.user.id).order("created_at",{ascending:false}).limit(100);if(error)throw new Error(error.message);const alerts=data||[];return NextResponse.json({success:true,engine_version:ENGINE_VERSION,generated_at:new Date().toISOString(),summary:{alert_count:alerts.length,critical:alerts.filter(x=>x.severity==="CRITICAL").length,warning:alerts.filter(x=>x.severity==="WARNING").length,info:alerts.filter(x=>x.severity==="INFO").length,unread:alerts.filter(x=>!x.is_read).length},alerts});}catch(error){console.error("Portfolio alerts error",error);return NextResponse.json({success:false,error:error?.message||"Portfolio alerts failed."},{status:500});}}

export async function PATCH(request){try{const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return NextResponse.json({success:false,error:"Authentication required."},{status:401});const supabase=userClient(token);const {data:u,error:ue}=await supabase.auth.getUser(token);if(ue||!u?.user)return NextResponse.json({success:false,error:"Invalid session."},{status:401});const body=await request.json();const id=String(body?.id||"");if(!id)return NextResponse.json({success:false,error:"Alert id is required."},{status:400});const {error}=await supabase.from("portfolio_alerts").update({is_read:true}).eq("id",id).eq("user_id",u.user.id);if(error)throw new Error(error.message);return NextResponse.json({success:true,updated:true,id});}catch(error){return NextResponse.json({success:false,error:error?.message||"Unable to update alert."},{status:500});}}
