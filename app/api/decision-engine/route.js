import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "decision_engine_v2_2";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
function userClient(token) { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } }); }
function avg(values, fallback = null) { const valid = values.map(n).filter(v => v !== null); return valid.length ? valid.reduce((a,b)=>a+b,0)/valid.length : fallback; }
function clamp(v,min=0,max=100){return Math.max(min,Math.min(max,v));}

// ai_scores stores component scores using the scoring engine's native point ranges:
// growth 0-20, profitability 0-20, debt 0-10, ownership 0-10,
// cashflow 0-10, valuation 0-15, risk/quality 0-15.
// The decision engine works on a common 0-100 scale, so normalize before comparing.
function pct(value, max) {
  const v = n(value);
  return v === null ? null : clamp((v / max) * 100);
}

function decisionV2(input){
  const {score,risk,weight,pnl,freshness,regime,modelAction,growth,profitability,debt,ownership,cashflow,valuation,riskScore}=input;
  const s=n(score) ?? 0, r=String(risk||"").toUpperCase(), f=String(freshness||"").toUpperCase(), m=String(regime||"").toUpperCase();

  const growthP=pct(growth,20);
  const profitP=pct(profitability,20);
  const debtP=pct(debt,10);
  const ownershipP=pct(ownership,10);
  const cashP=pct(cashflow,10);
  const valuationP=pct(valuation,15);
  const riskP=pct(riskScore,15);

  const thesis=clamp(avg([growthP,profitP,debtP,cashP],s));
  const quality=clamp(avg([profitP,debtP,cashP,ownershipP],s));
  const opportunity=clamp(avg([s,growthP,valuationP,riskP],s));

  const valuationWeak=valuationP!==null && valuationP<35;
  const strongThesis=thesis>=68 && quality>=60;
  const brokenThesis=thesis<42 && quality<48;
  const criticalRisk=r==="CRITICAL" || (riskP!==null && riskP<30);
  const highRisk=r==="HIGH" || (riskP!==null && riskP<50);
  const stale=f==="MISSING"||f==="VERY_STALE";
  const overweight=weight>=15;
  const severeDrawdown=pnl<=-25;
  const weakMomentum=String(modelAction||"").toUpperCase()==="REDUCE";
  let action,reason,confidence;

  // EXIT is deliberately high-bar: weak score alone can never force an exit.
  if (brokenThesis && criticalRisk) { action="EXIT"; reason="Investment thesis is materially weak and risk is critical"; confidence=94; }
  else if (criticalRisk && !strongThesis && s<50) { action="EXIT"; reason="Multiple independent risk signals indicate thesis impairment"; confidence=91; }
  else if (overweight && (valuationWeak || highRisk || s<60)) { action="REDUCE"; reason="Position is oversized relative to its current risk/reward"; confidence=88; }
  else if (highRisk && severeDrawdown && !strongThesis) { action="REDUCE"; reason="High risk and severe drawdown are not supported by the current thesis"; confidence=86; }
  else if (strongThesis && valuationP!==null && valuationP>=65 && riskP!==null && riskP>=55 && s>=65 && !stale && m!=="BEAR") { action="ACCUMULATE"; reason="Strong business thesis with attractive valuation and manageable risk"; confidence=87; }
  else if (s>=82 && quality>=65 && r!=="HIGH" && r!=="CRITICAL" && !stale && !valuationWeak && m!=="BEAR" && weight<12) { action="BUY"; reason="Strong overall score, quality and opportunity with acceptable portfolio weight"; confidence=90; }
  else if (strongThesis && (s>=52 || weakMomentum) && !brokenThesis) { action="HOLD"; reason=weakMomentum ? "Long-term thesis remains intact despite a weaker current model signal" : "Investment thesis remains intact; current conditions do not justify aggressive action"; confidence=82; }
  else if (stale) { action="WATCH"; reason="Conviction is limited because fundamental data is too stale"; confidence=78; }
  else if (m==="BEAR" && s<72) { action="HOLD"; reason="Thesis is not broken, but the market regime argues against aggressive adding"; confidence=76; }
  else { action="WATCH"; reason="Mixed fundamentals, valuation, risk and opportunity signals need confirmation"; confidence=70; }

  if(action==="HOLD" && overweight && (valuationWeak || highRisk)) { action="REDUCE"; reason="Investment thesis is intact, but portfolio concentration/risk warrants trimming"; confidence=84; }
  if(action==="ACCUMULATE" && overweight) { action="HOLD"; reason="Strong thesis, but position is already large enough to avoid adding concentration"; confidence=85; }

  const regimeAdjustment=m==="BEAR"&&["BUY","ACCUMULATE"].includes(action)?-8:m==="BULL"&&["HOLD","WATCH"].includes(action)?3:0;
  confidence=clamp(confidence+regimeAdjustment,55,97);
  return [action,reason,Math.round(confidence),{
    thesis_score:Math.round(thesis*10)/10,
    quality_score:Math.round(quality*10)/10,
    opportunity_score:Math.round(opportunity*10)/10,
    normalized_components:{
      growth: growthP===null?null:Math.round(growthP*10)/10,
      profitability: profitP===null?null:Math.round(profitP*10)/10,
      debt: debtP===null?null:Math.round(debtP*10)/10,
      ownership: ownershipP===null?null:Math.round(ownershipP*10)/10,
      cashflow: cashP===null?null:Math.round(cashP*10)/10,
      valuation: valuationP===null?null:Math.round(valuationP*10)/10,
      risk: riskP===null?null:Math.round(riskP*10)/10,
    },
    signals:{strong_thesis:strongThesis,broken_thesis:brokenThesis,critical_risk:criticalRisk,high_risk:highRisk,overweight,severe_drawdown:severeDrawdown,valuation_weak:valuationWeak,stale_data:stale}
  }];
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
  const results=(h.data||[]).map(holding=>{
    const meta=im.get(holding.instrument_id)||{},score=sm.get(holding.instrument_id)||{},freshness=score.score_breakdown?.freshness?.status||"MISSING";
    const weight=total>0?(n(holding.current_value)||0)/total*100:0,pnl=holding.pnl_percentage??((n(holding.invested_value)||0)>0?(n(holding.unrealized_pnl)||0)/(n(holding.invested_value)||1)*100:0);
    const [action,reason,confidence,diagnostics]=decisionV2({score:score.total_score,risk:score.risk_level,weight,pnl,freshness,regime,modelAction:score.action,growth:score.growth_score,profitability:score.profitability_score,debt:score.debt_score,ownership:score.ownership_score,cashflow:score.cashflow_score,valuation:score.valuation_score,riskScore:score.risk_score});
    return {instrument_id:holding.instrument_id,company_name:meta.company_name||meta.symbol||"Holding",symbol:meta.symbol||null,sector:meta.sector||null,portfolio_weight_pct:Number(weight.toFixed(2)),pnl_pct:Number((n(pnl)||0).toFixed(2)),ai_score:score.total_score??null,risk_level:score.risk_level||null,rating:score.rating||null,model_action:score.action||null,freshness_status:freshness,growth_score:score.growth_score??null,profitability_score:score.profitability_score??null,debt_score:score.debt_score??null,ownership_score:score.ownership_score??null,cashflow_score:score.cashflow_score??null,valuation_score:score.valuation_score??null,risk_score:score.risk_score??null,decision:action,confidence,reason,market_regime:regime,...diagnostics};
  });
  const rank={EXIT:0,REDUCE:1,"HOLD & TRIM":2,WATCH:3,HOLD:4,ACCUMULATE:5,BUY:6};results.sort((a,b)=>rank[a.decision]-rank[b.decision]||(b.confidence-a.confidence));
  return{user_id:userId,market_regime:regime,portfolio_value:total,decisions:results};
}

export async function GET(request){
  try{
    const auth=request.headers.get("authorization")||"",token=auth.replace(/^Bearer\s+/i,"").trim();
    if(!token)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Authentication required."},{status:401});
    const client=userClient(token),{data:userResult,error:userError}=await client.auth.getUser(token);
    if(userError||!userResult?.user)return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:"Invalid session."},{status:401});
    const portfolio=await buildForUser(client,userResult.user.id);
    const counts={};for(const x of portfolio.decisions)counts[x.decision]=(counts[x.decision]||0)+1;
    return NextResponse.json({success:true,engine_version:ENGINE_VERSION,generated_at:new Date().toISOString(),...portfolio,decision_counts:counts});
  }catch(error){
    console.error("Decision engine V2 error:",error);
    return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Decision engine failed."},{status:500});
  }
}
