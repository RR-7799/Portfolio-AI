import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing.");
  }

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/* =========================================================
   PORTFOLIO AI — SECTOR SPECIFIC SCORING ENGINE
   =========================================================

   Maximum score = 100

   Core principles:
   1. Different sectors use different priorities.
   2. Missing data is NOT treated as a positive.
   3. Missing data reduces confidence.
   4. Valuation is separated from business quality.
   5. Risk is calculated independently.
   6. Final action considers score + confidence + risk.
   7. This is decision-support, not financial advice.
*/


// =========================================================
// HELPERS
// =========================================================

function number(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const valid = values.filter((v) => v !== null && v !== undefined);

  if (!valid.length) return null;

  return (
    valid.reduce((sum, value) => sum + value, 0) /
    valid.length
  );
}

function scoreGrowth(growth) {
  const g = number(growth);

  if (g === null) return null;

  if (g >= 25) return 100;
  if (g >= 20) return 90;
  if (g >= 15) return 80;
  if (g >= 10) return 70;
  if (g >= 5) return 55;
  if (g >= 0) return 40;
  if (g >= -10) return 20;

  return 5;
}

function scoreProfitability(roe, roce) {
  const r1 = number(roe);
  const r2 = number(roce);

  const scores = [];

  if (r1 !== null) {
    if (r1 >= 25) scores.push(100);
    else if (r1 >= 20) scores.push(90);
    else if (r1 >= 15) scores.push(80);
    else if (r1 >= 10) scores.push(65);
    else if (r1 >= 5) scores.push(45);
    else if (r1 >= 0) scores.push(25);
    else scores.push(5);
  }

  if (r2 !== null) {
    if (r2 >= 30) scores.push(100);
    else if (r2 >= 20) scores.push(90);
    else if (r2 >= 15) scores.push(80);
    else if (r2 >= 10) scores.push(65);
    else if (r2 >= 5) scores.push(45);
    else if (r2 >= 0) scores.push(25);
    else scores.push(5);
  }

  return average(scores);
}

function scoreDebt(debtToEquity) {
  const d = number(debtToEquity);

  if (d === null) return null;

  if (d <= 0) return 100;
  if (d <= 0.25) return 95;
  if (d <= 0.5) return 85;
  if (d <= 0.75) return 75;
  if (d <= 1) return 65;
  if (d <= 1.5) return 50;
  if (d <= 2) return 30;

  return 10;
}

function scoreOwnership(promoter, fii, dii) {
  const values = [];

  const p = number(promoter);
  const f = number(fii);
  const d = number(dii);

  if (p !== null) {
    if (p >= 60) values.push(100);
    else if (p >= 50) values.push(90);
    else if (p >= 40) values.push(80);
    else if (p >= 30) values.push(65);
    else if (p >= 20) values.push(50);
    else values.push(30);
  }

  if (f !== null) {
    if (f >= 20) values.push(100);
    else if (f >= 15) values.push(90);
    else if (f >= 10) values.push(80);
    else if (f >= 5) values.push(65);
    else if (f >= 2) values.push(50);
    else values.push(30);
  }

  if (d !== null) {
    if (d >= 20) values.push(100);
    else if (d >= 15) values.push(90);
    else if (d >= 10) values.push(80);
    else if (d >= 5) values.push(65);
    else values.push(50);
  }

  return average(values);
}

function scoreValuation(pe, pb) {
  const p = number(pe);
  const b = number(pb);

  const scores = [];

  // PE
  if (p !== null && p > 0) {
    if (p <= 10) scores.push(100);
    else if (p <= 15) scores.push(90);
    else if (p <= 20) scores.push(80);
    else if (p <= 25) scores.push(70);
    else if (p <= 35) scores.push(55);
    else if (p <= 50) scores.push(35);
    else scores.push(15);
  }

  // PB
  if (b !== null && b > 0) {
    if (b <= 1) scores.push(100);
    else if (b <= 2) scores.push(90);
    else if (b <= 3) scores.push(80);
    else if (b <= 5) scores.push(65);
    else if (b <= 8) scores.push(45);
    else if (b <= 12) scores.push(25);
    else scores.push(10);
  }

  return average(scores);
}

function scoreCashFlow(operatingCashFlow) {
  const ocf = number(operatingCashFlow);

  if (ocf === null) return null;

  if (ocf > 0) return 80;

  if (ocf === 0) return 45;

  return 10;
}


