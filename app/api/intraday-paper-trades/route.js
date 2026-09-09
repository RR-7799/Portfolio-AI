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

export async function GET(request) {
  const user = await auth(request);
  if (!user) return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });

  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const { data, error } = await db
      .from("intraday_signal_outcomes")
      .select("id,instrument_key,trading_symbol,company_name,direction,setup,setup_score,entry_price,stop_loss,target_1,target_2,risk_pct,signal_at,status,outcome,current_price,return_pct,realized_r,mae_pct,mfe_pct,duration_minutes,closed_at,last_checked_at,hit_stop_at,hit_target_1_at,hit_target_2_at")
      .eq("user_id", user.id)
      .order("signal_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    const rows = data || [];
    const open = rows.filter(r => r.status === "OPEN").length;
    const closed = rows.filter(r => r.status === "CLOSED");
    const wins = closed.filter(r => Number(r.realized_r) > 0).length;
    const netR = closed.reduce((sum, r) => sum + (Number.isFinite(Number(r.realized_r)) ? Number(r.realized_r) : 0), 0);

    return NextResponse.json({
      success: true,
      trades: rows,
      summary: {
        total: rows.length,
        open,
        closed: closed.length,
        wins,
        losses: closed.filter(r => Number(r.realized_r) < 0).length,
        net_r: Number(netR.toFixed(3)),
        win_rate: closed.length ? Number(((wins / closed.length) * 100).toFixed(1)) : null,
      },
    });
  } catch (error) {
    console.error("Intraday paper-trade history error:", error);
    return NextResponse.json({ success: false, error: error?.message || "Paper-trade history failed." }, { status: 500 });
  }
}
