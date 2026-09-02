import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================
// PORTFOLIO AI — SAFE V4
//
// Major changes from V3:
//
// 1. Missing metrics NEVER receive a perfect score.
// 2. Missing valuation is treated as N/A, not ignored silently.
// 3. Negative PE is NOT considered cheap.
// 4. Partial data receives an explicit penalty.
// 5. BUY requires sufficient confidence.
// 6. High-risk stocks are prevented from receiving extreme scores.
// 7. Sector-specific normalization retained.
// 8. Existing DB schema retained.
// 9. Mutual funds skipped.
// 10. No BharatStock API calls.
// ============================================================

const ENGINE_VERSION = "safe_v4";

// ============================================================
// HELPERS
// ============================================================

function num(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}

function average(values) {
  const valid = values.filter(
    (v) =>
      v !== null &&
      v !== undefined &&
      Number.isFinite(v)
  );

  if (!valid.length) {
    return null;
  }

  return (
    valid.reduce(
      (a, b) => a + b,
      0
    ) / valid.length
  );
}

function round(value, decimals = 1) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  const factor =
    10 ** decimals;

  return (
    Math.round(
      value * factor
    ) / factor
  );
}

// ============================================================
// SECTOR NORMALIZATION
// ============================================================

function normalizeSector(rawSector) {
  const s =
    String(
      rawSector || ""
    ).toUpperCase();

  if (s.includes("BANK")) {
    return "BANK";
  }

  if (
    s.includes("DEFENCE") ||
    s.includes("DEFENSE") ||
    s.includes("AEROSPACE")
  ) {
    return "DEFENCE";
  }

  if (
    s.includes("TECH") ||
    s.includes("SOFTWARE") ||
    s.includes("IT ")
  ) {
    return "TECHNOLOGY";
  }

  if (
    s.includes("PHARMA") ||
    s.includes("HEALTH") ||
    s.includes("HOSPITAL")
  ) {
    return "PHARMA_HEALTHCARE";
  }

  if (
    s.includes("CONSTRUCTION") ||
    s.includes("INFRA")
  ) {
    return "CONSTRUCTION_INFRA";
  }

  if (
    s.includes("AUTO") ||
    s.includes("AUTOMOBILE")
  ) {
    return "AUTOMOBILE";
  }

  if (
    s.includes("CONSUMER") ||
    s.includes("FMCG") ||
    s.includes("RETAIL") ||
    s.includes("JEWELL")
  ) {
    return "CONSUMER";
  }

  if (
    s.includes("CHEMICAL") ||
    s.includes("FERTILIZER")
  ) {
    return "CHEMICALS";
  }

  if (
    s.includes("POWER") ||
    s.includes("ENERGY") ||
    s.includes("RENEWABLE")
  ) {
    return "ENERGY";
  }

  if (
    s.includes("OIL") ||
    s.includes("GAS")
  ) {
    return "OIL_GAS";
  }

  if (
    s.includes("METAL") ||
    s.includes("MINING") ||
    s.includes("STEEL")
  ) {
    return "METALS_MINING";
  }

  if (
    s.includes("FINANCIAL") ||
    s.includes("FINANCE") ||
    s.includes("NBFC") ||
    s.includes("INSURANCE")
  ) {
    return "FINANCIAL";
  }

  if (
    s.includes("INDUSTRIAL") ||
    s.includes("ENGINEERING") ||
    s.includes("MANUFACTUR")
  ) {
    return "INDUSTRIAL";
  }

  return "OTHER";
}

// ============================================================
// FIELD ACCESS
// ============================================================

function getField(
  fundamentals,
  names
) {
  for (
    const name of names
  ) {
    const value =
      fundamentals?.[name];

    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      return num(value);
    }
  }

  return null;
}

// ============================================================
// GROWTH SCORE
// ============================================================

function growthScore(
  salesGrowth,
  profitGrowth
) {
  const scores = [];

  if (
    salesGrowth !== null
  ) {
    if (salesGrowth >= 25)
      scores.push(100);
    else if (salesGrowth >= 15)
      scores.push(90);
    else if (salesGrowth >= 10)
      scores.push(80);
    else if (salesGrowth >= 5)
      scores.push(65);
    else if (salesGrowth >= 0)
      scores.push(50);
    else if (salesGrowth >= -10)
      scores.push(30);
    else
      scores.push(10);
  }

  if (
    profitGrowth !== null
  ) {
    if (profitGrowth >= 30)
      scores.push(100);
    else if (profitGrowth >= 20)
      scores.push(95);
    else if (profitGrowth >= 10)
      scores.push(85);
    else if (profitGrowth >= 5)
      scores.push(70);
    else if (profitGrowth >= 0)
      scores.push(55);
    else if (profitGrowth >= -10)
      scores.push(35);
    else
      scores.push(10);
  }

  return average(scores);
}

// ============================================================
// PROFITABILITY SCORE
// ============================================================