// =========================================================
// BANK-SPECIFIC METRICS
// =========================================================

function scoreBankValuation(pe, pb) {
  const scores = [];

  const p = number(pe);
  const b = number(pb);

  if (p !== null && p > 0) {
    if (p <= 10) scores.push(100);
    else if (p <= 15) scores.push(90);
    else if (p <= 20) scores.push(75);
    else if (p <= 25) scores.push(60);
    else if (p <= 35) scores.push(40);
    else scores.push(20);
  }

  if (b !== null && b > 0) {
    if (b <= 1) scores.push(100);
    else if (b <= 1.5) scores.push(90);
    else if (b <= 2) scores.push(80);
    else if (b <= 2.5) scores.push(65);
    else if (b <= 3) scores.push(50);
    else if (b <= 4) scores.push(35);
    else scores.push(20);
  }

  return average(scores);
}

function scoreBankProfitability(roe) {
  const r = number(roe);

  if (r === null) return null;

  if (r >= 20) return 100;
  if (r >= 17) return 90;
  if (r >= 15) return 80;
  if (r >= 12) return 70;
  if (r >= 10) return 60;
  if (r >= 7) return 45;
  if (r >= 4) return 30;
  if (r >= 0) return 15;

  return 5;
}


// =========================================================
// SECTOR SCORE ENGINES
// =========================================================

function scoreStandardCompany(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreProfitability(
    f.roe,
    f.roce
  );

  const debt = scoreDebt(f.debt_to_equity);

  const ownership = scoreOwnership(
    f.promoter_holding,
    f.fii_holding,
    f.dii_holding
  );

  const valuation = scoreValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const cashFlow = scoreCashFlow(
    f.operating_cash_flow
  );

  const components = [
    growth,
    profitability,
    debt,
    ownership,
    valuation,
    cashFlow,
  ];

  const valid = components.filter(
    (v) => v !== null
  );

  if (!valid.length) {
    return {
      score: 0,
      confidence: 0,
      components: {},
    };
  }

  /*
    Generic weighting

    Growth        25
    Profitability 25
    Debt          15
    Ownership     10
    Valuation     15
    Cashflow      10
  */

  const weights = {
    growth: 25,
    profitability: 25,
    debt: 15,
    ownership: 10,
    valuation: 15,
    cashFlow: 10,
  };

  const data = {
    growth,
    profitability,
    debt,
    ownership,
    valuation,
    cashFlow,
  };

  let score = 0;
  let totalWeight = 0;

  for (const [key, value] of Object.entries(data)) {
    if (value !== null) {
      score += value * weights[key];
      totalWeight += weights[key];
    }
  }

  score = totalWeight
    ? score / totalWeight
    : 0;

  return {
    score: Math.round(clamp(score)),
    components: data,
  };
}


// =========================================================
// BANK SCORE
// =========================================================

function scoreBank(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreBankProfitability(
    f.roe
  );

  const valuation = scoreBankValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const ownership = scoreOwnership(
    f.promoter_holding,
    f.fii_holding,
    f.dii_holding
  );

  /*
    Banks should NOT be penalized using
    normal-company debt/equity or OCF.
  */

  const components = {
    growth,
    profitability,
    valuation,
    ownership,
  };

  const weights = {
    growth: 30,
    profitability: 30,
    valuation: 25,
    ownership: 15,
  };

  let score = 0;
  let totalWeight = 0;

  for (const [key, value] of Object.entries(components)) {
    if (value !== null) {
      score += value * weights[key];
      totalWeight += weights[key];
    }
  }

  score = totalWeight
    ? score / totalWeight
    : 0;

  return {
    score: Math.round(clamp(score)),
    components,
  };
}


// =========================================================
// FINANCIAL / NBFC SCORE
// =========================================================

function scoreFinancial(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreBankProfitability(
    f.roe
  );

  const leverage = scoreDebt(
    f.debt_to_equity
  );

  const valuation = scoreBankValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const ownership = scoreOwnership(
    f.promoter_holding,
    f.fii_holding,
    f.dii_holding
  );

  const components = {
    growth,
    profitability,
    leverage,
    valuation,
    ownership,
  };

  const weights = {
    growth: 25,
    profitability: 30,
    leverage: 15,
    valuation: 20,
    ownership: 10,
  };

  let score = 0;
  let totalWeight = 0;

  for (const [key, value] of Object.entries(components)) {
    if (value !== null) {
      score += value * weights[key];
      totalWeight += weights[key];
    }
  }

  score = totalWeight
    ? score / totalWeight
    : 0;

  return {
    score: Math.round(clamp(score)),
    components,
  };
}


