import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "copilot_v1_0";
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function money(v) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(v || 0));
}

function pct(v) {
  return `${Number(v || 0).toFixed(1)}%`;
}

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

async function loadContext(userId) {
  const [h, i, s, m, f] = await Promise.all([
    supabase.from("holdings").select("instrument_id,current_value,invested_value,unrealized_pnl,pnl_percentage").eq("user_id", userId),
    supabase.from("instruments").select("id,symbol,company_name,sector"),
    supabase.from("ai_scores").select("instrument_id,total_score,action,risk_level,rating,score_breakdown,updated_at"),
    supabase.from("mf_holdings").select("current_value,invested_value,unrealized_pnl,pnl_percentage").eq("user_id", userId),
    supabase.from("fundamentals").select("instrument_id,financial_year,shareholding_date"),
  ]);
  for (const x of [h, i, s, m, f]) if (x.error) throw new Error(x.error.message);

  const instruments = new Map((i.data || []).map(x => [x.id, x]));
  const scores = new Map((s.data || []).map(x => [x.instrument_id, x]));
  const fundamentals = new Map((f.data || []).map(x => [x.instrument_id, x]));
  const byId = new Map();
  for (const row of h.data || []) {
    const p = byId.get(row.instrument_id) || { current_value: 0, invested_value: 0, unrealized_pnl: 0 };
    p.current_value += Number(row.current_value || 0);
    p.invested_value += Number(row.invested_value || 0);
    p.unrealized_pnl += Number(row.unrealized_pnl || 0);
    byId.set(row.instrument_id, p);
  }
  const stockValue = [...byId.values()].reduce((a, x) => a + x.current_value, 0);
  const stockInvested = [...byId.values()].reduce((a, x) => a + x.invested_value, 0);
  const mfValue = (m.data || []).reduce((a, x) => a + Number(x.current_value || 0), 0);
  const mfInvested = (m.data || []).reduce((a, x) => a + Number(x.invested_value || 0), 0);
  const total = stockValue + mfValue;

  const rows = [...byId.entries()].map(([id, p]) => {
    const inst = instruments.get(id) || {};
    const score = scores.get(id) || {};
    const b = score.score_breakdown || {};
    const weight = total ? (p.current_value / stockValue) * 100 : 0;
    return {
      id,
      company_name: inst.company_name || "Unknown Stock",
      symbol: inst.symbol || "—",
      sector: inst.sector || "OTHER",
      current_value: p.current_value,
      invested_value: p.invested_value,
      pnl: p.unrealized_pnl,
      pnl_pct: p.invested_value ? (p.unrealized_pnl / p.invested_value) * 100 : 0,
      weight: Number(weight.toFixed(2)),
      score: score.total_score == null ? null : Number(score.total_score),
      action: score.action || "WATCH",
      risk: score.risk_level || "UNKNOWN",
      rating: score.rating || "—",
      confidence: b.confidence ?? b.freshness?.effective_confidence ?? null,
      freshness: b.freshness?.status || "MISSING",
      financial_year: fundamentals.get(id)?.financial_year || null,
    };
  });

  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return {
    total,
    stockValue,
    stockInvested,
    mfValue,
    mfInvested,
    pnl: total - stockInvested - mfInvested,
    rows,
  };
}

async function getJson(url, headers = {}) {
  const response = await fetch(url, { cache: "no-store", headers });
  let body = null;
  try { body = await response.json(); } catch { body = {}; }
  return { ok: response.ok, body };
}

function findStock(rows, text) {
  const q = norm(text);
  if (!q) return null;
  return rows.find(r => norm(r.company_name) === q || norm(r.symbol) === q)
    || rows.find(r => norm(r.company_name).includes(q) || q.includes(norm(r.company_name)))
    || rows.find(r => norm(r.symbol).includes(q));
}