function profitabilityScore(
  roe,
  roce
) {
  const scores = [];

  if (roe !== null) {
    if (roe >= 25)
      scores.push(100);
    else if (roe >= 20)
      scores.push(90);
    else if (roe >= 15)
      scores.push(80);
    else if (roe >= 10)
      scores.push(65);
    else if (roe >= 5)
      scores.push(45);
    else
      scores.push(20);
  }

  if (roce !== null) {
    if (roce >= 25)
      scores.push(100);
    else if (roce >= 20)
      scores.push(90);
    else if (roce >= 15)
      scores.push(80);
    else if (roce >= 10)
      scores.push(65);
    else if (roce >= 5)
      scores.push(45);
    else
      scores.push(20);
  }

  return average(scores);
}

// ============================================================
// BALANCE SHEET SCORE
// ============================================================

function balanceScore(
  debtEquity
) {
  if (
    debtEquity === null
  ) {
    return null;
  }

  if (debtEquity <= 0.1)
    return 100;

  if (debtEquity <= 0.25)
    return 90;

  if (debtEquity <= 0.5)
    return 80;

  if (debtEquity <= 0.75)
    return 70;

  if (debtEquity <= 1)
    return 55;

  if (debtEquity <= 1.5)
    return 40;

  if (debtEquity <= 2)
    return 25;

  return 10;
}

// ============================================================
// CASH FLOW SCORE
// ============================================================

function cashFlowScore(
  operatingCashFlow,
  marketCap
) {
  if (
    operatingCashFlow === null
  ) {
    return null;
  }

  // If market cap unavailable, evaluate direction only.
  if (
    marketCap === null ||
    marketCap <= 0
  ) {
    return (
      operatingCashFlow > 0
        ? 70
        : 25
    );
  }

  const cashToMarketCap =
    operatingCashFlow /
    marketCap;

  if (cashToMarketCap >= 0.12)
    return 100;

  if (cashToMarketCap >= 0.08)
    return 90;

  if (cashToMarketCap >= 0.05)
    return 80;

  if (cashToMarketCap >= 0.03)
    return 70;

  if (cashToMarketCap > 0)
    return 55;

  return 20;
}

// ============================================================
// OWNERSHIP SCORE
// ============================================================

function ownershipScore(
  promoter,
  fii,
  dii
) {
  const scores = [];

  if (
    promoter !== null
  ) {
    if (promoter >= 60)
      scores.push(100);
    else if (promoter >= 50)
      scores.push(90);
    else if (promoter >= 40)
      scores.push(80);
    else if (promoter >= 30)
      scores.push(65);
    else if (promoter >= 20)
      scores.push(50);
    else
      scores.push(35);
  }

  if (
    fii !== null
  ) {
    if (fii >= 20)
      scores.push(100);
    else if (fii >= 15)
      scores.push(90);
    else if (fii >= 10)
      scores.push(80);
    else if (fii >= 5)
      scores.push(65);
    else
      scores.push(50);
  }

  if (
    dii !== null
  ) {
    if (dii >= 20)
      scores.push(100);
    else if (dii >= 15)
      scores.push(90);
    else if (dii >= 10)
      scores.push(80);
    else if (dii >= 5)
      scores.push(65);
    else
      scores.push(50);
  }

  return average(scores);
}

// ============================================================
// VALUATION SCORE
//
// IMPORTANT:
// Negative PE is NOT cheap.
// Missing PE/PB = N/A.
// ============================================================

function valuationScore(
  pe,
  pb
) {
  const scores = [];

  // PE
  if (
    pe !== null &&
    pe > 0
  ) {
    if (pe <= 10)
      scores.push(100);
    else if (pe <= 15)
      scores.push(90);
    else if (pe <= 20)
      scores.push(80);
    else if (pe <= 25)
      scores.push(70);
    else if (pe <= 35)
      scores.push(55);
    else if (pe <= 50)
      scores.push(40);
    else if (pe <= 75)
      scores.push(25);
    else
      scores.push(10);
  }

  // PB
  if (
    pb !== null &&
    pb > 0
  ) {
    if (pb <= 1.5)
      scores.push(100);
    else if (pb <= 2.5)
      scores.push(90);
    else if (pb <= 4)
      scores.push(80);
    else if (pb <= 6)
      scores.push(65);
    else if (pb <= 10)
      scores.push(45);
    else if (pb <= 15)
      scores.push(30);
    else
      scores.push(15);
  }

  return average(scores);
}

// ============================================================
// RISK SCORE
//
// Higher = safer.
// ============================================================