// =========================================================
// TECHNOLOGY SCORE
// =========================================================

function scoreTechnology(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreProfitability(
    f.roe,
    f.roce
  );

  const cashFlow = scoreCashFlow(
    f.operating_cash_flow
  );

  const valuation = scoreValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const ownership = scoreOwnership(
    f.promoter_holding,
    f.fii_holding,
    f.dii_holding
  );

  const components = {
    growth,
    profitability,
    cashFlow,
    valuation,
    ownership,
  };

  const weights = {
    growth: 30,
    profitability: 30,
    cashFlow: 15,
    valuation: 15,
    ownership: 10,
  };

  return weightedScore(
    components,
    weights
  );
}


// =========================================================
// DEFENCE SCORE
// =========================================================

function scoreDefence(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreProfitability(
    f.roe,
    f.roce
  );

  const debt = scoreDebt(
    f.debt_to_equity
  );

  const ownership = scoreOwnership(
    f.promoter_holding,
    f.fii_holding,
    f.dii_holding
  );

  const valuation = scoreValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const cashFlow = scoreCashFlow(
    f.operating_cash_flow
  );

  const components = {
    growth,
    profitability,
    debt,
    ownership,
    valuation,
    cashFlow,
  };

  const weights = {
    growth: 25,
    profitability: 25,
    debt: 15,
    ownership: 10,
    valuation: 15,
    cashFlow: 10,
  };

  return weightedScore(
    components,
    weights
  );
}


// =========================================================
// PHARMA SCORE
// =========================================================

function scorePharma(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreProfitability(
    f.roe,
    f.roce
  );

  const debt = scoreDebt(
    f.debt_to_equity
  );

  const valuation = scoreValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const cashFlow = scoreCashFlow(
    f.operating_cash_flow
  );

  const components = {
    growth,
    profitability,
    debt,
    valuation,
    cashFlow,
  };

  const weights = {
    growth: 25,
    profitability: 30,
    debt: 15,
    valuation: 20,
    cashFlow: 10,
  };

  return weightedScore(
    components,
    weights
  );
}


// =========================================================
// AUTOMOBILE SCORE
// =========================================================

function scoreAutomobile(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreProfitability(
    f.roe,
    f.roce
  );

  const debt = scoreDebt(
    f.debt_to_equity
  );

  const valuation = scoreValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const cashFlow = scoreCashFlow(
    f.operating_cash_flow
  );

  const components = {
    growth,
    profitability,
    debt,
    valuation,
    cashFlow,
  };

  const weights = {
    growth: 25,
    profitability: 25,
    debt: 15,
    valuation: 20,
    cashFlow: 15,
  };

  return weightedScore(
    components,
    weights
  );
}


// =========================================================
// ENERGY SCORE
// =========================================================

function scoreEnergy(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreProfitability(
    f.roe,
    f.roce
  );

  const debt = scoreDebt(
    f.debt_to_equity
  );

  const cashFlow = scoreCashFlow(
    f.operating_cash_flow
  );

  const valuation = scoreValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const components = {
    growth,
    profitability,
    debt,
    cashFlow,
    valuation,
  };

  const weights = {
    growth: 20,
    profitability: 25,
    debt: 20,
    cashFlow: 20,
    valuation: 15,
  };

  return weightedScore(
    components,
    weights
  );
}


// =========================================================
// METALS SCORE
// =========================================================

function scoreMetals(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreProfitability(
    f.roe,
    f.roce
  );

  const debt = scoreDebt(
    f.debt_to_equity
  );

  const cashFlow = scoreCashFlow(
    f.operating_cash_flow
  );

  const valuation = scoreValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const components = {
    growth,
    profitability,
    debt,
    cashFlow,
    valuation,
  };

  const weights = {
    growth: 20,
    profitability: 20,
    debt: 20,
    cashFlow: 20,
    valuation: 20,
  };

  return weightedScore(
    components,
    weights
  );
}


// =========================================================
// INFRA SCORE
// =========================================================

