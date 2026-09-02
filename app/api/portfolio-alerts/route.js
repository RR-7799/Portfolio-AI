import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ENGINE_VERSION = "portfolio_alerts_v1_0";

function supabaseForToken(token) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function addAlert(list, item) {
  list.push({
    severity: item.severity || "INFO",
    type: item.type,
    title: item.title,
    message: item.message,
    instrument_id: item.instrument_id || null,
    created_at: new Date().toISOString(),
  });
}

export async function GET(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Authentication required." }, { status: 401 });

    const supabase = supabaseForToken(token);
    const { data: userResult, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userResult?.user) return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: "Invalid session." }, { status: 401 });
    const userId = userResult.user.id;

    const { data: holdings, error: hErr } = await supabase.from("holdings").select("instrument_id,current_value,invested_value,unrealized_pnl,pnl_percentage").eq("user_id", userId);
    if (hErr) throw new Error(`Holdings query failed: ${hErr.message}`);
    const ids = [...new Set((holdings || []).map(h => h.instrument_id).filter(Boolean))];
    if (!ids.length) return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, summary: { alert_count: 0, critical: 0, warning: 0, info: 0 }, alerts: [] });

    const [{ data: instruments, error: iErr }, { data: scores, error: sErr }] = await Promise.all([
      supabase.from("instruments").select("id,company_name,symbol,sector").in("id", ids),
      supabase.from("ai_scores").select("instrument_id,total_score,action,risk_level,rating,score_breakdown,updated_at").in("instrument_id", ids),
    ]);
    if (iErr) throw new Error(`Instruments query failed: ${iErr.message}`);
    if (sErr) throw new Error(`AI scores query failed: ${sErr.message}`);

    const im = new Map((instruments || []).map(x => [x.id, x]));
    const sm = new Map((scores || []).map(x => [x.instrument_id, x]));
    const totalValue = (holdings || []).reduce((sum, h) => sum + Number(h.current_value || 0), 0);
    const alerts = [];

    for (const h of holdings || []) {
      const inst = im.get(h.instrument_id) || {};
      const score = sm.get(h.instrument_id) || {};
      const b = score.score_breakdown || {};
      const freshness = b.freshness || {};
      const weight = totalValue > 0 ? Number(h.current_value || 0) / totalValue * 100 : 0;
      const pnlPct = Number(h.pnl_percentage || 0);

      if (weight >= 10) addAlert(alerts, { severity: weight >= 15 ? "CRITICAL" : "WARNING", type: "CONCENTRATION", title: `${inst.company_name || "Position"} is oversized`, message: `Portfolio weight is ${weight.toFixed(1)}%, above the 10% concentration guardrail.`, instrument_id: h.instrument_id });
      if (String(score.risk_level).toUpperCase() === "HIGH") addAlert(alerts, { severity: "WARNING", type: "HIGH_RISK", title: `${inst.company_name || "Holding"} is high risk`, message: `AI risk classification is HIGH with score ${score.total_score ?? "—"}.`, instrument_id: h.instrument_id });
      if (["MISSING", "VERY_STALE", "STALE"].includes(String(freshness.status || "").toUpperCase())) addAlert(alerts, { severity: "INFO", type: "STALE_DATA", title: `${inst.company_name || "Holding"} needs fresher data`, message: `Fundamental freshness is ${freshness.status || "MISSING"}; conviction is limited.`, instrument_id: h.instrument_id });
      if (String(score.action).toUpperCase() === "REDUCE") addAlert(alerts, { severity: pnlPct <= -20 ? "CRITICAL" : "WARNING", type: "REDUCE_SIGNAL", title: `Review ${inst.company_name || "holding"}`, message: `AI model is currently flagging REDUCE.`, instrument_id: h.instrument_id });
      if (String(score.action).toUpperCase() === "BUY" && Number(score.total_score || 0) >= 85) addAlert(alerts, { severity: "INFO", type: "BUY_SIGNAL", title: `${inst.company_name || "Holding"} is a strong candidate`, message: `AI score is ${Number(score.total_score).toFixed(1)} with a BUY action.`, instrument_id: h.instrument_id });
      if (pnlPct <= -15) addAlert(alerts, { severity: pnlPct <= -25 ? "CRITICAL" : "WARNING", type: "DRAWDOWN", title: `${inst.company_name || "Holding"} is in drawdown`, message: `Current unrealized loss is ${pnlPct.toFixed(1)}%.`, instrument_id: h.instrument_id });
    }

    const sectorMap = new Map();
    for (const h of holdings || []) {
      const sector = im.get(h.instrument_id)?.sector || "OTHER";
      sectorMap.set(sector, (sectorMap.get(sector) || 0) + Number(h.current_value || 0));
    }
    for (const [sector, value] of sectorMap) {
      const weight = totalValue > 0 ? value / totalValue * 100 : 0;
      if (weight >= 30) addAlert(alerts, { severity: weight >= 40 ? "CRITICAL" : "WARNING", type: "SECTOR_CONCENTRATION", title: `${sector} exposure is high`, message: `Sector exposure is ${weight.toFixed(1)}% of the portfolio.` });
    }

    const severityRank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
    const summary = {
      alert_count: alerts.length,
      critical: alerts.filter(a => a.severity === "CRITICAL").length,
      warning: alerts.filter(a => a.severity === "WARNING").length,
      info: alerts.filter(a => a.severity === "INFO").length,
    };

    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, generated_at: new Date().toISOString(), summary, alerts });
  } catch (error) {
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Portfolio alert generation failed." }, { status: 500 });
  }
}