function riskScore({
  debtEquity,
  profitGrowth,
  roe,
  pe,
  valuation,
  sector,
}) {
  const scores = [];

  // Debt
  if (
    debtEquity !== null
  ) {
    if (debtEquity <= 0.25)
      scores.push(95);
    else if (debtEquity <= 0.5)
      scores.push(85);
    else if (debtEquity <= 1)
      scores.push(70);
    else if (debtEquity <= 1.5)
      scores.push(50);
    else
      scores.push(25);
  }

  // Profit deterioration
  if (
    profitGrowth !== null
  ) {
    if (profitGrowth >= 10)
      scores.push(90);
    else if (profitGrowth >= 0)
      scores.push(75);
    else if (profitGrowth >= -10)
      scores.push(50);
    else if (profitGrowth >= -25)
      scores.push(30);
    else
      scores.push(15);
  }

  // ROE
  if (
    roe !== null
  ) {
    if (roe >= 20)
      scores.push(90);
    else if (roe >= 15)
      scores.push(80);
    else if (roe >= 10)
      scores.push(65);
    else if (roe >= 5)
      scores.push(45);
    else
      scores.push(25);
  }

  // Valuation risk
  if (
    pe !== null
  ) {
    if (pe <= 20 && pe > 0)
      scores.push(90);
    else if (pe <= 35 && pe > 0)
      scores.push(70);
    else if (pe <= 50 && pe > 0)
      scores.push(50);
    else if (pe > 50)
      scores.push(25);
    else
      scores.push(30);
  }

  // Sector risk
  if (
    sector === "BANK" ||
    sector === "FINANCIAL"
  ) {
    // Financial companies receive a modest risk haircut
    // until sector-specific metrics are available.
    scores.push(65);
  }

  if (
    sector === "OTHER"
  ) {
    scores.push(55);
  }

  const result =
    average(scores);

  return result;
}

// ============================================================
// COMPLETENESS
// ============================================================

function calculateCompleteness({
  sector,
  salesGrowth,
  profitGrowth,
  roe,
  roce,
  debtEquity,
  operatingCashFlow,
  promoter,
  fii,
  dii,
  pe,
  pb,
}) {
  let fields = [];

  if (
    sector === "BANK"
  ) {
    fields = [
      salesGrowth,
      profitGrowth,
      roe,
      debtEquity,
      promoter,
      fii,
      dii,
      pe,
      pb,
    ];
  } else {
    fields = [
      salesGrowth,
      profitGrowth,
      roe,
      roce,
      debtEquity,
      operatingCashFlow,
      promoter,
      fii,
      dii,
      pe,
      pb,
    ];
  }

  const available =
    fields.filter(
      (value) =>
        value !== null
    ).length;

  return round(
    (
      available /
      fields.length
    ) * 100
  );
}

// ============================================================
// DATA CONFIDENCE
// ============================================================

function confidenceFromCompleteness(
  completeness
) {
  if (
    completeness === null
  ) {
    return 0;
  }

  if (
    completeness < 30
  ) {
    return 0;
  }

  if (
    completeness < 50
  ) {
    return 40;
  }

  if (
    completeness < 60
  ) {
    return 50;
  }

  if (
    completeness < 70
  ) {
    return 60;
  }

  if (
    completeness < 80
  ) {
    return 69;
  }

  if (
    completeness < 90
  ) {
    return 80;
  }

  return 100;
}

// ============================================================
// SECTOR WEIGHTS
// ============================================================

function getWeights(
  sector
) {
  switch (sector) {
    case "BANK":
      return {
        growth: 0.18,
        profitability: 0.20,
        balance: 0.17,
        cash: 0.05,
        ownership: 0.10,
        valuation: 0.15,
        risk: 0.15,
      };

    case "TECHNOLOGY":
      return {
        growth: 0.22,
        profitability: 0.22,
        balance: 0.12,
        cash: 0.12,
        ownership: 0.08,
        valuation: 0.14,
        risk: 0.10,
      };

    case "PHARMA_HEALTHCARE":
      return {
        growth: 0.20,
        profitability: 0.20,
        balance: 0.15,
        cash: 0.12,
        ownership: 0.08,
        valuation: 0.15,
        risk: 0.10,
      };

    case "DEFENCE":
      return {
        growth: 0.22,
        profitability: 0.20,
        balance: 0.14,
        cash: 0.10,
        ownership: 0.09,
        valuation: 0.15,
        risk: 0.10,
      };

    case "AUTOMOBILE":
      return {
        growth: 0.18,
        profitability: 0.20,
        balance: 0.15,
        cash: 0.12,
        ownership: 0.08,
        valuation: 0.17,
        risk: 0.10,
      };

    case "CONSTRUCTION_INFRA":
      return {
        growth: 0.20,
        profitability: 0.18,
        balance: 0.17,
        cash: 0.10,
        ownership: 0.10,
        valuation: 0.15,
        risk: 0.10,
      };

    case "ENERGY":
      return {
        growth: 0.18,
        profitability: 0.18,
        balance: 0.17,
        cash: 0.12,
        ownership: 0.10,
        valuation: 0.15,
        risk: 0.10,
      };

    case "METALS_MINING":
      return {
        growth: 0.18,
        profitability: 0.18,
        balance: 0.18,
        cash: 0.12,
        ownership: 0.08,
        valuation: 0.16,
        risk: 0.10,
      };

    case "CHEMICALS":
      return {
        growth: 0.20,
        profitability: 0.20,
        balance: 0.15,
        cash: 0.12,
        ownership: 0.08,
        valuation: 0.15,
        risk: 0.10,
      };

    case "CONSUMER":
      return {
        growth: 0.18,
        profitability: 0.22,
        balance: 0.15,
        cash: 0.12,
        ownership: 0.08,
        valuation: 0.15,
        risk: 0.10,
      };

    case "FINANCIAL":
      return {
        growth: 0.18,
        profitability: 0.20,
        balance: 0.17,
        cash: 0.05,
        ownership: 0.10,
        valuation: 0.15,
        risk: 0.15,
      };

    case "INDUSTRIAL":
      return {
        growth: 0.18,
        profitability: 0.20,
        balance: 0.17,
        cash: 0.12,
        ownership: 0.08,
        valuation: 0.15,
        risk: 0.10,
      };

    default:
      return {
        growth: 0.18,
        profitability: 0.18,
        balance: 0.16,
        cash: 0.12,
        ownership: 0.08,
        valuation: 0.15,
        risk: 0.13,
      };
  }
}