function scoreInfrastructure(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreProfitability(
    f.roe,
    f.roce
  );

  const debt = scoreDebt(
    f.debt_to_equity
  );

  const cashFlow = scoreCashFlow(
    f.operating_cash_flow
  );

  const valuation = scoreValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const components = {
    growth,
    profitability,
    debt,
    cashFlow,
    valuation,
  };

  const weights = {
    growth: 25,
    profitability: 20,
    debt: 20,
    cashFlow: 20,
    valuation: 15,
  };

  return weightedScore(
    components,
    weights
  );
}


// =========================================================
// CONSUMER SCORE
// =========================================================

function scoreConsumer(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreProfitability(
    f.roe,
    f.roce
  );

  const debt = scoreDebt(
    f.debt_to_equity
  );

  const valuation = scoreValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const cashFlow = scoreCashFlow(
    f.operating_cash_flow
  );

  const components = {
    growth,
    profitability,
    debt,
    valuation,
    cashFlow,
  };

  const weights = {
    growth: 25,
    profitability: 30,
    debt: 15,
    valuation: 20,
    cashFlow: 10,
  };

  return weightedScore(
    components,
    weights
  );
}


// =========================================================
// CHEMICALS SCORE
// =========================================================

function scoreChemicals(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreProfitability(
    f.roe,
    f.roce
  );

  const debt = scoreDebt(
    f.debt_to_equity
  );

  const cashFlow = scoreCashFlow(
    f.operating_cash_flow
  );

  const valuation = scoreValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const components = {
    growth,
    profitability,
    debt,
    cashFlow,
    valuation,
  };

  const weights = {
    growth: 25,
    profitability: 25,
    debt: 20,
    cashFlow: 15,
    valuation: 15,
  };

  return weightedScore(
    components,
    weights
  );
}


// =========================================================
// INDUSTRIAL SCORE
// =========================================================

function scoreIndustrial(f) {
  const growth = average([
    scoreGrowth(f.sales_growth),
    scoreGrowth(f.profit_growth),
  ]);

  const profitability = scoreProfitability(
    f.roe,
    f.roce
  );

  const debt = scoreDebt(
    f.debt_to_equity
  );

  const cashFlow = scoreCashFlow(
    f.operating_cash_flow
  );

  const valuation = scoreValuation(
    f.pe_ratio,
    f.pb_ratio
  );

  const components = {
    growth,
    profitability,
    debt,
    cashFlow,
    valuation,
  };

  const weights = {
    growth: 25,
    profitability: 25,
    debt: 20,
    cashFlow: 15,
    valuation: 15,
  };

  return weightedScore(
    components,
    weights
  );
}


// =========================================================
// GENERIC WEIGHTED SCORE
// =========================================================

function weightedScore(components, weights) {
  let score = 0;
  let totalWeight = 0;

  for (const [key, value] of Object.entries(components)) {
    if (value !== null && value !== undefined) {
      score += value * weights[key];
      totalWeight += weights[key];
    }
  }

  const finalScore =
    totalWeight > 0
      ? score / totalWeight
      : 0;

  return {
    score: Math.round(clamp(finalScore)),
    components,
  };
}


// =========================================================
// RISK ENGINE
// =========================================================

function calculateRisk(f, securityType) {
  const debt = number(f.debt_to_equity);
  const roe = number(f.roe);
  const roce = number(f.roce);
  const profitGrowth = number(f.profit_growth);

  // Banks/financials
  if (
    securityType === "BANK" ||
    securityType === "FINANCIAL"
  ) {
    if (
      roe !== null &&
      roe >= 15 &&
      profitGrowth !== null &&
      profitGrowth >= 10
    ) {
      return "LOW";
    }

    if (
      roe !== null &&
      roe >= 10 &&
      profitGrowth !== null &&
      profitGrowth >= 0
    ) {
      return "MODERATE";
    }

    return "HIGH";
  }

  // Normal companies
  if (
    debt !== null &&
    debt <= 0.5 &&
    roe !== null &&
    roe >= 15 &&
    roce !== null &&
    roce >= 15
  ) {
    return "LOW";
  }

  if (
    debt !== null &&
    debt <= 1.0
  ) {
    return "MODERATE";
  }

  if (
    debt !== null &&
    debt > 2
  ) {
    return "HIGH";
  }

  return "MODERATE";
}


// =========================================================
// RATING
// =========================================================