function answer(question, ctx, regime) {
  const q = norm(question);
  const rows = ctx.rows;
  const top = rows.slice(0, 5);
  const weak = rows.filter(r => r.score !== null && r.score < 55).sort((a,b)=>(a.score ?? 0)-(b.score ?? 0)).slice(0,5);
  const reduce = rows.filter(r => ["REDUCE","EXIT"].includes(String(r.action).toUpperCase()) || (r.score !== null && r.score < 50)).slice(0,5);
  const highRisk = rows.filter(r => r.risk === "HIGH").sort((a,b)=>b.weight-a.weight).slice(0,5);

  if (/what should i do|today|portfolio today|market today|overall/.test(q)) {
    const lines = [
      `Portfolio value is ${money(ctx.total)} with stock exposure of ${money(ctx.stockValue)} and mutual funds of ${money(ctx.mfValue)}.`,
      `Current market regime: ${regime.label} (${Number(regime.score ?? 0).toFixed(0)}/100, confidence ${regime.confidence ?? "—"}%).`,
      top.length ? `Highest model scores: ${top.map(r => `${r.company_name} ${r.score ?? "—"}`).join(", ")}.` : "No scored stock positions are available.",
      reduce.length ? `Review first: ${reduce.map(r => `${r.company_name} (${r.action}, ${r.score ?? "—"})`).join(", ")}.` : "No immediate low-score reduction candidates were detected."
    ];
    return lines.join(" ");
  }

  if (/exit|sell|reduce/.test(q)) {
    if (!reduce.length) return "I don't see a strong REDUCE/EXIT cluster from the current model. That does not mean every holding should be kept; it means the current rules are not flagging a high-priority exit. Data quality and market regime still matter.";
    return `Priority review list: ${reduce.map(r => `${r.company_name} — ${r.action}, score ${r.score ?? "—"}, weight ${pct(r.weight)}, risk ${r.risk}`).join("; ")}.`;
  }

  if (/buy|invest|deploy|add|₹|rs|rupee|capital/.test(q)) {
    const investable = rows.filter(r => r.score !== null && r.score >= (regime.label === "BEAR" ? 85 : regime.label === "NEUTRAL" ? 78 : 70) && r.risk !== "HIGH").slice(0,5);
    if (!investable.length) return `I would not force a fresh purchase right now under the ${regime.label} regime. Preserve capital and wait for a cleaner setup or better data quality.`;
    return `Best current candidates: ${investable.map(r => `${r.company_name} (score ${r.score}, ${r.action}, weight ${pct(r.weight)})`).join("; ")}. New money should still respect concentration and risk limits.`;
  }

  if (/risk|concentration|diversif/.test(q)) {
    const sectors = new Map();
    for (const r of rows) sectors.set(r.sector, (sectors.get(r.sector) || 0) + r.weight);
    const topSector = [...sectors.entries()].sort((a,b)=>b[1]-a[1])[0];
    return `Largest stock position is ${top[0] ? `${top[0].company_name} at ${pct(top[0].weight)}` : "not available"}. ${topSector ? `Largest sector is ${topSector[0]} at ${pct(topSector[1])}.` : "Sector data is not available."} ${highRisk.length ? `High-risk exposure includes ${highRisk.map(r=>`${r.company_name} ${pct(r.weight)}`).join(", ")}.` : "No HIGH-risk stock positions are currently flagged."}`;
  }

  const named = findStock(rows, question);
  if (named) {
    return `${named.company_name}: score ${named.score ?? "—"}, action ${named.action}, risk ${named.risk}, portfolio weight ${pct(named.weight)}, P/L ${pct(named.pnl_pct)}, freshness ${named.freshness}. ${named.score !== null && named.score >= 72 ? "The model currently sees this as a relatively strong holding." : "The model does not currently see this as a high-conviction holding."}`;
  }

  if (/best|top|strongest/.test(q)) {
    return `Top model-ranked holdings are ${top.map((r,i)=>`${i+1}. ${r.company_name} (${r.score ?? "—"})`).join("; ")}. Ranking is based on the current saved AI score, not a guarantee of future return.`;
  }

  if (/weak|worst|bad|poor/.test(q)) {
    return weak.length ? `Weakest scored holdings are ${weak.map(r=>`${r.company_name} (${r.score})`).join("; ")}. Some may need confirmation because stale or missing fundamentals reduce conviction.` : "No scored holdings below 55 are currently present.";
  }

  return `I can analyse your portfolio using its current holdings, AI scores, risk levels, data freshness and market regime. Try asking: “What should I do with my portfolio today?”, “Which stocks should I exit?”, or “Where should I deploy ₹50,000?”`;
}

export async function POST(request) {
  try {
    const auth = request.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Sign-in session required." }, { status:401 });
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Invalid sign-in session." }, { status:401 });

    const body = await request.json();
    const question = String(body?.question || "").trim();
    if (!question) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Question is required." }, { status:400 });

    const ctx = await loadContext(userData.user.id);
    const origin = new URL(request.url).origin;
    const regimeRes = await getJson(`${origin}/api/market-regime`);
    const regime = regimeRes.ok && regimeRes.body?.success ? regimeRes.body.regime : { label:"NEUTRAL", score:50, confidence:25 };
    const text = answer(question, ctx, regime);

    return NextResponse.json({
      success:true,
      engine_version:ENGINE_VERSION,
      answer:text,
      context:{ portfolio_value:ctx.total, stock_value:ctx.stockValue, mf_value:ctx.mfValue, stock_count:ctx.rows.length, market_regime:regime.label },
      data_sources:["holdings","ai_scores","fundamentals","market_regime"],
    });
  } catch (error) {
    console.error("Copilot error", error);
    return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:error?.message || "Copilot failed." }, { status:500 });
  }
}