// ============================================================
// COMPONENT CALCULATION
// ============================================================

function calculateFinalScore({
  weights,
  growth,
  profitability,
  balance,
  cash,
  ownership,
  valuation,
  risk,
}) {
  const components = [
    {
      name: "growth",
      value: growth,
      weight: weights.growth,
    },
    {
      name: "profitability",
      value: profitability,
      weight: weights.profitability,
    },
    {
      name: "balance",
      value: balance,
      weight: weights.balance,
    },
    {
      name: "cash",
      value: cash,
      weight: weights.cash,
    },
    {
      name: "ownership",
      value: ownership,
      weight: weights.ownership,
    },
    {
      name: "valuation",
      value: valuation,
      weight: weights.valuation,
    },
    {
      name: "risk",
      value: risk,
      weight: weights.risk,
    },
  ];

  let weightedTotal = 0;
  let usedWeight = 0;

  for (
    const component of components
  ) {
    if (
      component.value === null
    ) {
      continue;
    }

    weightedTotal +=
      component.value *
      component.weight;

    usedWeight +=
      component.weight;
  }

  if (
    usedWeight === 0
  ) {
    return null;
  }

  // ----------------------------------------------------------
  // IMPORTANT:
  // Missing components are NOT allowed to inflate the score.
  //
  // Instead of simply renormalizing missing weights to 100,
  // we apply a coverage penalty.
  // ----------------------------------------------------------

  const rawScore =
    weightedTotal /
    usedWeight;

  const coverage =
    usedWeight;

  const coveragePenalty =
    0.65 +
    0.35 * coverage;

  const adjustedScore =
    rawScore *
    coveragePenalty;

  return clamp(
    round(adjustedScore)
  );
}

// ============================================================
// RATING
// ============================================================

function getRating(
  score,
  confidence
) {
  if (
    score === null
  ) {
    return "INSUFFICIENT_DATA";
  }

  if (
    confidence !== null &&
    confidence < 50
  ) {
    return "PROVISIONAL";
  }

  if (score >= 90)
    return "EXCEPTIONAL";

  if (score >= 80)
    return "STRONG";

  if (score >= 70)
    return "GOOD";

  if (score >= 60)
    return "AVERAGE";

  if (score >= 50)
    return "WEAK";

  return "POOR";
}

// ============================================================
// RISK LABEL
// ============================================================

function getRiskLevel(
  risk,
  completeness
) {
  if (
    completeness !== null &&
    completeness < 50
  ) {
    return "HIGH";
  }

  if (
    risk === null
  ) {
    return "HIGH";
  }

  if (risk >= 75)
    return "LOW";

  if (risk >= 55)
    return "MODERATE";

  return "HIGH";
}

// ============================================================
// ACTION ENGINE
// ============================================================

