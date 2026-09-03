import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "portfolio_alerts_v1_3";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function userClient(token){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});}
function pipelineAuth(request){const secret=process.env.PIPELINE_SECRET; if(!secret)return false; const h=request.headers.get("x-pipeline-secret")||""; const a=request.headers.get("authorization")||""; return h===secret||a===`Bearer ${secret}`;}
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};

async function generateForAllUsers(){
 const [h,i,s,m]=await Promise.all([
  admin.from("holdings").select("user_id,instrument_id,current_value,invested_value,unrealized_pnl,pnl_percentage"),
  admin.from("instruments").select("id,company_name,symbol,sector"),
  admin.from("ai_scores").select("instrument_id,total_score,action,risk_level,rating,score_breakdown,updated_at,calculated_at").order("calculated_at",{ascending:false}),
  admin.from("market_regime_history").select("regime,score,confidence,portfolio_mode,snapshot_at").order("snapshot_at",{ascending:false}).limit(2)
 ]);
 for(const x of [h,i,s,m])if(x.error)throw new Error(x.error.message);
 const im=new Map((i.data||[]).map(x=>[x.id,x]));
 const scoreHistory=new Map();
 for(const row of (s.data||[])){
  const list=scoreHistory.get(row.instrument_id)||[];
  if(list.length<2)list.push(row);
  scoreHistory.set(row.instrument_id,list);
 }
 const sm=new Map([...scoreHistory].map(([id,list])=>[id,list[0]]));
 const users=[...new Set((h.data||[]).map(x=>x.user_id).filter(Boolean))]; const regime=m.data?.[0]||null; const previous=m.data?.[1]||null; const alerts=[];
 for(const userId of users){
  const holdings=(h.data||[]).filter(x=>x.user_id===userId); const total=holdings.reduce((a,x)=>a+n(x.current_value),0); const sectorMap=new Map();
  for(const x of holdings){const meta=im.get(x.instrument_id)||{};const sc=sm.get(x.instrument_id)||{};const history=scoreHistory.get(x.instrument_id)||[];const prior=history[1]||null;const b=sc.score_breakdown||{};const freshness=b.freshness||{};const weight=total>0?n(x.current_value)/total*100:0;const pnl=n(x.pnl_percentage);
   if(weight>=10)alerts.push({user_id:userId,instrument_id:x.instrument_id,severity:weight>=15?"CRITICAL":"WARNING",type:"CONCENTRATION",title:`${meta.company_name||meta.symbol||"Position"} is oversized`,message:`Portfolio weight is ${weight.toFixed(1)}%, above the 10% concentration guardrail.`,dedupe_key:`CONCENTRATION:${x.instrument_id}:${Math.floor(weight)}`});
   if(String(sc.risk_level||"").toUpperCase()==="HIGH")alerts.push({user_id:userId,instrument_id:x.instrument_id,severity:"WARNING",type:"HIGH_RISK",title:`${meta.company_name||meta.symbol||"Holding"} is high risk`,message:`AI risk classification is HIGH with score ${sc.total_score??"—"}.`,dedupe_key:`HIGH_RISK:${x.instrument_id}`});
   if(["MISSING","VERY_STALE","STALE"].includes(String(freshness.status||"").toUpperCase()))alerts.push({user_id:userId,instrument_id:x.instrument_id,severity:"INFO",type:"STALE_DATA",title:`${meta.company_name||meta.symbol||"Holding"} needs fresher data`,message:`Fundamental freshness is ${freshness.status||"MISSING"}; conviction is limited.`,dedupe_key:`STALE_DATA:${x.instrument_id}:${freshness.status||"MISSING"}`});
   if(String(sc.action||"").toUpperCase()==="REDUCE")alerts.push({user_id:userId,instrument_id:x.instrument_id,severity:pnl<=-20?"CRITICAL":"WARNING",type:"REDUCE_SIGNAL",title:`Review ${meta.company_name||meta.symbol||"holding"}`,message:`AI model is currently flagging REDUCE.`,dedupe_key:`REDUCE_SIGNAL:${x.instrument_id}:${Math.floor(n(sc.total_score)/5)}`});
   if(String(sc.action||"").toUpperCase()==="BUY"&&n(sc.total_score)>=85)alerts.push({user_id:userId,instrument_id:x.instrument_id,severity:"INFO",type:"BUY_SIGNAL",title:`${meta.company_name||meta.symbol||"Holding"} is a strong candidate`,message:`AI score is ${n(sc.total_score).toFixed(1)} with a BUY action.`,dedupe_key:`BUY_SIGNAL:${x.instrument_id}:${Math.floor(n(sc.total_score))}`});
   if(pnl<=-15)alerts.push({user_id:userId,instrument_id:x.instrument_id,severity:pnl<=-25?"CRITICAL":"WARNING",type:"DRAWDOWN",title:`${meta.company_name||meta.symbol||"Holding"} is in drawdown`,message:`Current unrealized loss is ${pnl.toFixed(1)}%.`,dedupe_key:`DRAWDOWN:${x.instrument_id}:${Math.floor(pnl/5)}`});
   if(prior){
    const currentScore=n(sc.total_score); const priorScore=n(prior.total_score); const delta=currentScore-priorScore; const name=meta.company_name||meta.symbol||"Holding";
    if(Math.abs(delta)>=5){const improving=delta>0; const magnitude=Math.abs(delta); alerts.push({user_id:userId,instrument_id:x.instrument_id,severity:improving?"INFO":magnitude>=10?"CRITICAL":"WARNING",type:improving?"SCORE_IMPROVEMENT":"SCORE_DROP",title:`${name} AI score ${improving?"improved":"fell"}`,message:`AI score changed from ${priorScore.toFixed(1)} to ${currentScore.toFixed(1)} (${delta>0?"+":""}${delta.toFixed(1)}) since the previous scan.`,dedupe_key:`SCORE_CHANGE:${x.instrument_id}:${priorScore.toFixed(1)}:${currentScore.toFixed(1)}`});
    }
    const priorRisk=String(prior.risk_level||"").toUpperCase(); const currentRisk=String(sc.risk_level||"").toUpperCase();
    if(priorRisk&&currentRisk&&priorRisk!==currentRisk){const worsened=["HIGH","CRITICAL"].includes(currentRisk)&&!["HIGH","CRITICAL"].includes(priorRisk);alerts.push({user_id:userId,instrument_id:x.instrument_id,severity:worsened?"CRITICAL":"WARNING",type:"RISK_CHANGE",title:`${name} risk changed ${priorRisk} → ${currentRisk}`,message:`AI risk classification moved from ${priorRisk} to ${currentRisk} since the previous scan.`,dedupe_key:`RISK_CHANGE:${x.instrument_id}:${priorRisk}:${currentRisk}`});}
    const priorAction=String(prior.action||"").toUpperCase(); const currentAction=String(sc.action||"").toUpperCase();
    if(priorAction&&currentAction&&priorAction!==currentAction&&!["REDUCE_SIGNAL","BUY_SIGNAL"].includes(currentAction)){alerts.push({user_id:userId,instrument_id:x.instrument_id,severity:currentAction==="REDUCE"?"WARNING":"INFO",type:"ACTION_CHANGE",title:`${name} action changed ${priorAction} → ${currentAction}`,message:`AI action moved from ${priorAction} to ${currentAction} since the previous scan.`,dedupe_key:`ACTION_CHANGE:${x.instrument_id}:${priorAction}:${currentAction}`});}
   }
   const sector=meta.sector||"OTHER"; sectorMap.set(sector,(sectorMap.get(sector)||0)+n(x.current_value));
  }
  for(const [sector,value] of sectorMap){const weight=total>0?value/total*100:0;if(weight>=30)alerts.push({user_id:userId,instrument_id:null,severity:weight>=40?"CRITICAL":"WARNING",type:"SECTOR_CONCENTRATION",title:`${sector} exposure is high`,message:`Sector exposure is ${weight.toFixed(1)}% of the portfolio.`,dedupe_key:`SECTOR_CONCENTRATION:${sector}:${Math.floor(weight)}`});}
  if(regime&&previous&&regime.regime!==previous.regime)alerts.push({user_id:userId,instrument_id:null,severity:regime.regime==="BEAR"?"CRITICAL":"WARNING",type:"REGIME_CHANGE",title:`Market regime changed to ${regime.regime}`,message:`Market regime moved from ${previous.regime} to ${regime.regime} with score ${n(regime.score).toFixed(0)}/100.`,dedupe_key:`REGIME_CHANGE:${regime.snapshot_at}:${regime.regime}`});
 }
 return alerts;
}

