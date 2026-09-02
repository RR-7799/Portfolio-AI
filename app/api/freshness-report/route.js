import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const ENGINE_VERSION = "freshness_v1_1";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function parseDate(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const monthMatch = text.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})$/i
  );
  if (monthMatch) {
    const monthMap = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const month = monthMap[monthMatch[1].slice(0, 3).toLowerCase()];
    const year = Number(monthMatch[2]);
    if (Number.isInteger(year) && month !== undefined) return new Date(Date.UTC(year, month + 1, 0));
    return null;
  }

  // Indian financial year formats: 2025-26, 2025/26, FY 2025-26, FY2025/26.
  const fyMatch = text.match(/^(?:FY\s*)?(\d{4})\s*[-/]\s*(\d{2}|\d{4})$/i);
  if (fyMatch) {
    const startYear = Number(fyMatch[1]);
    if (!Number.isInteger(startYear)) return null;
    return new Date(Date.UTC(startYear + 1, 2, 31));
  }

  return null;
}

function monthAge(date, now) {
  if (!date) return null;
  const yearDiff = now.getUTCFullYear() - date.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - date.getUTCMonth();
  const dayAdjustment = now.getUTCDate() < date.getUTCDate() ? 1 : 0;
  return Math.max(0, yearDiff * 12 + monthDiff - dayAdjustment);
}

function classifyFreshness(ageMonths) {
  if (ageMonths === null) return { status: "MISSING", score: 0, confidence: 0, maxScore: 49, reason: "No financial statement period is available." };
  if (ageMonths <= 12) return { status: "FRESH", score: 100, confidence: 100, maxScore: 100, reason: "Financial data is within the last 12 months." };
  if (ageMonths <= 18) return { status: "ACCEPTABLE", score: 80, confidence: 80, maxScore: 84, reason: "Financial data is older than one year but within 18 months." };
  if (ageMonths <= 24) return { status: "AGING", score: 60, confidence: 60, maxScore: 74, reason: "Financial data is between 19 and 24 months old." };
  if (ageMonths <= 36) return { status: "STALE", score: 35, confidence: 35, maxScore: 69, reason: "Financial data is more than two years old." };
  return { status: "VERY_STALE", score: 15, confidence: 15, maxScore: 59, reason: "Financial data is more than three years old." };
}

export async function GET() {
  try {
    const now = new Date();
    const { data: holdings, error: holdingsError } = await supabase.from("holdings").select("instrument_id");
    if (holdingsError) throw new Error(`Holdings query failed: ${holdingsError.message}`);

    const instrumentIds = [...new Set((holdings || []).map((row) => row.instrument_id).filter(Boolean))];
    if (!instrumentIds.length) {
      return NextResponse.json({ success: true, engine_version: ENGINE_VERSION, as_of: now.toISOString(), holdings: 0, unique_instruments: 0, average_freshness_score: null, freshness_counts: {}, critical_count: 0, results: [] });
    }

    const [{ data: instruments, error: instrumentsError }, { data: fundamentals, error: fundamentalsError }] = await Promise.all([
      supabase.from("instruments").select("id,symbol,company_name,sector").in("id", instrumentIds),
      supabase.from("fundamentals").select("instrument_id,financial_year,shareholding_date,updated_at").in("instrument_id", instrumentIds),
    ]);

    if (instrumentsError) throw new Error(`Instruments query failed: ${instrumentsError.message}`);
    if (fundamentalsError) throw new Error(`Fundamentals query failed: ${fundamentalsError.message}`);

    const instrumentMap = new Map((instruments || []).map((row) => [row.id, row]));
    const fundamentalsMap = new Map((fundamentals || []).map((row) => [row.instrument_id, row]));

    const results = instrumentIds.map((instrumentId) => {
      const instrument = instrumentMap.get(instrumentId);
      if (!instrument) return null;
      const fundamental = fundamentalsMap.get(instrumentId) || {};
      const financialDate = parseDate(fundamental.financial_year);
      const ownershipDate = parseDate(fundamental.shareholding_date);
      const financialAgeMonths = monthAge(financialDate, now);
      const ownershipAgeMonths = monthAge(ownershipDate, now);
      const freshness = classifyFreshness(financialAgeMonths);

      return {
        instrument_id: instrumentId,
        symbol: instrument.symbol,
        company_name: instrument.company_name,
        sector: instrument.sector,
        financial_period: fundamental.financial_year || null,
        financial_age_months: financialAgeMonths,
        freshness_status: freshness.status,
        freshness_score: freshness.score,
        freshness_confidence: freshness.confidence,
        freshness_max_score: freshness.maxScore,
        freshness_reason: freshness.reason,
        ownership_date: fundamental.shareholding_date || null,
        ownership_age_months: ownershipAgeMonths,
        last_sync_at: fundamental.updated_at || null,
      };
    }).filter(Boolean);

    const freshnessCounts = {};
    for (const item of results) freshnessCounts[item.freshness_status] = (freshnessCounts[item.freshness_status] || 0) + 1;

    const averageFreshnessScore = results.length
      ? Number((results.reduce((sum, item) => sum + item.freshness_score, 0) / results.length).toFixed(1))
      : null;

    const critical = results
      .filter((item) => ["MISSING", "VERY_STALE"].includes(item.freshness_status))
      .sort((a, b) => (a.financial_age_months ?? 9999) - (b.financial_age_months ?? 9999));

    const aging = results
      .filter((item) => ["STALE", "AGING"].includes(item.freshness_status))
      .sort((a, b) => (b.financial_age_months || 0) - (a.financial_age_months || 0));

    return NextResponse.json({
      success: true,
      engine_version: ENGINE_VERSION,
      as_of: now.toISOString(),
      holdings: holdings?.length || 0,
      unique_instruments: instrumentIds.length,
      average_freshness_score: averageFreshnessScore,
      freshness_counts: freshnessCounts,
      critical_count: critical.length,
      critical_stale_financials: critical.map((item) => ({ company_name: item.company_name, financial_period: item.financial_period, financial_age_months: item.financial_age_months, freshness_status: item.freshness_status })),
      aging_financials: aging.map((item) => ({ company_name: item.company_name, financial_period: item.financial_period, financial_age_months: item.financial_age_months, freshness_status: item.freshness_status })),
      results,
    });
  } catch (error) {
    console.error("Freshness report error:", error);
    return NextResponse.json({ success: false, engine_version: ENGINE_VERSION, error: error?.message || "Unknown error" }, { status: 500 });
  }
}