function getAction({
  score,
  confidence,
  completeness,
  risk,
  valuation,
}) {
  // ----------------------------------------------------------
  // No score
  // ----------------------------------------------------------

  if (
    score === null
  ) {
    return "WAIT";
  }

  // ----------------------------------------------------------
  // Very incomplete
  // ----------------------------------------------------------

  if (
    completeness < 30
  ) {
    return "WAIT";
  }

  // ----------------------------------------------------------
  // Provisional data
  // ----------------------------------------------------------

  if (
    completeness < 50 ||
    confidence < 50
  ) {
    if (
      score >= 70
    ) {
      return "WATCH";
    }

    return "WAIT";
  }

  // ----------------------------------------------------------
  // High risk prevents aggressive BUY
  // ----------------------------------------------------------

  if (
    risk !== null &&
    risk < 45
  ) {
    if (
      score >= 70
    ) {
      return "WATCH";
    }

    return "REDUCE";
  }

  // ----------------------------------------------------------
  // BUY requires valuation
  // ----------------------------------------------------------

  if (
    score >= 85 &&
    confidence >= 80 &&
    completeness >= 80 &&
    valuation !== null &&
    valuation >= 45 &&
    risk >= 55
  ) {
    return "BUY";
  }

  // ----------------------------------------------------------
  // Strong score but insufficient valuation
  // ----------------------------------------------------------

  if (
    score >= 80
  ) {
    return "WATCH";
  }

  // ----------------------------------------------------------
  // Good
  // ----------------------------------------------------------

  if (
    score >= 70
  ) {
    return "HOLD";
  }

  // ----------------------------------------------------------
  // Average
  // ----------------------------------------------------------

  if (
    score >= 60
  ) {
    return "WATCH";
  }

  // ----------------------------------------------------------
  // Weak
  // ----------------------------------------------------------

  if (
    score >= 50
  ) {
    return "REDUCE";
  }

  return "REDUCE";
}

// ============================================================
// DATA REASONS
// ============================================================

function buildNotes({
  sector,
  completeness,
  confidence,
  valuation,
  pe,
  pb,
  growth,
  profitability,
  risk,
}) {
  const notes = [];

  if (
    completeness < 80
  ) {
    notes.push(
      `Fundamental data completeness is ${completeness}%.`
    );
  }

  if (
    confidence < 80
  ) {
    notes.push(
      `Confidence is limited to ${confidence}%.`
    );
  }

  if (
    valuation === null
  ) {
    notes.push(
      "Valuation is unavailable and therefore cannot support a BUY decision."
    );
  }

  if (
    pe !== null &&
    pe <= 0
  ) {
    notes.push(
      "PE is non-positive; valuation is not treated as cheap on PE."
    );
  }

  if (
    pb !== null &&
    pb <= 0
  ) {
    notes.push(
      "PB is non-positive and is excluded from valuation scoring."
    );
  }

  if (
    growth !== null &&
    growth >= 80
  ) {
    notes.push(
      "Growth metrics are strong."
    );
  }

  if (
    profitability !== null &&
    profitability >= 80
  ) {
    notes.push(
      "Profitability metrics are strong."
    );
  }

  if (
    risk !== null &&
    risk < 55
  ) {
    notes.push(
      "Risk profile is elevated."
    );
  }

  if (
    sector === "OTHER"
  ) {
    notes.push(
      "Sector remains unclassified; sector-specific weighting is limited."
    );
  }

  return notes;
}

// ============================================================
// MAIN
// ============================================================