function getRating(score, confidence) {
  /*
    Confidence prevents us from calling
    a poorly researched stock EXCELLENT.
  */

  if (confidence < 40) {
    return "INSUFFICIENT_DATA";
  }

  if (score >= 85) return "EXCELLENT";
  if (score >= 70) return "GOOD";
  if (score >= 55) return "AVERAGE";

  return "WEAK";
}


// =========================================================
// ACTION
// =========================================================

function getAction(score, risk, confidence) {
  if (confidence < 40) {
    return "WAIT";
  }

  if (risk === "HIGH") {
    if (score >= 75) return "WATCH";
    return "REDUCE";
  }

  if (score >= 85) {
    return "BUY";
  }

  if (score >= 70) {
    return "HOLD";
  }

  if (score >= 55) {
    return "WATCH";
  }

  return "REDUCE";
}


// =========================================================
// DATA CONFIDENCE
// =========================================================

function calculateConfidence(f) {
  const fields = [
    f.sales_growth,
    f.profit_growth,
    f.roe,
    f.roce,
    f.debt_to_equity,
    f.promoter_holding,
    f.fii_holding,
    f.dii_holding,
    f.pe_ratio,
    f.pb_ratio,
    f.operating_cash_flow,
  ];

  const available = fields.filter(
    (value) =>
      value !== null &&
      value !== undefined
  ).length;

  return Math.round(
    (available / fields.length) * 100
  );
}


// =========================================================
// MAIN SCORING DISPATCHER
// =========================================================

function calculateSectorScore(f, securityType) {
  switch (securityType) {
    case "BANK":
      return scoreBank(f);

    case "FINANCIAL":
      return scoreFinancial(f);

    case "TECHNOLOGY":
      return scoreTechnology(f);

    case "DEFENCE":
      return scoreDefence(f);

    case "PHARMA_HEALTHCARE":
      return scorePharma(f);

    case "AUTOMOBILE":
      return scoreAutomobile(f);

    case "ENERGY":
    case "OIL_GAS":
      return scoreEnergy(f);

    case "METALS_MINING":
      return scoreMetals(f);

    case "CONSTRUCTION_INFRA":
      return scoreInfrastructure(f);

    case "CONSUMER":
      return scoreConsumer(f);

    case "CHEMICALS":
      return scoreChemicals(f);

    case "INDUSTRIAL":
      return scoreIndustrial(f);

    case "FUND":
      return {
        score: null,
        components: {},
        skipped: true,
        reason: "Funds are scored by the MF engine.",
      };

    default:
      return scoreStandardCompany(f);
  }
}


// =========================================================
// GET FUNDAMENTALS
// =========================================================

