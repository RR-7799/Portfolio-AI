import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { scoreStock } from "../../lib/scoring/ai-scorer-v5-0";
import { normalizeSector } from "../../lib/scoring/sector-normalization";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ENGINE_VERSION = "ai_scorer_v5_0_preview";
const TARGETS = [
  "BIOCON",
  "PRAJ INDUSTRIES",
  "INDUSIND BANK",
  "LAURUS LABS",
  "BHARAT ELECTRONICS",
  "GARDEN REACH SHIPBUILDERS",
  "MOTHERSON SUMI WIRING",
];

function admin() {
  if (!URL || !KEY) throw new Error("Supabase service configuration is missing.");
  return createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

function authorized(request) {
  const secret = process.env.PIPELINE_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-pipeline-secret") || "";
  const auth = request.headers.get("authorization") || "";
  return header === secret || auth === `Bearer ${secret}`;
}

function norm(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
}

function matchesTarget(row, target) {
  const values = [row?.symbol, row?.company_name, row?.name, row?.trading_symbol].map(norm).filter(Boolean);
  const t = norm(target);
  return values.some(v => v === t || v.includes(t) || t.includes(v));
}

async function technicalFor(request, isin) {
  if (!isin) return { available: false, reason: "Missing ISIN." };
  const origin = new URL(request.url).origin;
  const response = await fetch(`${origin}/api/market-intelligence?isin=${encodeURIComponent(isin)}&days=365`, {
    headers: { "x-pipeline-secret": process.env.PIPELINE_SECRET || "" },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Market intelligence failed (${response.status}).`);
  return body?.technical || { available: false, reason: "Technical response missing." };
}

export async function GET(request) {
  if (!authorized(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

  try {
    const supabase = admin();
    const [{ data: instruments, error: instrumentsError }, { data: fundamentals, error: fundamentalsError }, { data: scores, error: scoresError }] = await Promise.all([
      supabase.from("instruments").select("*").limit(5000),
      supabase.from("fundamentals").select("*").limit(5000),
      supabase.from("ai_scores").select("instrument_id,total_score").limit(5000),
    ]);
    if (instrumentsError) throw instrumentsError;
    if (fundamentalsError) throw fundamentalsError;
    if (scoresError) throw scoresError;

    const byInstrument = new Map((instruments || []).map(x => [x.id || x.instrument_id, x]));
    const fundByInstrument = new Map((fundamentals || []).map(x => [x.instrument_id, x]));
    const legacyByInstrument = new Map((scores || []).map(x => [x.instrument_id, x.total_score]));
    const allFundamentals = fundamentals || [];
    const results = [];

    for (const target of TARGETS) {
      const instrument = (instruments || []).find(x => matchesTarget(x, target));
      if (!instrument) {
        results.push({ company: target, error: "Instrument not found in database." });
        continue;
      }

      const instrumentId = instrument.id || instrument.instrument_id;
      const fundamentalsRow = fundByInstrument.get(instrumentId);
      if (!fundamentalsRow) {
        results.push({ company: instrument.company_name || target, error: "Fundamentals not found in database." });
        continue;
      }

      const rawSector = instrument.sector || instrument.industry || fundamentalsRow.sector || "OTHER";
      const sector = normalizeSector(rawSector);
      const peers = allFundamentals.filter(f => {
        const peerInstrument = byInstrument.get(f.instrument_id);
        return peerInstrument && normalizeSector(peerInstrument.sector || peerInstrument.industry || "OTHER") === sector;
      });

      try {
        const technical = await technicalFor(request, instrument.isin);
        const scored = scoreStock({ fundamentals: fundamentalsRow, peers, technical, regime: "NEUTRAL", sector });
        results.push({
          company: instrument.company_name || instrument.name || target,
          symbol: instrument.symbol || instrument.trading_symbol || null,
          instrument_id: instrumentId,
          sector,
          peer_count: peers.length,
          legacy_total_score: legacyByInstrument.get(instrumentId) ?? null,
          ...scored,
          regime_used: "NEUTRAL",
        });
      } catch (error) {
        results.push({ company: instrument.company_name || target, instrument_id: instrumentId, sector, error: error?.message || "Scoring failed." });
      }
    }

    return NextResponse.json({
      success: true,
      engine_version: ENGINE_VERSION,
      dry_run: true,
      writes_performed: false,
      targets: TARGETS,
      results,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Preview failed." }, { status: 500 });
  }
}
