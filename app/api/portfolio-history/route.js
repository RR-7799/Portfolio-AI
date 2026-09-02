import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "portfolio_history_v1_0";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export async function GET(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Authentication required." }, { status:401 });

    const userClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global:{ headers:{ Authorization:`Bearer ${token}` } } });
    const { data:userResult, error:userError } = await userClient.auth.getUser(token);
    if (userError || !userResult?.user) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Invalid session." }, { status:401 });

    const days = Math.min(3650, Math.max(7, Number(new URL(request.url).searchParams.get("days") || 365)));
    const since = new Date(Date.now() - days*86400000).toISOString();
    const { data, error } = await userClient.from("portfolio_snapshots").select("snapshot_at,total_value,invested_value,unrealized_pnl,pnl_pct,stock_value,mf_value,stock_count,mf_count,average_ai_score,health_score,high_risk_capital_pct,weak_score_capital_pct,bull_neutral_bear,portfolio_mode,summary").eq("user_id",userResult.user.id).gte("snapshot_at",since).order("snapshot_at",{ascending:true});
    if (error) throw new Error(error.message);

    const latest = data?.length ? data[data.length-1] : null;
    const first = data?.length ? data[0] : null;
    const valueChange = latest && first ? latest.total_value-first.total_value : null;
    const valueChangePct = first?.total_value ? valueChange/first.total_value*100 : null;

    return NextResponse.json({ success:true, engine_version:ENGINE_VERSION, user_id:userResult.user.id, period_days:days, count:data?.length||0, latest, period:{value_change:valueChange,value_change_pct:valueChangePct}, history:data||[] });
  } catch(error) { return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:error?.message||"Portfolio history failed." },{status:500}); }
}