async function persistAlerts(generated){
 if(!generated.length)return 0;
 const deduped=[...new Map(generated.map(x=>[`${x.user_id}|${x.dedupe_key}`,x])).values()];
 const users=[...new Set(deduped.map(x=>x.user_id))];
 const existingKeys=new Set();
 for(const userId of users){
  const keys=deduped.filter(x=>x.user_id===userId).map(x=>x.dedupe_key).filter(Boolean);
  for(let offset=0;offset<keys.length;offset+=500){
   const chunk=keys.slice(offset,offset+500);
   const {data,error}=await admin.from("portfolio_alerts").select("dedupe_key").eq("user_id",userId).in("dedupe_key",chunk);
   if(error)throw new Error(error.message);
   for(const row of data||[])if(row.dedupe_key)existingKeys.add(`${userId}|${row.dedupe_key}`);
  }
 }
 const fresh=deduped.filter(x=>!existingKeys.has(`${x.user_id}|${x.dedupe_key}`));
 if(!fresh.length)return 0;
 const {error}=await admin.from("portfolio_alerts").insert(fresh);
 if(error)throw new Error(error.message);
 return fresh.length;
}

export async function GET(request){
 try{
  const auth=request.headers.get("authorization")||""; const token=auth.replace(/^Bearer\s+/i,"").trim();
  if(pipelineAuth(request)){
   const generated=await generateForAllUsers();
   const persisted=await persistAlerts(generated);
   return NextResponse.json({success:true,engine_version:ENGINE_VERSION,mode:"pipeline",generated:generated.length,persisted});
  }
  if(!token)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Authentication required."},{status:401});
  const supabase=userClient(token); const {data:userResult,error:userError}=await supabase.auth.getUser(token);
  if(userError||!userResult?.user)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Invalid session."},{status:401});
  const {data,error}=await supabase.from("portfolio_alerts").select("id,instrument_id,severity,type,title,message,is_read,created_at").eq("user_id",userResult.user.id).order("created_at",{ascending:false}).limit(100);
  if(error)throw new Error(error.message);
  const alerts=data||[]; return NextResponse.json({success:true,engine_version:ENGINE_VERSION,generated_at:new Date().toISOString(),summary:{alert_count:alerts.length,critical:alerts.filter(x=>x.severity==="CRITICAL").length,warning:alerts.filter(x=>x.severity==="WARNING").length,info:alerts.filter(x=>x.severity==="INFO").length,unread:alerts.filter(x=>!x.is_read).length},alerts});
 }catch(error){console.error("Portfolio alerts error",error);return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Portfolio alerts failed."},{status:500});}
}

export async function PATCH(request){
 try{const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return NextResponse.json({success:false,error:"Authentication required."},{status:401});const supabase=userClient(token);const {data:u,error:ue}=await supabase.auth.getUser(token);if(ue||!u?.user)return NextResponse.json({success:false,error:"Invalid session."},{status:401});const body=await request.json();const id=String(body?.id||"");if(!id)return NextResponse.json({success:false,error:"Alert id is required."},{status:400});const {error}=await supabase.from("portfolio_alerts").update({is_read:true}).eq("id",id).eq("user_id",u.user.id);if(error)throw new Error(error.message);return NextResponse.json({success:true,updated:true,id});}catch(error){return NextResponse.json({success:false,error:error?.message||"Unable to update alert."},{status:500});}
}
