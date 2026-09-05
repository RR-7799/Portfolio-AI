import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreStock, ENGINE_VERSION as SCORER_VERSION, riskLabel, scoreLabel } from "../../lib/scoring/ai-scorer-v5-5";
import { normalizeSector } from "../../lib/scoring/sector-normalization";
import { calculateMarketRegime } from "../../lib/market-regime";
import { getTechnicalForIsin } from "../../lib/upstox-technical";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const UPSTOX_BASE = "https://api.upstox.com/v2";
const FINANCIAL = new Set(["BANKING", "NBFC", "FINANCIAL_SERVICES"]);

const admin = () => {
  if (!URL || !KEY) throw new Error("Supabase service configuration is missing.");
  return createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
};

function authorized(request) {
  const secret = process.env.PIPELINE_SECRET || "";
  if (!secret) return false;
  const h = request.headers.get("x-pipeline-secret") || "";
  const a = request.headers.get("authorization") || "";
  return h === secret || a === `Bearer ${secret}`;
}

async function upstox(path) {
  const token = process.env.UPSTOX_ANALYTICS_TOKEN;
  if (!token) throw new Error("Missing UPSTOX_ANALYTICS_TOKEN");
  const r = await fetch(`${UPSTOX_BASE}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
}

const norm = v => String(v || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

function ratioRows(body) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  return rows.map(x => ({
    name: String(x?.name || ""),
    company_value: x?.company_value ?? null,
    sector_value: x?.sector_value ?? null,
    company_numeric: Number.parseFloat(String(x?.company_value ?? "").replace(/[%₹,]/g, "")),
    sector_numeric: Number.parseFloat(String(x?.sector_value ?? "").replace(/[%₹,]/g, "")),
  })).filter(x => x.name).map(x => ({
    ...x,
    company_numeric: Number.isFinite(x.company_numeric) ? x.company_numeric : null,
    sector_numeric: Number.isFinite(x.sector_numeric) ? x.sector_numeric : null,
  }));
}

function ratioMap(rows) {
  const out = {};
  for (const row of rows || []) {
    const k = norm(row.name);
    if (k === "P E") out.pe = row;
    else if (k === "P B") out.pb = row;
    else if (k === "ROA") out.roa = row;
    else if (k === "ROE") out.roe = row;
    else if (k === "ROCE") out.roce = row;
    else if (k === "EV EBITDA") out.ev_ebitda = row;
  }
  return out;
}

function buildRecord({ instrument, fundamentals, peers, technical, regime, history, bankingRatios }) {
  const sector = normalizeSector(instrument?.sector || fundamentals?.sector || "OTHER");
  const scored = scoreStock({
    fundamentals,
    peers,
    technical,
    regime,
    sector,
    currentPrice: Number.isFinite(Number(technical?.price)) ? Number(technical.price) : null,
    history,
    bankingRatios,
  });
  const calculatedAt = new Date().toISOString();
  const missing = scored.score_breakdown?.missing_core || [];
  const qualityReasons = [
    ...(scored.score_breakdown?.long_term?.unavailable || []),
    ...(scored.score_breakdown?.short_term?.unavailable || []),
    ...(scored.score_breakdown?.risk?.unavailable || []),
  ];
  const dataStatus = missing.length || qualityReasons.length ? "LIMITED" : "GOOD";
  const metadata = {
    ...(scored.calculation_metadata || {}),
    engine_version: SCORER_VERSION,
    calculated_at: calculatedAt,
    regime,
    sector,
    peer_count: peers.length,
    history_periods: history.length,
    banking_provider_metrics: Object.keys(bankingRatios || {}),
    data_status: dataStatus,
    unavailable_reasons: [...new Set(qualityReasons)],
  };
  return {
    ...scored,
    sector,
    score_version: SCORER_VERSION,
    calculation_metadata: metadata,
    score_breakdown: scored.score_breakdown,
    risk_level: riskLabel(scored.risk_score),
    rating: scoreLabel(scored.final_ai_score),
    ai_summary: `${instrument?.company_name || instrument?.symbol || "Holding"}: LT ${scored.long_term_score ?? "—"}/100; ST ${scored.short_term_score ?? "—"}/100; Risk ${scored.risk_score ?? "—"}/100; Valuation ${scored.valuation_score ?? "—"}/100; Final ${scored.final_ai_score ?? "—"}/100.`,
    freshness_status: (() => {
      const updated = fundamentals?.updated_at;
      if (!updated) return "MISSING";
      const age = (Date.now() - new Date(updated).getTime()) / 86400000;
      if (!Number.isFinite(age)) return "MISSING";
      if (age <= 7) return "FRESH";
      if (age <= 30) return "ACCEPTABLE";
      if (age <= 90) return "AGING";
      if (age <= 180) return "STALE";
      return "VERY_STALE";
    })(),
  };
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ success: false, engine_version: SCORER_VERSION, error: "Unauthorized" }, { status: 401 });

  const started = Date.now();
  try {
    const db = admin();
    const regime = await calculateMarketRegime();
    const [{ data: instruments, error: ie }, { data: fundamentals, error: fe }, { data: history, error: he }, { data: holdings, error: hError }] = await Promise.all([
      db.from("instruments").select("*").limit(5000),
      db.from("fundamentals").select("*").limit(5000),
      db.from("fundamentals_history").select("*").order("period", { ascending: true }).limit(10000),
      db.from("holdings").select("user_id,instrument_id").limit(10000),
    ]);
    if (ie) throw ie;
    if (fe) throw fe;
    if (he) throw he;
    if (hError) throw hError;

    const im = new Map((instruments || []).map(x => [x.id, x]));
    const fm = new Map((fundamentals || []).map(x => [x.instrument_id, x]));
    const hm = new Map();
    for (const row of history || []) {
      const list = hm.get(row.instrument_id) || [];
      list.push(row);
      hm.set(row.instrument_id, list);
    }

    const pairs = new Map();
    for (const row of holdings || []) {
      if (!row.user_id || !row.instrument_id) continue;
      pairs.set(`${row.user_id}:${row.instrument_id}`, row);
    }
    const instrumentIds = [...new Set([...pairs.values()].map(x => x.instrument_id))];
    const userIds = [...new Set([...pairs.values()].map(x => x.user_id))];
    const existingQuery = instrumentIds.length && userIds.length
      ? db.from("ai_scores").select("id,user_id,instrument_id").in("instrument_id", instrumentIds).in("user_id", userIds)
      : Promise.resolve({ data: [], error: null });
    const { data: existing, error: existingError } = await existingQuery;
    if (existingError) throw existingError;
    const existingMap = new Map((existing || []).map(x => [`${x.user_id}:${x.instrument_id}`, x]));

    const results = [];
    for (const instrumentId of instrumentIds) {
      const instrument = im.get(instrumentId);
      const f = fm.get(instrumentId);
      if (!instrument || !f) {
        results.push({ instrument_id: instrumentId, success: false, error: !instrument ? "Instrument not found" : "Fundamentals not found" });
        continue;
      }
      try {
        const sector = normalizeSector(instrument.sector || f.sector || "OTHER");
        const sectorPeers = (fundamentals || []).filter(x => {
          const peerInstrument = im.get(x.instrument_id);
          return peerInstrument && normalizeSector(peerInstrument.sector || "OTHER") === sector;
        });
        const peers = sectorPeers.length >= 3 ? sectorPeers : (fundamentals || []);
        let bankingRows = [];
        if (FINANCIAL.has(sector) && instrument.isin) {
          const rr = await upstox(`/fundamentals/${encodeURIComponent(instrument.isin)}/key-ratios`);
          if (rr.ok) bankingRows = ratioRows(rr.body);
        }
        const bankingRatios = ratioMap(bankingRows);
        const technical = instrument.isin ? await getTechnicalForIsin(instrument.isin, 365) : null;
        const record = buildRecord({
          instrument,
          fundamentals: f,
          peers,
          technical,
          regime: regime.regime.label,
          history: hm.get(instrumentId) || [],
          bankingRatios,
        });
        results.push({ instrument_id: instrumentId, symbol: instrument.symbol, company: instrument.company_name, success: true, final_ai_score: record.final_ai_score, score_version: record.score_version, technical_status: technical?.status || "MISSING" });

        const calculatedAt = new Date().toISOString();
        const rows = [];
        for (const pair of pairs.values()) {
          if (pair.instrument_id !== instrumentId) continue;
          const key = `${pair.user_id}:${instrumentId}`;
          const payload = {
            long_term_score: record.long_term_score,
            short_term_score: record.short_term_score,
            risk_score: record.risk_score,
            valuation_score: record.valuation_score,
            final_ai_score: record.final_ai_score,
            total_score: record.final_ai_score,
            confidence: record.confidence,
            data_completeness: record.data_completeness,
            freshness_status: record.freshness_status,
            score_version: record.score_version,
            calculation_metadata: record.calculation_metadata,
            score_breakdown: record.score_breakdown,
            risk_level: record.risk_level,
            rating: record.rating,
            ai_summary: record.ai_summary,
            calculated_at: calculatedAt,
            updated_at: calculatedAt,
            score_date: calculatedAt,
          };
          const prior = existingMap.get(key);
          if (prior) {
            const { error } = await db.from("ai_scores").update(payload).eq("id", prior.id).eq("user_id", pair.user_id);
            if (error) throw error;
          } else {
            const { error } = await db.from("ai_scores").insert({ ...payload, user_id: pair.user_id, instrument_id: instrumentId });
            if (error) throw error;
          }
          const { error: historyError } = await db.from("ai_score_history").insert({
            user_id: pair.user_id,
            instrument_id: instrumentId,
            long_term_score: record.long_term_score,
            short_term_score: record.short_term_score,
            risk_score: record.risk_score,
            valuation_score: record.valuation_score,
            final_ai_score: record.final_ai_score,
            total_score: record.final_ai_score,
            confidence: record.confidence,
            data_completeness: record.data_completeness,
            freshness_status: record.freshness_status,
            score_version: record.score_version,
            score_breakdown: record.score_breakdown,
            calculated_at: calculatedAt,
            calculation_metadata: record.calculation_metadata,
          });
          if (historyError) throw historyError;
        }
      } catch (error) {
        results.push({ instrument_id: instrumentId, symbol: instrument.symbol, company: instrument.company_name, success: false, error: error?.message || "V5.5 scoring failed" });
      }
    }

    const successful = results.filter(x => x.success);
    const failed = results.filter(x => !x.success);
    const finals = successful.map(x => Number(x.final_ai_score)).filter(Number.isFinite);
    return NextResponse.json({
      success: failed.length === 0,
      engine_version: SCORER_VERSION,
      dry_run: false,
      writes_performed: true,
      elapsed_ms: Date.now() - started,
      market_regime: regime.regime,
      summary: {
        holdings_scored: successful.length,
        scored: successful.length,
        failed: failed.length,
        history_stored: successful.length * userIds.length,
        average_final_ai_score: finals.length ? Number((finals.reduce((a, x) => a + x, 0) / finals.length).toFixed(1)) : null,
      },
      results,
    });
  } catch (error) {
    console.error("V5.5 production scoring error:", error);
    return NextResponse.json({ success: false, engine_version: SCORER_VERSION, error: error?.message || "V5.5 production scoring failed." }, { status: 500 });
  }
}
