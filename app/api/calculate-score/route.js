import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "ai_scorer_v5_0";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const round = (v) => v == null ? null : Number(v.toFixed(1));
const avg = (xs) => { const a = xs.filter((x) => x != null && Number.isFinite(x)); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; };

function adminClient() {
  if (!supabaseUrl || !serviceKey) throw new Error("Supabase service configuration is missing.");
  return createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function percentile(value, peers) {
  const v = n(value);
  const p = peers.map(n).filter((x) => x != null).sort((a, b) => a - b);
  if (v == null || p.length < 3) return null;
  let below = 0, equal = 0;
  for (const x of p) { if (x < v) below += 1; else if (x === v) equal += 1; }
  return clamp(((below + Math.max(0, equal - 1) / 2) / Math.max(1, p.length - 1)) * 100);
}

function higherBetter(value, peers) { return percentile(value, peers); }
function lowerBetter(value, peers) {
  const p = percentile(value, peers);
  return p == null ? null : 100 - p;
}

function rangeScore(value, goodLow, goodHigh, badLow, badHigh) {
  const v = n(value);
  if (v == null) return null;
  if (v >= goodLow && v <= goodHigh) return 100;
  if (v < badLow || v > badHigh) return 0;
  if (v < goodLow) return clamp(((v - badLow) / (goodLow - badLow)) * 100);
  return clamp(((badHigh - v) / (badHigh - goodHigh)) * 100);
}

function freshnessStatus(updatedAt) {
  if (!updatedAt) return "MISSING";
  const age = (Date.now() - new Date(updatedAt).getTime()) / 86400000;
  if (!Number.isFinite(age)) return "MISSING";
  if (age <= 7) return "FRESH";
  if (age <= 30) return "ACCEPTABLE";
  if (age <= 90) return "AGING";
  if (age <= 180) return "STALE";
  return "VERY_STALE";
}

function scoreDataQuality(fundamental, technical) {
  const fields = [
    "sales_growth", "profit_growth", "roe", "roce", "debt_to_equity",
    "operating_cash_flow", "net_profit", "promoter_holding", "fii_holding",
    "dii_holding", "pe_ratio", "pb_ratio"
  ];
  const present = fields.filter((k) => n(fundamental?.[k]) != null).length;
  const technicalPoints = technical?.available ? 5 : 0;
  const total = fields.length + 5;
  return clamp(((present + technicalPoints) / total) * 100);
}

function valuationScore(f, peers) {
  const pe = n(f.pe_ratio), pb = n(f.pb_ratio);
  const parts = [];
  if (pe != null && pe > 0) parts.push({ score: lowerBetter(pe, peers.map(x => x.pe_ratio).filter(x => n(x) > 0)), weight: 0.65 });
  if (pb != null && pb > 0) parts.push({ score: lowerBetter(pb, peers.map(x => x.pb_ratio).filter(x => n(x) > 0)), weight: 0.35 });
  if (!parts.length) return { score: null, reason: "No valid positive valuation multiple available." };
  const valid = parts.filter(x => x.score != null);
  const totalW = valid.reduce((s, x) => s + x.weight, 0);
  return { score: totalW ? valid.reduce((s, x) => s + x.score * x.weight, 0) / totalW : null, reason: "Relative valuation using valid positive multiples; negative/missing P/E is not treated as cheap." };
}

function buildLongTerm(f, peers) {
  const growth = avg([
    higherBetter(f.sales_growth, peers.map(x => x.sales_growth)),
    higherBetter(f.profit_growth, peers.map(x => x.profit_growth))
  ]);
  const profitability = avg([
    higherBetter(f.roe, peers.map(x => x.roe)),
    higherBetter(f.roce, peers.map(x => x.roce))
  ]);
  const debt = lowerBetter(f.debt_to_equity, peers.map(x => x.debt_to_equity));
  const cash = higherBetter(f.operating_cash_flow, peers.map(x => x.operating_cash_flow));
  const ownership = avg([
    higherBetter(f.promoter_holding, peers.map(x => x.promoter_holding)),
    higherBetter(f.fii_holding, peers.map(x => x.fii_holding)),
    higherBetter(f.dii_holding, peers.map(x => x.dii_holding))
  ]);
  const valuation = valuationScore(f, peers).score;

  const factors = [
    ["Growth", growth, 20],
    ["Profitability / capital efficiency", profitability, 25],
    ["Leverage", debt, 10],
    ["Operating cash flow", cash, 15],
    ["Ownership", ownership, 10],
    ["Valuation", valuation, 10]
  ];
  const valid = factors.filter(x => x[1] != null);
  const weight = valid.reduce((s, x) => s + x[2], 0);
  const score = weight ? valid.reduce((s, x) => s + x[1] * x[2], 0) / weight : null;
  return { score, factors, valuationReason: valuationScore(f, peers).reason };
}

function buildShortTerm(technical, regimeLabel) {
  if (!technical?.available) return { score: null, factors: [], reason: "Technical market data unavailable; no short-term score fabricated." };
  const trend = technical.trend;
  const trendScore = { STRONG_UPTREND: 100, UPTREND: 82, SIDEWAYS: 55, DOWNTREND: 35, STRONG_DOWNTREND: 15 }[trend] ?? 50;
  const rsi = n(technical.momentum?.rsi14);
  const rsiScore = rsi == null ? null : (rsi >= 55 && rsi <= 70 ? 90 : rsi > 70 ? 62 : rsi >= 45 ? 58 : 30);
  const oneMonth = n(technical.momentum?.one_month);
  const threeMonth = n(technical.momentum?.three_month);
  const year = n(technical.momentum?.one_year);
  const momentum = avg([
    oneMonth == null ? null : clamp(50 + oneMonth * 4),
    threeMonth == null ? null : clamp(50 + threeMonth * 2),
    year == null ? null : clamp(50 + year)
  ]);
  const volumeRatio = n(technical.volatility?.volume_ratio_20d);
  const volumeScore = volumeRatio == null ? null : clamp(50 + (volumeRatio - 1) * 35);
  const volatility = n(technical.volatility?.annualized_20d_pct);
  const volatilityScore = volatility == null ? null : clamp(100 - volatility * 1.4);
  const regimeScore = regimeLabel === "BULL" ? 85 : regimeLabel === "BEAR" ? 30 : 60;
  const factors = [
    ["Price trend / moving averages", trendScore, 30],
    ["Momentum", momentum, 25],
    ["RSI", rsiScore, 10],
    ["Volume behavior", volumeScore, 10],
    ["Volatility", volatilityScore, 10],
    ["Market regime", regimeScore, 15]
  ];
  const valid = factors.filter(x => x[1] != null);
  const weight = valid.reduce((s, x) => s + x[2], 0);
  const score = weight ? valid.reduce((s, x) => s + x[1] * x[2], 0) / weight : null;
  return { score, factors, reason: `Technical structure from trend, momentum, RSI, volume, volatility and current ${regimeLabel || "market"} regime.` };
}

function riskScore(f, peers, technical) {
  const debt = lowerBetter(f.debt_to_equity, peers.map(x => x.debt_to_equity));
  const profitability = avg([
    higherBetter(f.roe, peers.map(x => x.roe)),
    higherBetter(f.roce, peers.map(x => x.roce))
  ]);
  const cash = higherBetter(f.operating_cash_flow, peers.map(x => x.operating_cash_flow));
  const volatility = technical?.available ? clamp(100 - (n(technical.volatility?.annualized_20d_pct) || 0) * 1.5) : null;
  const factors = [["Leverage resilience", debt, 30], ["Profitability resilience", profitability, 25], ["Cash-flow resilience", cash, 25], ["Market volatility", volatility, 20]];
  const valid = factors.filter(x => x[1] != null);
  const w = valid.reduce((s, x) => s + x[2], 0);
  return { score: w ? valid.reduce((s, x) => s + x[1] * x[2], 0) / w : null, factors };
}

function grade(score, type) {
  if (score == null) return "Unavailable";
  if (type === "lt") return score >= 90 ? "Exceptional" : score >= 80 ? "Excellent" : score >= 70 ? "Good" : score >= 60 ? "Average" : score >= 50 ? "Weak" : "Poor";
  if (type === "st") return score >= 90 ? "Exceptional setup" : score >= 80 ? "Strong" : score >= 70 ? "Positive" : score >= 60 ? "Neutral" : score >= 50 ? "Weak" : "Poor setup";
  return score >= 90 ? "Exceptional" : score >= 85 ? "Very Strong" : score >= 75 ? "Strong" : score >= 65 ? "Good/Average" : score >= 55 ? "Weak" : score >= 45 ? "Poor" : "Very Poor";
}

function finalScore(lt, st, risk, valuation) {
  const parts = [[lt, 0.50], [st, 0.25], [risk, 0.15], [valuation, 0.10]].filter(x => x[0] != null);
  if (!parts.length) return null;
  const w = parts.reduce((s, x) => s + x[1], 0);
  return parts.reduce((s, x) => s + x[0] * x[1], 0) / w;
}

async function technicalFor(symbol) {
  const base = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!base || !symbol) return null;
  try {
    const r = await fetch(`${base}/api/market-intelligence?isin=${encodeURIComponent(symbol)}&days=365`, { cache: "no-store" });
    if (!r.ok) return null;
    const body = await r.json();
    return body?.success ? body.technical : null;
  } catch { return null; }
}

