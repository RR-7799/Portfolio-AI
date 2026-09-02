import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ENGINE_VERSION = "rebalance_v1_0";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const n = (x) => { const v = Number(x); return Number.isFinite(v) ? v : null; };

function targetWeight({ score, risk, currentWeight }) {
  const s = n(score) ?? 0;
  const r = String(risk || "UNKNOWN").toUpperCase();
  let base = s >= 82 ? 8 : s >= 72 ? 6 : s >= 60 ? 4 : s >= 50 ? 2 : 0;
  if (r === "HIGH") base *= 0.55;
  else if (r === "MODERATE") base *= 0.85;
  if ((currentWeight ?? 0) > 12) base = Math.min(base, 8);
  return Number(clamp(base, 0, 10).toFixed(2));
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const cash = n(searchParams.get("cash")) ?? 0;
    if (!userId) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"user_id is required." }, { status:400 });

    const { data: holdings, error: hErr } = await supabase.from("holdings").select("instrument_id,current_value,invested_value,quantity").eq("user_id", userId);
    if (hErr) throw new Error(hErr.message);
    const ids = [...new Set((holdings||[]).map(x=>x.instrument_id).filter(Boolean))];
    if (!ids.length) return NextResponse.json({ success:true, engine_version:ENGINE_VERSION, portfolio:{current_value:cash}, rows:[], actions:[], warnings:["No stock holdings found."] });

    const [{data: instruments,error:iErr},{data:scores,error:sErr}] = await Promise.all([
      supabase.from("instruments").select("id,symbol,company_name,sector").in("id",ids),
      supabase.from("ai_scores").select("instrument_id,total_score,action,risk_level,rating,score_breakdown").in("instrument_id",ids)
    ]);
    if(iErr) throw new Error(iErr.message); if(sErr) throw new Error(sErr.message);

    const im=new Map((instruments||[]).map(x=>[x.id,x]));
    const sm=new Map((scores||[]).map(x=>[x.instrument_id,x]));
    const byId=new Map();
    for(const h of holdings||[]){ const p=byId.get(h.instrument_id)||{current_value:0,invested_value:0,quantity:0}; p.current_value+=Number(h.current_value||0); p.invested_value+=Number(h.invested_value||0); p.quantity+=Number(h.quantity||0); byId.set(h.instrument_id,p); }
    const stockValue=[...byId.values()].reduce((a,b)=>a+b.current_value,0);
    const totalValue=stockValue+cash;
    const rows=ids.map(id=>{ const inst=im.get(id)||{}; const score=sm.get(id)||{}; const pos=byId.get(id)||{}; const currentWeight=totalValue?pos.current_value/totalValue*100:0; const target=targetWeight({score:score.total_score,risk:score.risk_level,currentWeight}); return {id,company_name:inst.company_name||"Unknown",symbol:inst.symbol||"—",sector:inst.sector||"OTHER",current_value:pos.current_value||0,current_weight:Number(currentWeight.toFixed(2)),score:score.total_score??null,risk:score.risk_level||"—",action:score.action||"WATCH",target_weight:target,difference:Number((target-currentWeight).toFixed(2))}; }).sort((a,b)=>b.difference-a.difference);
    const deployable=Math.max(totalValue,0);
    const actions=[];
    for(const r of rows){
      const delta=deployable*(r.difference/100);
      let action="HOLD";
      if(r.target_weight===0 && r.current_weight>0.5) action="TRIM/EXIT";
      else if(r.difference>1.5) action="ADD";
      else if(r.difference<-2) action="TRIM";
      actions.push({...r,action_plan:action,estimated_rupees:Number(Math.abs(delta).toFixed(0))});
    }
    const warnings=[];
    const top=rows.slice().sort((a,b)=>b.current_weight-a.current_weight).slice(0,5).reduce((s,r)=>s+r.current_weight,0);
    if(top>55) warnings.push(`Top 5 holdings represent ${top.toFixed(1)}% of portfolio.`);
    const high=rows.filter(r=>r.risk==="HIGH").reduce((s,r)=>s+r.current_weight,0);
    if(high>20) warnings.push(`HIGH-risk holdings represent ${high.toFixed(1)}% of portfolio.`);
    return NextResponse.json({success:true,engine_version:ENGINE_VERSION,portfolio:{stock_value:stockValue,cash,total_value:totalValue},rows:actions,warnings});
  } catch(error){ return NextResponse.json({success:false,engine_version:ENGINE_VERSION,error:error?.message||"Rebalance failed."},{status:500}); }
}