async function getFundamentals(supabase, instrumentId) {
  const { data, error } = await supabase
    .from("fundamentals")
    .select("*")
    .eq("instrument_id", instrumentId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Fundamentals lookup failed: ${error.message}`
    );
  }

  return data;
}


// =========================================================
// SAVE SCORE
// =========================================================

async function saveScore(
  supabase,
  instrumentId,
  result
) {
  /*
    Existing ai_scores table uses
    instrument_id as unique key.
  */

  const payload = {
    instrument_id: instrumentId,
    total_score: result.score,
    rating: result.rating,
    risk_level: result.risk,
    action: result.action,
    score_breakdown: result.components,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("ai_scores")
    .upsert(payload, {
      onConflict: "instrument_id",
    })
    .select()
    .single();

  if (error) {
    throw new Error(
      `Score save failed: ${error.message}`
    );
  }

  return data;
}


// =========================================================
// API
// =========================================================

export async function GET() {
  try {
    const supabase = getSupabase();

    // ---------------------------------------------
    // Load holdings
    // ---------------------------------------------

    const { data: holdings, error: holdingsError } =
      await supabase
        .from("holdings")
        .select("instrument_id");

    if (holdingsError) {
      throw new Error(
        `Failed to load holdings: ${holdingsError.message}`
      );
    }

    if (!holdings || holdings.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No holdings found.",
        summary: {
          holdings: 0,
          unique_instruments: 0,
          scored: 0,
          skipped: 0,
          errors: 0,
        },
      });
    }

    // ---------------------------------------------
    // Unique instruments
    // ---------------------------------------------

    const instrumentIds = [
      ...new Set(
        holdings
          .map((h) => h.instrument_id)
          .filter(Boolean)
      ),
    ];

    // ---------------------------------------------
    // Load instruments
    // ---------------------------------------------

    const { data: instruments, error: instrumentsError } =
      await supabase
        .from("instruments")
        .select(
          "id, symbol, company_name, sector, security_type"
        )
        .in("id", instrumentIds);

    if (instrumentsError) {
      throw new Error(
        `Failed to load instruments: ${instrumentsError.message}`
      );
    }

    const results = [];
    const skipped = [];
    const errors = [];

    let totalScore = 0;
    let scoredCount = 0;

    const actionCounts = {};
    const ratingCounts = {};
    const riskCounts = {};
    const sectorCounts = {};

    // ---------------------------------------------
    // Score each instrument
    // ---------------------------------------------

    for (const instrument of instruments || []) {
      try {
        const securityType =
          instrument.security_type || "OTHER";

        const sector =
          instrument.sector || "OTHER";

        // Funds handled by MF engine
        if (securityType === "FUND") {
          skipped.push({
            instrument_id: instrument.id,
            symbol: instrument.symbol,
            company_name: instrument.company_name,
            reason: "Fund — use MF scoring engine.",
          });

          continue;
        }

        const fundamentals =
          await getFundamentals(
            supabase,
            instrument.id
          );

        if (!fundamentals) {
          skipped.push({
            instrument_id: instrument.id,
            symbol: instrument.symbol,
            company_name: instrument.company_name,
            reason: "Fundamentals not available.",
          });

          continue;
        }

        const confidence =
          calculateConfidence(fundamentals);

        const sectorResult =
          calculateSectorScore(
            fundamentals,
            securityType
          );

        if (
          sectorResult.skipped ||
          sectorResult.score === null
        ) {
          skipped.push({
            instrument_id: instrument.id,
            symbol: instrument.symbol,
            company_name: instrument.company_name,
            reason:
              sectorResult.reason ||
              "Scoring skipped.",
          });

          continue;
        }

        const score = sectorResult.score;

        const risk =
          calculateRisk(
            fundamentals,
            securityType
          );

        const rating =
          getRating(
            score,
            confidence
          );

        const action =
          getAction(
            score,
            risk,
            confidence
          );

        const result = {
          instrument_id: instrument.id,
          symbol: instrument.symbol,
          company_name: instrument.company_name,
          security_type: securityType,
          sector,

          score,
          rating,
          risk,
          action,

          confidence,

          components:
            sectorResult.components,

          fundamentals_date:
            fundamentals.updated_at ||
            fundamentals.created_at ||
            null,
        };

        // -----------------------------------------
        // Save
        // -----------------------------------------

        const saved =
          await saveScore(
            supabase,
            instrument.id,
            result
          );

        results.push({
          ...result,
          saved_score_id: saved?.id || null,
        });

        // -----------------------------------------
        // Aggregates
        // -----------------------------------------

        totalScore += score;
        scoredCount++;

        actionCounts[action] =
          (actionCounts[action] || 0) + 1;

        ratingCounts[rating] =
          (ratingCounts[rating] || 0) + 1;

        riskCounts[risk] =
          (riskCounts[risk] || 0) + 1;

        sectorCounts[securityType] =
          (sectorCounts[securityType] || 0) + 1;
      } catch (error) {
        errors.push({
          instrument_id: instrument.id,
          symbol: instrument.symbol,
          company_name: instrument.company_name,
          error: error.message,
        });
      }
    }

    // ---------------------------------------------
    // Portfolio average
    // ---------------------------------------------

    const averageScore =
      scoredCount > 0
        ? Math.round(
            totalScore / scoredCount
          )
        : null;

    // ---------------------------------------------
    // Response
    // ---------------------------------------------

    return NextResponse.json({
      success: true,

      message:
        "Sector-specific portfolio scoring completed.",

      summary: {
        holdings: holdings.length,
        unique_instruments: instrumentIds.length,
        scored: scoredCount,
        skipped: skipped.length,
        errors: errors.length,

        average_score: averageScore,

        actions: actionCounts,
        ratings: ratingCounts,
        risks: riskCounts,
        sectors: sectorCounts,
      },

      results,
      skipped,
      errors,
    });
  } catch (error) {
    console.error(
      "Portfolio scoring error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error.message ||
          "Unknown scoring error.",
      },
      {
        status: 500,
      }
    );
  }
}