function completenessFor(f, technical) { return scoreDataQuality(f, technical); }
function confidenceFor(completeness, freshness, lt, st, risk, valuation) {
  const fresh = { FRESH: 100, ACCEPTABLE: 85, AGING: 65, STALE: 40, VERY_STALE: 20, MISSING: 0 }[freshness] ?? 0;
  const scores = [lt, st, risk, valuation].filter(x => x != null);
  const dispersion = scores.length > 1 ? Math.sqrt(avg(scores.map(x => (x - avg(scores)) ** 2)) || 0) : 25;
  return clamp(completeness * 0.45 + fresh * 0.35 + (100 - dispersion) * 0.20);
}

function actionFor(lt, st, risk, valuation, confidence) {
  if (lt == null) return "WATCH";
  if (confidence < 45) return "WATCH";
  if (lt >= 80 && st != null && st >= 75 && (risk == null || risk >= 55) && (valuation == null || valuation >= 45)) return "BUY";
  if (lt >= 75 && st != null && st >= 60 && (risk == null || risk >= 50)) return "ACCUMULATE";
  if (lt >= 70 && st != null && st < 50) return "HOLD";
  if (lt >= 70) return "HOLD";
  if (lt >= 60 && st != null && st >= 70) return "WATCH";
  if (lt < 50 && (risk == null || risk < 40)) return "REDUCE";
  return "WATCH";
}

