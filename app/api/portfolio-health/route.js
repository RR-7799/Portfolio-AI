import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "portfolio_health_v2_1";
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const money = v => n(v) || 0;
function add(a,severity,type,title,detail,instrument=null){a.push({severity,type,title,detail,instrument});}

export async function GET(request){
 try{
  const token=(request.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Authentication required."},{status:401});
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${token}`}}});
  const {data:user,error:userError}=await client.auth.getUser(token);
  if(userError||!user?.user)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Invalid session."},{status:401});
  const [h,i,s,f]=await Promise.all([
   client.from("holdings").select("instrument_id,current_value,invested_value,unrealized_pnl,pnl_percentage").eq("user_id",user.user.id),
   client.from("instruments").select("id,symbol,company_name,sector"),
   client.from("ai_scores").select("instrument_id,long_term_score,short_term_score,risk_score,valuation_score,final_ai_score,confidence,data_completeness,freshness_status,score_version,action,rating,risk_level,updated_at,score_breakdown").eq("user_id",user.user.id),
   client.from("fundamentals").select("instrument_id,financial_year,shareholding_date"),
  ]);
  for(const x of [h,i,s,f])if(x.error)throw x.error;
  const im=new Map((i.data||[]).map(x=>[x.id,x])),sm=new Map((s.data||[]).map(x=>[x.instrument_id,x])),fm=new Map((f.data||[]).map(x=>[x.instrument_id,x])),by=new Map();
  for(const r of h.data||[]){const p=by.get(r.instrument_id)||{current_value:0,invested_value:0,unrealized_pnl:0};p.current_value+=money(r.current_value);p.invested_value+=money(r.invested_value);p.unrealized_pnl+=money(r.unrealized_pnl);by.set(r.instrument_id,p);}
  const total=[...by.values()].reduce((a,x)=>a+x.current_value,0);
  const rows=[...by.entries()].map(([id,p])=>{const x=im.get(id)||{},sc=sm.get(id)||{},b=sc.score_breakdown||{},isV55=sc.score_version==="ai_scorer_v5_5";return{id,company_name:x.company_name||"Unknown",symbol:x.symbol||"—",sector:x.sector||"OTHER",current_value:p.current_value,invested_value:p.invested_value,pnl:p.unrealized_pnl,pnl_pct:p.invested_value?p.unrealized_pnl/p.invested_value*100:0,weight:total?p.current_value/total*100:0,long_term_score:isV55?n(sc.long_term_score):null,short_term_score:isV55?n(sc.short_term_score):null,risk_score:isV55?n(sc.risk_score):null,valuation_score:isV55?n(sc.valuation_score):null,final_ai_score:isV55?n(sc.final_ai_score):null,action:isV55?sc.action||"WATCH":"WATCH",risk:isV55?sc.risk_level||"UNKNOWN":"UNKNOWN",freshness:isV55?sc.freshness_status||"MISSING":"MISSING",confidence:isV55?n(sc.confidence):null,data_completeness:isV55?n(sc.data_completeness):null,score_version:sc.score_version||"legacy",financial_year:fm.get(id)?.financial_year||null};}).sort((a,b)=>b.weight-a.weight);
  const alerts=[],sectorMap=new Map();
  for(const r of rows){sectorMap.set(r.sector,(sectorMap.get(r.sector)||0)+r.weight);if(r.weight>=10)add(alerts,"HIGH","CONCENTRATION","Oversized position",`${r.company_name} is ${r.weight.toFixed(1)}% of the portfolio.`,r);else if(r.weight>=7)add(alerts,"MEDIUM","CONCENTRATION","Large position",`${r.company_name} is ${r.weight.toFixed(1)}% of the portfolio.`,r);if(r.risk==="HIGH"||r.risk==="VERY HIGH"||r.risk==="CRITICAL")add(alerts,r.weight>=5?"HIGH":"MEDIUM","RISK","Elevated model risk",`${r.company_name} has ${r.risk.toLowerCase()} independent risk score.`,r);if(["STALE","VERY_STALE","MISSING"].includes(r.freshness))add(alerts,"MEDIUM","DATA","Weak data freshness",`${r.company_name} has ${r.freshness.toLowerCase()} fundamental data.`,r);if(r.action==="REDUCE"&&(r.final_ai_score??0)<55)add(alerts,"HIGH","DECISION","Strong reduce signal",`${r.company_name} has a ${Number(r.final_ai_score).toFixed(1)} final score with REDUCE action.`,r);if(r.pnl_pct<=-20)add(alerts,"HIGH","DRAWDOWN","Large unrealized loss",`${r.company_name} is down ${Math.abs(r.pnl_pct).toFixed(1)}% on your position.`,r);}
  for(const [sector,w] of sectorMap){if(w>=25)add(alerts,"HIGH","SECTOR","Sector concentration",`${sector} represents ${w.toFixed(1)}% of the portfolio.`);else if(w>=20)add(alerts,"MEDIUM","SECTOR","Elevated sector exposure",`${sector} represents ${w.toFixed(1)}% of the portfolio.`);}
  const highRisk=rows.filter(r=>r.risk==="HIGH"||r.risk==="VERY HIGH"||r.risk==="CRITICAL").reduce((a,r)=>a+r.weight,0),weak=rows.filter(r=>(r.final_ai_score??0)<55).reduce((a,r)=>a+r.weight,0),valid=rows.filter(r=>r.final_ai_score!=null),avg=valid.length?valid.reduce((a,r)=>a+r.final_ai_score,0)/valid.length:null,health=Math.max(0,Math.min(100,(avg??50)-Math.max(0,highRisk-10)*0.7-Math.max(0,weak-15)*0.5-Math.max(0,(rows[0]?.weight||0)-10)*0.8));
  alerts.sort((a,b)=>({HIGH:0,MEDIUM:1,LOW:2}[a.severity]-({HIGH:0,MEDIUM:1,LOW:2}[b.severity]));
  const counts={HIGH:0,MEDIUM:0,LOW:0};for(const a of alerts)counts[a.severity]++;
  return NextResponse.json({success:true,engine_version:ENGINE_VERSION,fetched_at:new Date().toISOString(),summary:{health_score:Number(health.toFixed(1)),total_value:total,holdings:rows.length,average_ai_score:avg==null?null:Number(avg.toFixed(1)),score_definition:"final_ai_score",high_risk_capital_pct:Number(highRisk.toFixed(1)),weak_score_capital_pct:Number(weak.toFixed(1)),alert_counts:counts},sector_exposure:[...sectorMap.entries()].map(([sector,weight])=>({sector,weight:Number(weight.toFixed(2))})).sort((a,b)=>b.weight-a.weight),alerts,holdings:rows});
 }catch(error){return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Portfolio health failed."},{status:500});}
}