export async function GET() {
  try {
    // ========================================================
    // 1. HOLDINGS
    // ========================================================

    const {
      data: holdings,
      error: holdingsError,
    } = await supabase
      .from("holdings")
      .select(
        "instrument_id"
      );

    if (holdingsError) {
      throw new Error(
        `Holdings query failed: ${holdingsError.message}`
      );
    }

    const instrumentIds = [
      ...new Set(
        (holdings || [])
          .map(
            (h) =>
              h.instrument_id
          )
          .filter(Boolean)
      ),
    ];

    if (
      instrumentIds.length === 0
    ) {
      return NextResponse.json({
        success: true,
        engine_version:
          ENGINE_VERSION,
        message:
          "No holdings found.",
        scored: 0,
      });
    }

    // ========================================================
    // 2. INSTRUMENTS
    // ========================================================

    const {
      data: instruments,
      error: instrumentsError,
    } = await supabase
      .from("instruments")
      .select(`
        id,
        symbol,
        company_name,
        sector
      `)
      .in(
        "id",
        instrumentIds
      );

    if (instrumentsError) {
      throw new Error(
        `Instruments query failed: ${instrumentsError.message}`
      );
    }

    // ========================================================
    // 3. FUNDAMENTALS
    // ========================================================

    const {
      data: fundamentals,
      error: fundamentalsError,
    } = await supabase
      .from("fundamentals")
      .select("*")
      .in(
        "instrument_id",
        instrumentIds
      );

    if (fundamentalsError) {
      throw new Error(
        `Fundamentals query failed: ${fundamentalsError.message}`
      );
    }

    const instrumentMap =
      new Map(
        (instruments || []).map(
          (item) => [
            item.id,
            item,
          ]
        )
      );

    const fundamentalsMap =
      new Map(
        (fundamentals || []).map(
          (item) => [
            item.instrument_id,
            item,
          ]
        )
      );

    // ========================================================
    // 4. EXISTING AI SCORES
    // ========================================================

    const {
      data: existingScores,
      error: existingScoresError,
    } = await supabase
      .from("ai_scores")
      .select(
        "instrument_id"
      )
      .in(
        "instrument_id",
        instrumentIds
      );

    if (existingScoresError) {
      throw new Error(
        `AI scores query failed: ${existingScoresError.message}`
      );
    }

    const existingScoreIds =
      new Set(
        (existingScores || [])
          .map(
            (item) =>
              item.instrument_id
          )
      );

    // ========================================================
    // 5. PROCESS
    // ========================================================

    const results = [];

    let scored = 0;
    let provisional = 0;
    let blocked = 0;
    let skippedFunds = 0;
    let errors = 0;

    for (
      const instrumentId of instrumentIds
    ) {
      try {
        const instrument =
          instrumentMap.get(
            instrumentId
          );

        if (!instrument) {
          continue;
        }

        const rawSector =
          instrument.sector ||
          "";

        const sector =
          normalizeSector(
            rawSector
          );

        // ----------------------------------------------------
        // Mutual funds
        // ----------------------------------------------------

        if (
          sector === "FUND" ||
          String(
            rawSector
          )
            .toUpperCase()
            .includes("MUTUAL")
        ) {
          skippedFunds++;

          results.push({
            instrument_id:
              instrumentId,

            symbol:
              instrument.symbol,

            company_name:
              instrument.company_name,

            status:
              "SKIPPED_FUND",
          });

          continue;
        }

        const f =
          fundamentalsMap.get(
            instrumentId
          ) || {};

        // ----------------------------------------------------
        // Fundamentals
        // ----------------------------------------------------

        const salesGrowth =
          getField(
            f,
            [
              "sales_growth",
              "revenue_growth",
              "sales_growth_yoy",
            ]
          );

        const profitGrowth =
          getField(
            f,
            [
              "profit_growth",
              "profit_growth_yoy",
              "net_profit_growth",
            ]
          );

        const roe =
          getField(
            f,
            [
              "roe",
              "return_on_equity",
            ]
          );

        const roce =
          getField(
            f,
            [
              "roce",
              "return_on_capital_employed",
            ]
          );

        const debtEquity =
          getField(
            f,
            [
              "debt_to_equity",
              "debt_equity",
              "debt_equity_ratio",
            ]
          );

        const operatingCashFlow =
          getField(
            f,
            [
              "operating_cash_flow",
              "ocf",
              "cash_from_operations",
            ]
          );

        const promoter =
          getField(
            f,
            [
              "promoter_holding",
              "promoter",
              "promoter_percentage",
            ]
          );

        const fii =
          getField(
            f,
            [
              "fii_holding",
              "fii",
              "fii_percentage",
            ]
          );

        const dii =
          getField(
            f,
            [
              "dii_holding",
              "dii",
              "dii_percentage",
            ]
          );

        const pe =
          getField(
            f,
            [
              "pe_ratio",
              "pe",
            ]
          );

        const pb =
          getField(
            f,
            [
              "pb_ratio",
              "pb",
            ]
          );

        const marketCap =
          getField(
            f,
            [
              "market_cap",
            ]
          );

        // ----------------------------------------------------
        // Component scores
        // ----------------------------------------------------

        const growth =
          growthScore(
            salesGrowth,
            profitGrowth
          );

        const profitability =
          profitabilityScore(
            roe,
            roce
          );

        const balance =
          balanceScore(
            debtEquity
          );

        const cash =
          cashFlowScore(
            operatingCashFlow,
            marketCap
          );

        const ownership =
          ownershipScore(
            promoter,
            fii,
            dii
          );

        const valuation =
          valuationScore(
            pe,
            pb
          );

        const risk =
          riskScore({
            debtEquity,
            profitGrowth,
            roe,
            pe,
            valuation,
            sector,
          });

        // ----------------------------------------------------
        // Completeness
        // ----------------------------------------------------

        const completeness =
          calculateCompleteness({
            sector,
            salesGrowth,
            profitGrowth,
            roe,
            roce,
            debtEquity,
            operatingCashFlow,
            promoter,
            fii,
            dii,
            pe,
            pb,
          });

        const confidence =
          confidenceFromCompleteness(
            completeness
          );

        // ----------------------------------------------------
        // BLOCK
        // ----------------------------------------------------

        if (
          completeness < 30
        ) {
          blocked++;

          results.push({
            instrument_id:
              instrumentId,

            symbol:
              instrument.symbol,

            company_name:
              instrument.company_name,

            raw_sector:
              rawSector,

            normalized_sector:
              sector,

            status:
              "BLOCKED",

            total_score:
              null,

            rating:
              "INSUFFICIENT_DATA",

            action:
              "WAIT",

            risk_level:
              "HIGH",

            score_breakdown: {
              engine:
                ENGINE_VERSION,

              data_status:
                "BLOCKED",

              score_available:
                false,

              data_completeness:
                completeness,

              confidence,

              raw_sector:
                rawSector,

              normalized_sector:
                sector,

              reason:
                "Fundamental data completeness is below 30%.",
            },
          });

          continue;
        }

        // ----------------------------------------------------
        // Weights
        // ----------------------------------------------------

        const weights =
          getWeights(
            sector
          );

        // ----------------------------------------------------
        // Final score
        // ----------------------------------------------------

        let totalScore =
          calculateFinalScore({
            weights,

            growth,

            profitability,

            balance,

            cash,

            ownership,

            valuation,

            risk,
          });

        // ----------------------------------------------------
        // Confidence adjustment
        //
        // V4 deliberately applies an additional ceiling.
        // ----------------------------------------------------

        if (
          totalScore !== null
        ) {
          if (
            confidence < 50
          ) {
            totalScore =
              Math.min(
                totalScore,
                69
              );
          }

          else if (
            confidence < 60
          ) {
            totalScore =
              Math.min(
                totalScore,
                74
              );
          }

          else if (
            confidence < 70
          ) {
            totalScore =
              Math.min(
                totalScore,
                79
              );
          }

          else if (
            confidence < 80
          ) {
            totalScore =
              Math.min(
                totalScore,
                84
              );
          }
        }

        // ----------------------------------------------------
        // Risk adjustment
        //
        // High risk should materially constrain score.
        // ----------------------------------------------------

        if (
          totalScore !== null &&
          risk !== null
        ) {
          if (
            risk < 40
          ) {
            totalScore =
              Math.min(
                totalScore,
                64
              );
          }

          else if (
            risk < 50
          ) {
            totalScore =
              Math.min(
                totalScore,
                69
              );
          }

          else if (
            risk < 60
          ) {
            totalScore =
              Math.min(
                totalScore,
                79
              );
          }
        }

        totalScore =
          totalScore === null
            ? null
            : clamp(
                round(
                  totalScore
                )
              );

        // ----------------------------------------------------
        // Status
        // ----------------------------------------------------

        let dataStatus =
          "COMPLETE";

        if (
          completeness < 50
        ) {
          dataStatus =
            "PROVISIONAL";

          provisional++;
        }

        else if (
          completeness < 80
        ) {
          dataStatus =
            "PARTIAL";
        }

        else {
          scored++;
        }

        // ----------------------------------------------------
        // Risk
        // ----------------------------------------------------

        const riskLevel =
          getRiskLevel(
            risk,
            completeness
          );

        // ----------------------------------------------------
        // Action
        // ----------------------------------------------------

        const action =
          getAction({
            score:
              totalScore,

            confidence,

            completeness,

            risk,

            valuation,
          });

        // ----------------------------------------------------
        // Rating
        // ----------------------------------------------------

        const rating =
          getRating(
            totalScore,
            confidence
          );

        // ----------------------------------------------------
        // Notes
        // ----------------------------------------------------

        const notes =
          buildNotes({
            sector,

            completeness,

            confidence,

            valuation,

            pe,

            pb,

            growth,

            profitability,

            risk,
          });

        // ----------------------------------------------------
        // Diagnostics
        // ----------------------------------------------------

        const diagnostics = [];

        if (
          completeness < 80
        ) {
          diagnostics.push(
            "PARTIAL_DATA"
          );
        }

        if (
          confidence < 80
        ) {
          diagnostics.push(
            "LOW_CONFIDENCE"
          );
        }

        if (
          valuation === null
        ) {
          diagnostics.push(
            "VALUATION_MISSING"
          );
        }

        if (
          pe !== null &&
          pe <= 0
        ) {
          diagnostics.push(
            "NON_POSITIVE_PE"
          );
        }

        if (
          riskLevel === "HIGH"
        ) {
          diagnostics.push(
            "HIGH_RISK"
          );
        }

        if (
          sector === "OTHER"
        ) {
          diagnostics.push(
            "SECTOR_UNCLASSIFIED"
          );
        }

        if (
          totalScore !== null &&
          totalScore >= 85 &&
          confidence < 80
        ) {
          diagnostics.push(
            "HIGH_SCORE_LOW_CONFIDENCE"
          );
        }

        if (
          action === "BUY" &&
          (
            confidence < 80 ||
            valuation === null
          )
        ) {
          diagnostics.push(
            "BUY_REVIEW_REQUIRED"
          );
        }

        // ----------------------------------------------------
        // Score breakdown
        // ----------------------------------------------------

        const scoreBreakdown = {
          engine:
            ENGINE_VERSION,

          raw_sector:
            rawSector,

          normalized_sector:
            sector,

          data_status:
            dataStatus,

          score_available:
            true,

          data_completeness:
            completeness,

          confidence,

          components: {
            growth:
              growth,

            profitability:
              profitability,

            balance:
              balance,

            cash:
              cash,

            ownership:
              ownership,

            valuation:
              valuation,

            risk:
              risk,
          },

          valuation: {
            pe:
              pe,

            pb:
              pb,

            valuation_score:
              valuation,
          },

          weights,

          raw_inputs: {
            sales_growth:
              salesGrowth,

            profit_growth:
              profitGrowth,

            roe,

            roce,

            debt_equity:
              debtEquity,

            operating_cash_flow:
              operatingCashFlow,

            promoter,

            fii,

            dii,

            pe,

            pb,
          },

          diagnostics,

          notes,

          rules: {
            missing_metrics:
              "Missing metrics are never awarded a perfect score.",

            missing_valuation:
              "Missing valuation is N/A and reduces score coverage.",

            negative_pe:
              "Negative or zero PE is not treated as cheap.",

            partial_data:
              "Partial data is explicitly penalized.",

            buy_rule:
              "BUY requires score >=85, confidence >=80, completeness >=80, valuation available and acceptable risk.",

            risk_rule:
              "High risk constrains the maximum score.",

            confidence_rule:
              "Confidence ceilings prevent incomplete datasets from producing extreme scores.",
          },
        };

        // ----------------------------------------------------
        // UPSERT AI SCORE
        // ----------------------------------------------------

        const payload = {
          instrument_id:
            instrumentId,

          total_score:
            totalScore,

          rating,

          action,

          risk_level:
            riskLevel,

          score_breakdown:
            scoreBreakdown,

          updated_at:
            new Date().toISOString(),
        };

        const {
          error: upsertError,
        } = await supabase
          .from("ai_scores")
          .upsert(
            payload,
            {
              onConflict:
                "instrument_id",
            }
          );

        if (
          upsertError
        ) {
          throw new Error(
            `AI score upsert failed: ${upsertError.message}`
          );
        }

        results.push({
          instrument_id:
            instrumentId,

          symbol:
            instrument.symbol,

          company_name:
            instrument.company_name,

          raw_sector:
            rawSector,

          normalized_sector:
            sector,

          status:
            dataStatus,

          total_score:
            totalScore,

          rating,

          action,

          risk_level:
            riskLevel,

          completeness,

          confidence,

          components: {
            growth,
            profitability,
            balance,
            cash,
            ownership,
            valuation,
            risk,
          },

          diagnostics,

          valuation: {
            pe,
            pb,
            score:
              valuation,
          },
        });

      } catch (instrumentError) {
        errors++;

        results.push({
          instrument_id:
            instrumentId,

          status:
            "ERROR",

          error:
            instrumentError?.message ||
            "Unknown instrument error",
        });
      }
    }

    // ========================================================
    // SUMMARY
    // ========================================================

    const scoredResults =
      results.filter(
        (item) =>
          item.total_score !==
            null &&
          item.total_score !==
            undefined
      );

    const averageScore =
      scoredResults.length
        ? round(
            average(
              scoredResults.map(
                (item) =>
                  item.total_score
              )
            ),
            2
          )
        : null;

    const actionCounts = {};

    for (
      const item of results
    ) {
      if (
        !item.action
      ) {
        continue;
      }

      actionCounts[
        item.action
      ] =
        (
          actionCounts[
            item.action
          ] || 0
        ) + 1;
    }

    const ratingCounts = {};

    for (
      const item of results
    ) {
      if (
        !item.rating
      ) {
        continue;
      }

      ratingCounts[
        item.rating
      ] =
        (
          ratingCounts[
            item.rating
          ] || 0
        ) + 1;
    }

    const riskCounts = {};

    for (
      const item of results
    ) {
      if (
        !item.risk_level
      ) {
        continue;
      }

      riskCounts[
        item.risk_level
      ] =
        (
          riskCounts[
            item.risk_level
          ] || 0
        ) + 1;
    }

    const buyCandidates =
      results.filter(
        (item) =>
          item.action ===
          "BUY"
      );

    const highScores =
      results.filter(
        (item) =>
          item.total_score !==
            null &&
          item.total_score >=
            85
      );

    const highScoreReview =
      results.filter(
        (item) =>
          item.total_score !==
            null &&
          item.total_score >=
            85 &&
          (
            item.confidence <
              80 ||
            item.completeness <
              80 ||
            item.diagnostics?.includes(
              "VALUATION_MISSING"
            )
          )
      );

    // ========================================================
    // FINAL RESPONSE
    // ========================================================

    return NextResponse.json({
      success:
        true,

      engine_version:
        ENGINE_VERSION,

      holdings:
        holdings?.length || 0,

      unique_instruments:
        instrumentIds.length,

      scored:
        scoredResults.length,

      provisional,

      blocked,

      skipped_funds:
        skippedFunds,

      errors,

      average_score:
        averageScore,

      action_counts:
        actionCounts,

      rating_counts:
        ratingCounts,

      risk_counts:
        riskCounts,

      buy_candidates:
        buyCandidates.length,

      high_score_count:
        highScores.length,

      high_score_review_count:
        highScoreReview.length,

      high_score_review:
        highScoreReview,

      results,
    });

  } catch (error) {
    console.error(
      "Portfolio AI V4 error:",
      error
    );

    return NextResponse.json(
      {
        success:
          false,

        engine_version:
          ENGINE_VERSION,

        error:
          error?.message ||
          "Unknown error",
      },
      {
        status:
          500,
      }
    );
  }
}