function buildRecord(f, instrument, peers, technical, regime) {
  const freshness = freshnessStatus(f?.updated_at);
  const lt = buildLongTerm(f, peers);
  const st = buildShortTerm(technical, regime);
  const risk = riskScore(f, peers, technical);
  const valuation = valuationScore(f, peers);
  const completeness = completenessFor(f, technical);
  const confidence = confidenceFor(completeness, freshness, lt.score, st.score, risk.score, valuation.score);
  const final = finalScore(lt.score, st.score, risk.score, valuation.score);
  const action = actionFor(lt.score, st.score, risk.score, valuation.score, confidence);
  const positives = [];
  const negatives = [];
  for (const [name, score] of lt.factors) { if (score == null) continue; (score >= 70 ? positives : negatives).push({ factor: name, score: round(score) }); }
  for (const [name, score] of st.factors) { if (score == null) continue; (score >= 70 ? positives : negatives).push({ factor: `Short-term: ${name}`, score: round(score) }); }
  const reason = lt.score != null && st.score != null && lt.score >= 75 && st.score < 55
    ? "Strong long-term business quality, but the current short-term setup does not justify aggressive buying."
    : lt.score != null && st.score != null && lt.score < 65 && st.score >= 80
      ? "Current technical setup is attractive, but long-term business quality is not strong enough to treat this as a core investment."
      : "Decision combines long-term business quality, current opportunity, risk, valuation and data confidence.";
  return {
    long_term_score: round(lt.score),
    short_term_score: round(st.score),
    risk_score: round(risk.score),
    valuation_score: round(valuation.score),
    final_ai_score: round(final),
    total_score: round(final),
    confidence: round(confidence),
    data_completeness: round(completeness),
    freshness_status: freshness,
    score_version: ENGINE_VERSION,
    calculation_metadata: { engine_version: ENGINE_VERSION, calculated_at: new Date().toISOString(), regime: regime || null, peer_count: peers.length },
    score_breakdown: {
      long_term: { grade: grade(lt.score, "lt"), factors: Object.fromEntries(lt.factors.map(([k, v, w]) => [k, { score: round(v), weight: w }])) },
      short_term: { grade: grade(st.score, "st"), factors: Object.fromEntries(st.factors.map(([k, v, w]) => [k, { score: round(v), weight: w }])) },
      risk: { score: round(risk.score), factors: Object.fromEntries(risk.factors.map(([k, v, w]) => [k, { score: round(v), weight: w }])) },
      valuation: { score: round(valuation.score), reason: valuation.reason },
      positives, negatives, reason
    },
    rating: grade(final, "final"),
    action,
    risk_level: risk.score == null ? "UNKNOWN" : risk.score >= 75 ? "LOW" : risk.score >= 55 ? "MODERATE" : risk.score >= 40 ? "HIGH" : "CRITICAL",
    ai_summary: `${instrument.company_name || instrument.symbol}: LT ${round(lt.score) ?? "—"}/100 (${grade(lt.score, "lt")}); ST ${round(st.score) ?? "—"}/100 (${grade(st.score, "st")}); Risk ${round(risk.score) ?? "—"}; Valuation ${round(valuation.score) ?? "—"}; Final ${round(final) ?? "—"}. ${reason}`
  };
}

