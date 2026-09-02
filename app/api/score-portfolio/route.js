import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================================================
   HELPERS
========================================================= */

function clamp(value, min = 0, max = 100) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return null;
  }

  return Math.max(min, Math.min(max, Number(value)));
}

function num(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function average(values) {
  const valid = values.filter((v) => v !== null && v !== undefined);

  if (!valid.length) return null;

  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function weightedScore(components, weights) {
  let total = 0;
  let weightUsed = 0;

  for (const key of Object.keys(weights)) {
    const value = components[key];

    if (value === null || value === undefined) continue;

    total += value * weights[key];
    weightUsed += weights[key];
  }

  if (!weightUsed) return 0;

  return total / weightUsed;
}

function confidenceScore(components) {
  const values = Object.values(components);

  if (!values.length) return 0;

  const available = values.filter(
    (value) => value !== null && value !== undefined
  ).length;

  return Math.round((available / values.length) * 100);
}

/* =========================================================
   COMMON SCORING FUNCTIONS
========================================================= */

function growthScore(f) {
  const sales = num(f.sales_growth);
  const profit = num(f.profit_growth);

  const salesScore =
    sales === null
      ? null
      : sales >= 25
      ? 100
      : sales >= 15
      ? 90
      : sales >= 10
      ? 80
      : sales >= 5
      ? 65
      : sales >= 0
      ? 50
      : 20;

  const profitScore =
    profit === null
      ? null
      : profit >= 30
      ? 100
      : profit >= 20
      ? 90
      : profit >= 10
      ? 80
      : profit >= 0
      ? 60
      : profit >= -10
      ? 35
      : 10;

  return average([salesScore, profitScore]);
}

function profitabilityScore(f) {
  const roe = num(f.roe);
  const roce = num(f.roce);

  const roeScore =
    roe === null
      ? null
      : roe >= 25
      ? 100
      : roe >= 20
      ? 90
      : roe >= 15
      ? 80
      : roe >= 10
      ? 65
      : roe >= 5
      ? 45
      : 20;

  const roceScore =
    roce === null
      ? null
      : roce >= 25
      ? 100
      : roce >= 20
      ? 90
      : roce >= 15
      ? 80
      : roce >= 10
      ? 65
      : roce >= 5
      ? 45
      : 20;

  return average([roeScore, roceScore]);
}

function debtScore(f) {
  const debt = num(f.debt_to_equity);

  if (debt === null) return null;

  if (debt === 0) return 100;
  if (debt <= 0.25) return 95;
  if (debt <= 0.5) return 85;
  if (debt <= 1) return 75;
  if (debt <= 1.5) return 60;
  if (debt <= 2) return 40;
  if (debt <= 3) return 25;

  return 10;
}

function ownershipScore(f) {
  const promoter = num(f.promoter_holding);
  const fii = num(f.fii_holding);
  const dii = num(f.dii_holding);

  const promoterScore =
    promoter === null
      ? null
      : promoter >= 60
      ? 100
      : promoter >= 50
      ? 90
      : promoter >= 40
      ? 75
      : promoter >= 30
      ? 55
      : 30;

  const fiiScore =
    fii === null
      ? null
      : fii >= 25
      ? 100
      : fii >= 15
      ? 90
      : fii >= 10
      ? 75
      : fii >= 5
      ? 60
      : 40;

  const diiScore =
    dii === null
      ? null
      : dii >= 25
      ? 100
      : dii >= 15
      ? 90
      : dii >= 10
      ? 80
      : dii >= 5
      ? 65
      : 45;

  return average([promoterScore, fiiScore, diiScore]);
}

function valuationScore(f) {
  const pe = num(f.pe_ratio);
  const pb = num(f.pb_ratio);

  const peScore =
    pe === null
      ? null
      : pe <= 10
      ? 100
      : pe <= 15
      ? 90
      : pe <= 20
      ? 80
      : pe <= 25
      ? 70
      : pe <= 35
      ? 55
      : pe <= 50
      ? 35
      : 20;

  const pbScore =
    pb === null
      ? null
      : pb <= 1
      ? 100
      : pb <= 2
      ? 90
      : pb <= 3
      ? 75
      : pb <= 5
      ? 60
      : pb <= 8
      ? 40
      : 20;

  return average([peScore, pbScore]);
}

function cashFlowScore(f) {
  const ocf = num(f.operating_cash_flow);

  if (ocf === null) return null;

  if (ocf > 0) return 80;

  return 10;
}

/* =========================================================
   BANK MODEL
========================================================= */

/*
   Banks should NOT be scored like normal companies.

   Bank score:
   Growth          20%
   Profitability   25%
   Asset quality   20%
   Capital         15%
   Valuation       10%
   Ownership       10%

   Some BharatStock responses may not currently contain
   every banking-specific metric. Therefore missing metrics
   reduce confidence rather than automatically destroying
   the score.
*/

function bankGrowthScore(f) {
  const salesGrowth = num(f.sales_growth);
  const profitGrowth = num(f.profit_growth);

  const growthValues = [];

  if (salesGrowth !== null) {
    growthValues.push(
      salesGrowth >= 20
        ? 100
        : salesGrowth >= 15
        ? 90
        : salesGrowth >= 10
        ? 80
        : salesGrowth >= 5
        ? 65
        : salesGrowth >= 0
        ? 50
        : 20
    );
  }

  if (profitGrowth !== null) {
    growthValues.push(
      profitGrowth >= 25
        ? 100
        : profitGrowth >= 15
        ? 90
        : profitGrowth >= 10
        ? 80
        : profitGrowth >= 0
        ? 60
        : profitGrowth >= -10
        ? 35
        : 10
    );
  }

  return average(growthValues);
}

function bankProfitabilityScore(f) {
  /*
     ROE is particularly important for banks.
     ROCE is intentionally not required because it is
     less meaningful for banks than for industrial companies.
  */

  const roe = num(f.roe);
  const roa = num(f.roa);

  const scores = [];

  if (roe !== null) {
    scores.push(
      roe >= 18
        ? 100
        : roe >= 15
        ? 90
        : roe >= 12
        ? 80
        : roe >= 10
        ? 70
        : roe >= 7
        ? 55
        : roe >= 4
        ? 35
        : 15
    );
  }

  if (roa !== null) {
    scores.push(
      roa >= 2
        ? 100
        : roa >= 1.5
        ? 90
        : roa >= 1.2
        ? 80
        : roa >= 1
        ? 70
        : roa >= 0.5
        ? 50
        : 25
    );
  }

  return average(scores);
}

function bankAssetQualityScore(f) {
  /*
     Supported if these fields become available from
     BharatStock or another fundamentals source.

     Lower NPA = better.
  */

  const gnpa = num(f.gross_npa);
  const nnpa = num(f.net_npa);

  const scores = [];

  if (gnpa !== null) {
    scores.push(
      gnpa <= 1
        ? 100
        : gnpa <= 2
        ? 90
        : gnpa <= 3
        ? 75
        : gnpa <= 5
        ? 55
        : gnpa <= 8
        ? 30
        : 10
    );
  }

  if (nnpa !== null) {
    scores.push(
      nnpa <= 0.5
        ? 100
        : nnpa <= 1
        ? 90
        : nnpa <= 2
        ? 75
        : nnpa <= 3
        ? 55
        : 25
    );
  }

  return average(scores);
}

function bankCapitalScore(f) {
  const capitalAdequacy =
    num(f.capital_adequacy_ratio) ??
    num(f.capital_adequacy) ??
    num(f.car);

  if (capitalAdequacy === null) return null;

  if (capitalAdequacy >= 18) return 100;
  if (capitalAdequacy >= 16) return 90;
  if (capitalAdequacy >= 14) return 80;
  if (capitalAdequacy >= 12) return 65;
  if (capitalAdequacy >= 10) return 45;

  return 20;
}

function bankValuationScore(f) {
  const pe = num(f.pe_ratio);
  const pb = num(f.pb_ratio);

  /*
     P/B receives more importance for banks than normal
     industrial companies.
  */

  const scores = [];

  if (pb !== null) {
    scores.push(
      pb <= 1
        ? 100
        : pb <= 1.5
        ? 90
        : pb <= 2
        ? 80
        : pb <= 3
        ? 65
        : pb <= 4
        ? 45
        : 20
    );
  }

  if (pe !== null) {
    scores.push(
      pe <= 10
        ? 100
        : pe <= 15
        ? 90
        : pe <= 20
        ? 80
        : pe <= 25
        ? 65
        : pe <= 35
        ? 45
        : 20
    );
  }

  return average(scores);
}

function scoreBank(f) {
  const components = {
    growth: bankGrowthScore(f),
    profitability: bankProfitabilityScore(f),
    assetQuality: bankAssetQualityScore(f),
    capital: bankCapitalScore(f),
    valuation: bankValuationScore(f),
    ownership: ownershipScore(f),
  };

  const weights = {
    growth: 0.20,
    profitability: 0.25,
    assetQuality: 0.20,
    capital: 0.15,
    valuation: 0.10,
    ownership: 0.10,
  };

  const score = Math.round(weightedScore(components, weights));

  const confidence = confidenceScore(components);

  return {
    score,
    confidence,
    components,
  };
}

/* =========================================================
   FINANCIAL SERVICES
========================================================= */

function scoreFinancial(f) {
  const components = {
    growth: growthScore(f),
    profitability: profitabilityScore(f),
    leverage: debtScore(f),
    valuation: valuationScore(f),
    ownership: ownershipScore(f),
  };

  const weights = {
    growth: 0.20,
    profitability: 0.30,
    leverage: 0.20,
    valuation: 0.15,
    ownership: 0.15,
  };

  return {
    score: Math.round(weightedScore(components, weights)),
    confidence: confidenceScore(components),
    components,
  };
}

/* =========================================================
   STANDARD SECTOR MODELS
========================================================= */

function scoreStandard(f, sector) {
  const growth = growthScore(f);
  const profitability = profitabilityScore(f);
  const debt = debtScore(f);
  const valuation = valuationScore(f);
  const ownership = ownershipScore(f);
  const cashFlow = cashFlowScore(f);

  let components;
  let weights;

  switch (sector) {
    case "TECHNOLOGY":
    case "IT & TECHNOLOGY":
      components = {
        growth,
        profitability,
        cashFlow,
        valuation,
        ownership,
      };

      weights = {
        growth: 0.25,
        profitability: 0.30,
        cashFlow: 0.15,
        valuation: 0.15,
        ownership: 0.15,
      };
      break;

    case "DEFENCE & AEROSPACE":
      components = {
        growth,
        profitability,
        debt,
        ownership,
        valuation,
        cashFlow,
      };

      weights = {
        growth: 0.20,
        profitability: 0.25,
        debt: 0.15,
        ownership: 0.15,
        valuation: 0.10,
        cashFlow: 0.15,
      };
      break;

    case "PHARMA & HEALTHCARE":
      components = {
        growth,
        profitability,
        debt,
        cashFlow,
        valuation,
      };

      weights = {
        growth: 0.25,
        profitability: 0.30,
        debt: 0.15,
        cashFlow: 0.15,
        valuation: 0.15,
      };
      break;

    case "AUTOMOBILE & AUTO COMPONENTS":
      components = {
        growth,
        profitability,
        debt,
        cashFlow,
        valuation,
      };

      weights = {
        growth: 0.20,
        profitability: 0.25,
        debt: 0.20,
        cashFlow: 0.15,
        valuation: 0.20,
      };
      break;

    case "POWER & ENERGY":
    case "OIL & GAS":
      components = {
        growth,
        profitability,
        debt,
        cashFlow,
        valuation,
      };

      weights = {
        growth: 0.20,
        profitability: 0.25,
        debt: 0.20,
        cashFlow: 0.20,
        valuation: 0.15,
      };
      break;

    case "METALS & MINING":
      components = {
        growth,
        profitability,
        debt,
        cashFlow,
        valuation,
      };

      weights = {
        growth: 0.20,
        profitability: 0.25,
        debt: 0.20,
        cashFlow: 0.20,
        valuation: 0.15,
      };
      break;

    case "CONSTRUCTION & INFRASTRUCTURE":
      components = {
        growth,
        profitability,
        debt,
        cashFlow,
        valuation,
      };

      weights = {
        growth: 0.20,
        profitability: 0.25,
        debt: 0.20,
        cashFlow: 0.20,
        valuation: 0.15,
      };
      break;

    case "FMCG & CONSUMER":
    case "TEXTILES & CONSUMER":
    case "CONSUMER & JEWELLERY":
      components = {
        growth,
        profitability,
        debt,
        valuation,
        cashFlow,
      };

      weights = {
        growth: 0.20,
        profitability: 0.30,
        debt: 0.15,
        valuation: 0.20,
        cashFlow: 0.15,
      };
      break;

    case "CHEMICALS & FERTILIZERS":
      components = {
        growth,
        profitability,
        debt,
        cashFlow,
        valuation,
      };

      weights = {
        growth: 0.25,
        profitability: 0.25,
        debt: 0.20,
        cashFlow: 0.15,
        valuation: 0.15,
      };
      break;

    case "INDUSTRIAL PRODUCTS":
    case "INDUSTRIAL":
      components = {
        growth,
        profitability,
        debt,
        cashFlow,
        valuation,
      };

      weights = {
        growth: 0.20,
        profitability: 0.25,
        debt: 0.20,
        cashFlow: 0.20,
        valuation: 0.15,
      };
      break;

    default:
      components = {
        growth,
        profitability,
        debt,
        ownership,
        valuation,
        cashFlow,
      };

      weights = {
        growth: 0.20,
        profitability: 0.25,
        debt: 0.15,
        ownership: 0.15,
        valuation: 0.10,
        cashFlow: 0.15,
      };
  }

  return {
    score: Math.round(weightedScore(components, weights)),
    confidence: confidenceScore(components),
    components,
  };
}

/* =========================================================
   RISK ENGINE
========================================================= */

function calculateRisk(f, sector, confidence) {
  let riskPoints = 0;

  const debt = num(f.debt_to_equity);
  const profitGrowth = num(f.profit_growth);
  const roe = num(f.roe);
  const pe = num(f.pe_ratio);

  if (debt !== null) {
    if (debt > 3) riskPoints += 4;
    else if (debt > 2) riskPoints += 3;
    else if (debt > 1) riskPoints += 2;
    else if (debt > 0.5) riskPoints += 1;
  }

  if (profitGrowth !== null) {
    if (profitGrowth < -30) riskPoints += 4;
    else if (profitGrowth < -10) riskPoints += 3;
    else if (profitGrowth < 0) riskPoints += 1;
  }

  if (roe !== null && roe < 5) {
    riskPoints += 2;
  }

  if (pe !== null) {
    if (pe > 70) riskPoints += 3;
    else if (pe > 50) riskPoints += 2;
    else if (pe > 35) riskPoints += 1;
  }

  /*
     Banks naturally have different leverage characteristics.
     Do not apply industrial debt logic aggressively.
  */
  if (sector === "BANKING") {
    riskPoints = Math.max(0, riskPoints - 2);
  }

  if (confidence < 40) {
    return "HIGH";
  }

  if (riskPoints >= 5) return "HIGH";
  if (riskPoints >= 2) return "MODERATE";

  return "LOW";
}

/* =========================================================
   RATING
========================================================= */

function determineRating(score, confidence) {
  if (confidence < 40) {
    return "INSUFFICIENT_DATA";
  }

  if (score >= 85) return "EXCELLENT";
  if (score >= 70) return "GOOD";
  if (score >= 55) return "AVERAGE";

  return "WEAK";
}

/* =========================================================
   ACTION
========================================================= */

function determineAction(score, rating, risk, confidence) {
  /*
     Never issue aggressive actions when data quality
     is poor.
  */

  if (confidence < 40) {
    return "WAIT";
  }

  if (risk === "HIGH") {
    if (score >= 85) return "WATCH";
    return "REDUCE";
  }

  if (score >= 85) return "BUY";
  if (score >= 70) return "HOLD";
  if (score >= 55) return "WATCH";

  return "REDUCE";
}

/* =========================================================
   MAIN
========================================================= */

export async function GET() {
  try {
    /* -----------------------------------------------------
       1. LOAD HOLDINGS
    ----------------------------------------------------- */

    const { data: holdings, error: holdingsError } = await supabase
      .from("holdings")
      .select(
        `
        instrument_id,
        quantity,
        average_price
        `
      );

    if (holdingsError) {
      throw new Error(`Holdings load failed: ${holdingsError.message}`);
    }

    if (!holdings || holdings.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No holdings found.",
      });
    }

    /* -----------------------------------------------------
       2. UNIQUE INSTRUMENTS
    ----------------------------------------------------- */

    const uniqueInstrumentIds = [
      ...new Set(
        holdings
          .map((h) => h.instrument_id)
          .filter(Boolean)
      ),
    ];

    /* -----------------------------------------------------
       3. LOAD INSTRUMENTS
    ----------------------------------------------------- */

    const { data: instruments, error: instrumentsError } = await supabase
      .from("instruments")
      .select("*")
      .in("id", uniqueInstrumentIds);

    if (instrumentsError) {
      throw new Error(
        `Instrument load failed: ${instrumentsError.message}`
      );
    }

    const instrumentMap = new Map(
      (instruments || []).map((instrument) => [
        instrument.id,
        instrument,
      ])
    );

    /* -----------------------------------------------------
       4. SCORE
    ----------------------------------------------------- */

    const results = [];
    const skipped = [];
    const errors = [];

    for (const instrumentId of uniqueInstrumentIds) {
      const instrument = instrumentMap.get(instrumentId);

      if (!instrument) {
        skipped.push({
          instrument_id: instrumentId,
          reason: "Instrument not found.",
        });

        continue;
      }

      const companyName = instrument.company_name || instrument.name || "";
      const securityType = instrument.security_type || "OTHER";
      const sector = instrument.sector || "OTHER";

      /*
         Funds are handled by the MF engine.
      */

      if (securityType === "FUND") {
        skipped.push({
          instrument_id: instrumentId,
          symbol: instrument.symbol,
          company_name: companyName,
          reason: "Fund — use MF scoring engine.",
        });

        continue;
      }

      /* ---------------------------------------------------
         FUNDAMENTALS
      --------------------------------------------------- */

      const { data: fundamentals, error: fundamentalsError } =
        await supabase
          .from("fundamentals")
          .select("*")
          .eq("instrument_id", instrumentId)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

      if (fundamentalsError) {
        errors.push({
          instrument_id: instrumentId,
          company_name: companyName,
          reason: `Fundamentals load failed: ${fundamentalsError.message}`,
        });

        continue;
      }

      if (!fundamentals) {
        skipped.push({
          instrument_id: instrumentId,
          symbol: instrument.symbol,
          company_name: companyName,
          reason: "Fundamentals not available.",
        });

        continue;
      }

      /* ---------------------------------------------------
         SECTOR MODEL
      --------------------------------------------------- */

      let result;

      if (securityType === "BANK" || sector === "BANKING") {
        result = scoreBank(fundamentals);
      } else if (securityType === "FINANCIAL") {
        result = scoreFinancial(fundamentals);
      } else {
        result = scoreStandard(fundamentals, sector);
      }

      const risk = calculateRisk(
        fundamentals,
        sector,
        result.confidence
      );

      const rating = determineRating(
        result.score,
        result.confidence
      );

      const action = determineAction(
        result.score,
        rating,
        risk,
        result.confidence
      );

      /* ---------------------------------------------------
         SAVE SCORE
      --------------------------------------------------- */

      const payload = {
        instrument_id: instrumentId,
        total_score: result.score,
        rating,
        risk_level: risk,
        action,
        score_breakdown: result.components,
        updated_at: new Date().toISOString(),
      };

      const { data: savedScore, error: saveError } = await supabase
        .from("ai_scores")
        .upsert(payload, {
          onConflict: "instrument_id",
        })
        .select("id")
        .single();

      if (saveError) {
        errors.push({
          instrument_id: instrumentId,
          company_name: companyName,
          reason: `Score save failed: ${saveError.message}`,
        });

        continue;
      }

      results.push({
        instrument_id: instrumentId,
        symbol: instrument.symbol,
        company_name: companyName,
        security_type: securityType,
        sector,

        score: result.score,
        rating,
        risk,
        action,

        confidence: result.confidence,

        components: result.components,

        fundamentals_date:
          fundamentals.updated_at ||
          fundamentals.created_at ||
          null,

        saved_score_id: savedScore?.id || null,
      });
    }

    /* -----------------------------------------------------
       5. SUMMARY
    ----------------------------------------------------- */

    const averageScore =
      results.length > 0
        ? Math.round(
            results.reduce(
              (sum, item) => sum + item.score,
              0
            ) / results.length
          )
        : null;

    const actions = {};
    const ratings = {};
    const risks = {};
    const sectors = {};

    for (const item of results) {
      actions[item.action] =
        (actions[item.action] || 0) + 1;

      ratings[item.rating] =
        (ratings[item.rating] || 0) + 1;

      risks[item.risk] =
        (risks[item.risk] || 0) + 1;

      sectors[item.security_type] =
        (sectors[item.security_type] || 0) + 1;
    }

    /* -----------------------------------------------------
       6. RESPONSE
    ----------------------------------------------------- */

    return NextResponse.json({
      success: true,

      message:
        "Sector-specific portfolio scoring completed with improved bank model.",

      summary: {
        holdings: holdings.length,
        unique_instruments: uniqueInstrumentIds.length,

        scored: results.length,
        skipped: skipped.length,
        errors: errors.length,

        average_score: averageScore,

        actions,
        ratings,
        risks,
        sectors,
      },

      results,
      skipped,
      errors,
    });
  } catch (error) {
    console.error("Portfolio scoring error:", error);

    return NextResponse.json(
      {
        success: false,
        message: error.message || "Portfolio scoring failed.",
      },
      { status: 500 }
    );
  }
}
