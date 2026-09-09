import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

async function auth(request) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data, error } = await client.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const pct = (wins, total) => total ? (wins / total) * 100 : null;
const durationBucket = (minutes) => { if (!Number.isFinite(minutes) || minutes < 0) return null; if (minutes <= 10) return "0-10M"; if (minutes <= 20) return "11-20M"; if (minutes <= 30) return "21-30M"; if (minutes <= 60) return "31-60M"; return "60M+"; };
function istDayBounds(date = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  return { start: new Date(`${day}T00:00:00+05:30`).toISOString(), end: new Date(`${day}T23:59:59.999+05:30`).toISOString(), date: day };
}

export async function GET(request) {
  const user = await auth(request);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { start, end, date } = istDayBounds();
    const { data, error } = await db.from("intraday_signal_outcomes")
      .select("direction,setup,setup_score,outcome,realized_r,mae_pct,mfe_pct,signal_at,closed_at,status,horizon_10m_directional,horizon_20m_directional,horizon_30m_directional")
      .eq("user_id", user.id).gte("signal_at", start).lte("signal_at", end).order("signal_at", { ascending: false }).limit(5000);
    if (error) throw error;
    const rows = data || [];
    const closed = rows.filter(r => r.status === "CLOSED" && Number.isFinite(Number(r.realized_r)));
    const wins = closed.filter(r => Number(r.realized_r) > 0);
    const losses = closed.filter(r => Number(r.realized_r) < 0);
    const grossProfit = wins.reduce((s, r) => s + Number(r.realized_r), 0);
    const grossLoss = Math.abs(losses.reduce((s, r) => s + Number(r.realized_r), 0));
    const byDirection = ["LONG","SHORT"].map(direction => { const x = closed.filter(r => r.direction === direction); return { direction, trades:x.length, win_rate:pct(x.filter(r=>Number(r.realized_r)>0).length,x.length), avg_r:avg(x.map(r=>Number(r.realized_r))) }; });
    const setups = [...new Set(closed.map(r=>r.setup))].map(setup => { const x=closed.filter(r=>r.setup===setup); return { setup,trades:x.length,win_rate:pct(x.filter(r=>Number(r.realized_r)>0).length,x.length),avg_r:avg(x.map(r=>Number(r.realized_r))) }; }).sort((a,b)=>b.avg_r-a.avg_r);
    const scoreBuckets = [[75,80],[80,90],[90,101]].map(([min,max])=>{const x=closed.filter(r=>Number(r.setup_score)>=min&&Number(r.setup_score)<max);return{bucket:`${min}-${max===101?100:max}`,trades:x.length,win_rate:pct(x.filter(r=>Number(r.realized_r)>0).length,x.length),avg_r:avg(x.map(r=>Number(r.realized_r)))};});
    const horizons=[10,20,30].map(minutes=>{const key=`horizon_${minutes}m_directional`;const x=rows.filter(r=>typeof r[key]==="boolean");const correct=x.filter(r=>r[key]).length;return{minutes,samples:x.length,accuracy:x.length?Number(((correct/x.length)*100).toFixed(1)):null};});
    const durationRows=closed.map(r=>({...r,minutes:(new Date(r.closed_at).getTime()-new Date(r.signal_at).getTime())/60000})).filter(r=>Number.isFinite(r.minutes)&&r.minutes>=0);
    const durationBuckets=["0-10M","11-20M","21-30M","31-60M","60M+"].map(bucket=>{const x=durationRows.filter(r=>durationBucket(r.minutes)===bucket);return{bucket,trades:x.length,win_rate:x.length?Number(((x.filter(r=>Number(r.realized_r)>0).length/x.length)*100).toFixed(1)):null,avg_r:x.length?Number(avg(x.map(r=>Number(r.realized_r))).toFixed(2)):null};});
    const bestHorizon=horizons.filter(h=>h.accuracy!=null&&h.samples>=5).sort((a,b)=>b.accuracy-a.accuracy)[0]||null;
    return NextResponse.json({success:true,calculation_scope:"CURRENT_TRADING_DAY",trading_date_ist:date,sample_size:rows.length,closed_trades:closed.length,open_trades:rows.filter(r=>r.status==="OPEN").length,win_rate:pct(wins.length,closed.length),avg_r:avg(closed.map(r=>Number(r.realized_r))),profit_factor:grossLoss?grossProfit/grossLoss:grossProfit>0?null:0,avg_mae_pct:avg(closed.map(r=>Number(r.mae_pct)).filter(Number.isFinite)),avg_mfe_pct:avg(closed.map(r=>Number(r.mfe_pct)).filter(Number.isFinite)),average_duration_minutes:durationRows.length?Number(avg(durationRows.map(r=>r.minutes)).toFixed(1)):null,horizons,best_horizon:bestHorizon,duration_buckets:durationBuckets,outcomes:Object.fromEntries(["TARGET_1","TARGET_2","STOP_LOSS","EXPIRED"].map(o=>[o,closed.filter(r=>r.outcome===o).length])),by_direction:byDirection,setups,score_buckets:scoreBuckets,latest_signal_at:rows[0]?.signal_at||null,latest_closed_at:closed[0]?.closed_at||null});
  } catch(error) { console.error("Intraday analytics error:",error); return NextResponse.json({success:false,error:error?.message||"Analytics failed."},{status:500}); }
}