export async function GET() {
  try {
    const supabase = adminClient();
    const { data: holdings, error: hErr } = await supabase.from("holdings").select("id,user_id,instrument_id,quantity,invested_value,current_value");
    if (hErr) return NextResponse.json({ success: false, step: "holdings", error: hErr.message }, { status: 500 });
    const ids = [...new Set((holdings || []).map(h => h.instrument_id).filter(Boolean))];
    if (!ids.length) return NextResponse.json({ success: false, step: "holdings", error: "No scoreable holdings found." }, { status: 400 });
    const [{ data: instruments, error: iErr }, { data: fundamentals, error: fErr }, { data: regimeRows }] = await Promise.all([
      supabase.from("instruments").select("id,symbol,company_name,sector").in("id", ids),
      supabase.from("fundamentals").select("*").in("instrument_id", ids),
      supabase.from("market_regime_history").select("regime").order("snapshot_at", { ascending: false }).limit(1)
    ]);
    if (iErr) return NextResponse.json({ success: false, step: "instruments", error: iErr.message }, { status: 500 });
    if (fErr) return NextResponse.json({ success: false, step: "fundamentals", error: fErr.message }, { status: 500 });
    const im = new Map((instruments || []).map(x => [x.id, x]));
    const fm = new Map();
    for (const f of fundamentals || []) { const old = fm.get(f.instrument_id); if (!old || new Date(f.updated_at || 0) > new Date(old.updated_at || 0)) fm.set(f.instrument_id, f); }
    const regime = regimeRows?.[0]?.regime || "NEUTRAL";
    const technicalCache = new Map();
    const rows = (holdings || []).filter(h => im.has(h.instrument_id));
    const results = [], skipped = [];
    for (let i = 0; i < rows.length; i += 5) {
      const batch = rows.slice(i, i + 5);
      await Promise.all(batch.map(async (h) => {
        const instrument = im.get(h.instrument_id), f = fm.get(h.instrument_id);
        if (!f) { skipped.push({ instrument_id: h.instrument_id, symbol: instrument.symbol, reason: "Fundamentals not available." }); return; }
        let technical = technicalCache.get(instrument.symbol);
        if (technical === undefined) { technical = await technicalFor(instrument.symbol); technicalCache.set(instrument.symbol, technical || null); }
        const peers = (fundamentals || []).filter(x => x.instrument_id !== h.instrument_id && (im.get(x.instrument_id)?.sector || "OTHER") === (instrument.sector || "OTHER"));
        const score = buildRecord(f, instrument, peers, technical, regime);
        const record = { user_id: h.user_id || null, instrument_id: h.instrument_id, ...score, calculated_at: new Date().toISOString(), score_date: new Date().toISOString() };
        const { error } = await supabase.from("ai_scores").upsert(record, { onConflict: "instrument_id,user_id" });
        if (error) { skipped.push({ instrument_id: h.instrument_id, symbol: instrument.symbol, reason: error.message }); return; }
        results.push({ instrument_id: h.instrument_id, symbol: instrument.symbol, company_name: instrument.company_name, long_term_score: score.long_term_score, short_term_score: score.short_term_score, risk_score: score.risk_score, valuation_score: score.valuation_score, final_ai_score: score.final_ai_score, confidence: score.confidence, data_completeness: score.data_completeness, freshness_status: score.freshness_status, action: score.action });
      }));
    }
    const scores = results.map(x => x.final_ai_score).filter(x => x != null);
    return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, summary: { total_holdings: holdings.length, scored: results.length, skipped: skipped.length, average_final_ai_score: scores.length ? round(avg(scores)) : null }, results, skipped });
  } catch (error) {
    console.error("AI scorer v5 error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "AI scoring failed." }, { status: 500 });
  }
}
