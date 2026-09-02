import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================================================
   HELPERS
========================================================= */

function num(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  const valid = values.filter((v) => v !== null && v !== undefined);

  if (!valid.length) return null;

  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/* =========================================================
   COMPONENT SCORING
========================================================= */

function growthScore(value) {
  value = num(value);

  if (value === null) return null;
  if (value >= 20) return 100;
  if (value >= 10) return 80;
  if (value >= 5) return 65;
  if (value >= 0) return 50;
  return 25;
}

function roeScore(value) {
  value = num(value);

  if (value === null) return null;
  if (value >= 20) return 100;
  if (value >= 15) return 85;
  if (value >= 10) return 70;
  if (value >= 5) return 50;
  return 25;
}

function roceScore(value) {
  value = num(value);

  if (value === null) return null;
  if (value >= 25) return 100;
  if (value >= 18) return 85;
  if (value >= 12) return 70;
  if (value >= 7) return 50;
  return 25;
}

function debtScore(value) {
  value = num(value);

  if (value === null) return null;
  if (value <= 0.3) return 100;
  if (value <= 0.7) return 80;
  if (value <= 1.2) return 60;
  if (value <= 2) return 40;
  return 20;
}

function cashFlowScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value > 0) return 80;
  return 20;
}

function promoterScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value >= 50) return 90;
  if (value >= 30) return 75;
  if (value >= 15) return 55;

  return 40;
}

function valuationScore(pe, pb) {
  const scores = [];

  pe = num(pe);
  pb = num(pb);

  if (pe !== null && pe > 0) {
    if (pe <= 15) scores.push(100);
    else if (pe <= 25) scores.push(80);
    else if (pe <= 40) scores.push(60);
    else if (pe <= 60) scores.push(40);
    else scores.push(20);
  }

  if (pb !== null && pb > 0) {
    if (pb <= 2) scores.push(100);
    else if (pb <= 4) scores.push(80);
    else if (pb <= 8) scores.push(60);
    else if (pb <= 12) scores.push(40);
    else scores.push(20);
  }

  return average(scores);
}

/* =========================================================
   BANK-SPECIFIC SCORING
========================================================= */

function npaScore(value, type = "gross") {
  value = num(value);

  if (value === null) return null;

  if (type === "gross") {
    if (value <= 2) return 100;
    if (value <= 4) return 80;
    if (value <= 6) return 60;
    if (value <= 10) return 40;
    return 20;
  }

  if (value <= 1) return 100;
  if (value <= 2) return 80;
  if (value <= 3) return 60;
  if (value <= 5) return 40;

  return 20;
}

function capitalScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value >= 16) return 100;
  if (value >= 14) return 85;
  if (value >= 12) return 70;
  if (value >= 10) return 50;

  return 30;
}

function roaScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value >= 1.5) return 100;
  if (value >= 1) return 80;
  if (value >= 0.5) return 60;
  if (value >= 0) return 40;

  return 20;
}

/* =========================================================
   GENERIC SECTOR MODELS
========================================================= */

const SECTOR_WEIGHTS = {
  TECHNOLOGY: {
    growth: 30,
    profitability: 30,
    balance: 20,
    cash: 10,
    ownership: 10,
  },

  PHARMA_HEALTHCARE: {
    growth: 25,
    profitability: 30,
    balance: 20,
    cash: 15,
    ownership: 10,
  },

  DEFENCE: {
    growth: 25,
    profitability: 25,
    balance: 20,
    cash: 15,
    ownership: 15,
  },

  CONSTRUCTION_INFRA: {
    growth: 25,
    profitability: 20,
    balance: 25,
    cash: 20,
    ownership: 10,
  },

  AUTOMOBILE: {
    growth: 25,
    profitability: 25,
    balance: 20,
    cash: 15,
    ownership: 15,
  },

  CONSUMER: {
    growth: 30,
    profitability: 30,
    balance: 15,
    cash: 15,
    ownership: 10,
  },

  CHEMICALS: {
    growth: 25,
    profitability: 30,
    balance: 20,
    cash: 15,
    ownership: 10,
  },

  ENERGY: {
    growth: 20,
    profitability: 25,
    balance: 25,
    cash: 20,
    ownership: 10,
  },

  OIL_GAS: {
    growth: 20,
    profitability: 25,
    balance: 25,
    cash: 20,
    ownership: 10,
  },

  METALS_MINING: {
    growth: 20,
    profitability: 25,
    balance: 25,
    cash: 20,
    ownership: 10,
  },

  FINANCIAL: {
    growth: 20,
    profitability: 30,
    balance: 20,
    cash: 15,
    ownership: 15,
  },

  INDUSTRIAL: {
    growth: 25,
    profitability: 25,
    balance: 25,
    cash: 15,
    ownership: 10,
  },

  OTHER: {
    growth: 25,
    profitability: 25,
    balance: 25,
    cash: 15,
    ownership: 10,
  },
};

/* =========================================================
   DATA COMPLETENESS
========================================================= */

function calculateCompleteness(f) {
  const fields = [
    f?.sales_growth,
    f?.profit_growth,
    f?.roe,
    f?.roce,
    f?.debt_to_equity,
    f?.operating_cash_flow,
    f?.promoter_holding,
    f?.market_cap,
    f?.pe_ratio,
    f?.pb_ratio,
  ];

  const available = fields.filter(
    (v) => v !== null && v !== undefined
  ).length;

  return Math.round((available / fields.length) * 100);
}

/* =========================================================
   BANK COMPLETENESS
========================================================= */

function calculateBankCompleteness(f) {
  const fields = [
    f?.sales_growth,
    f?.profit_growth,
    f?.roe,
    f?.roa,
    f?.gross_npa,
    f?.net_npa,
    f?.capital_adequacy_ratio ??
      f?.capital_adequacy ??
      f?.car,
    f?.pe_ratio,
    f?.pb_ratio,
    f?.promoter_holding,
  ];

  const available = fields.filter(
    (v) => v !== null && v !== undefined
  ).length;

  return Math.round((available / fields.length) * 100);
}

/* =========================================================
   GENERIC SECTOR SCORE
========================================================= */

function calculateGenericScore(f, sector) {
  const weights =
    SECTOR_WEIGHTS[sector] || SECTOR_WEIGHTS.OTHER;

  const components = {
    growth: growthScore(f.sales_growth),
    profitability: average([
      roeScore(f.roe),
      roceScore(f.roce),
    ]),
    balance: debtScore(f.debt_to_equity),
    cash: cashFlowScore(f.operating_cash_flow),
    ownership: promoterScore(f.promoter_holding),
  };

  const weighted = [];
  let availableWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const value = components[key];

    if (value !== null) {
      weighted.push(value * weight);
      availableWeight += weight;
    }
  }

  if (!availableWeight) {
    return {
      score: null,
      confidence: 0,
      components,
    };
  }

  const score =
    weighted.reduce((a, b) => a + b, 0) /
    availableWeight;

  const confidence = Math.round(
    (availableWeight / 100) * 100
  );

  return {
    score: Math.round(clamp(score)),
    confidence,
    components,
  };
}

/* =========================================================
   BANK SCORE
========================================================= */

function calculateBankScore(f) {
  const capital =
    f.capital_adequacy_ratio ??
    f.capital_adequacy ??
    f.car;

  const components = {
    growth: growthScore(f.sales_growth),

    profitability: average([
      roeScore(f.roe),
      roaScore(f.roa),
    ]),

    asset_quality: average([
      npaScore(f.gross_npa, "gross"),
      npaScore(f.net_npa, "net"),
    ]),

    capital: capitalScore(capital),

    valuation: valuationScore(
      f.pe_ratio,
      f.pb_ratio
    ),

    ownership: promoterScore(f.promoter_holding),
  };

  const weights = {
    growth: 20,
    profitability: 25,
    asset_quality: 20,
    capital: 15,
    valuation: 10,
    ownership: 10,
  };

  let total = 0;
  let availableWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    if (components[key] !== null) {
      total += components[key] * weight;
      availableWeight += weight;
    }
  }

  if (!availableWeight) {
    return {
      score: null,
      confidence: 0,
      components,
    };
  }

  return {
    score: Math.round(
      clamp(total / availableWeight)
    ),
    confidence: Math.round(
      (availableWeight / 100) * 100
    ),
    components,
  };
}

/* =========================================================
   RATING
========================================================= */

function getRating(score, confidence, completeness) {
  if (
    score === null ||
    completeness < 30 ||
    confidence < 30
  ) {
    return "INSUFFICIENT_DATA";
  }

  if (completeness < 50) {
    return "PROVISIONAL";
  }

  if (score >= 85) return "EXCELLENT";
  if (score >= 70) return "GOOD";
  if (score >= 55) return "AVERAGE";

  return "WEAK";
}

/* =========================================================
   ACTION
========================================================= */

function getAction(
  score,
  confidence,
  completeness
) {
  if (
    score === null ||
    completeness < 30 ||
    confidence < 30
  ) {
    return "WAIT";
  }

  /*
    We deliberately become more conservative when
    fundamentals are incomplete.
  */

  if (completeness < 50) {
    if (score >= 80) return "WATCH";
    if (score < 45) return "WAIT";

    return "WATCH";
  }

  if (score >= 85) return "BUY";
  if (score >= 70) return "HOLD";
  if (score >= 55) return "WATCH";

  return "REDUCE";
}

/* =========================================================
   RISK
========================================================= */

function getRisk(
  score,
  completeness,
  sector,
  fundamentals
) {
  if (
    score === null ||
    completeness < 30
  ) {
    return "HIGH";
  }

  let risk = "MODERATE";

  if (score >= 75) risk = "LOW";
  if (score < 55) risk = "HIGH";

  /*
    Extra caution for poor profitability.
  */

  if (
    fundamentals.roe !== null &&
    fundamentals.roe !== undefined &&
    Number(fundamentals.roe) < 5
  ) {
    risk = "HIGH";
  }

  if (completeness < 50) {
    risk = "HIGH";
  }

  return risk;
}

/* =========================================================
   MAIN API
========================================================= */

export async function POST() {
  try {
    /*
      1. Get holdings
    */

    const { data: holdings, error: holdingsError } =
      await supabase
        .from("holdings")
        .select("instrument_id");

    if (holdingsError) {
      throw holdingsError;
    }

    if (!holdings?.length) {
      return NextResponse.json({
        success: true,
        message: "No holdings found.",
      });
    }

    /*
      2. Remove duplicate instruments
    */

    const instrumentIds = [
      ...new Set(
        holdings
          .map((h) => h.instrument_id)
          .filter(Boolean)
      ),
    ];

    /*
      3. Load instruments
    */

    const { data: instruments, error: instrumentsError } =
      await supabase
        .from("instruments")
        .select("*")
        .in("id", instrumentIds);

    if (instrumentsError) {
      throw instrumentsError;
    }

    /*
      4. Load fundamentals
    */

    const { data: fundamentalsRows, error: fundamentalsError } =
      await supabase
        .from("fundamentals")
        .select("*")
        .in("instrument_id", instrumentIds);

    if (fundamentalsError) {
      throw fundamentalsError;
    }

    const fundamentalsMap = new Map(
      (fundamentalsRows || []).map((f) => [
        f.instrument_id,
        f,
      ])
    );

    /*
      5. Score each instrument
    */

    const results = [];

    let scored = 0;
    let provisional = 0;
    let blocked = 0;
    let skipped = 0;
    let errors = 0;

    for (const instrument of instruments || []) {
      try {
        const instrumentId = instrument.id;

        /*
          Mutual funds are handled separately.
        */

        const securityType =
          String(
            instrument.security_type || ""
          ).toUpperCase();

        const sector =
          String(
            instrument.sector || "OTHER"
          ).toUpperCase();

        if (
          securityType === "FUND" ||
          sector === "FUND"
        ) {
          skipped++;

          results.push({
            instrument_id: instrumentId,
            company_name:
              instrument.company_name ||
              instrument.name,
            status: "SKIPPED_FUND",
          });

          continue;
        }

        const f =
          fundamentalsMap.get(instrumentId) || {};

        /*
          Data health
        */

        let completeness =
          calculateCompleteness(f);

        if (sector === "BANK") {
          completeness =
            calculateBankCompleteness(f);
        }

        /*
          Hard safety gate.
          Below 30% = no meaningful score.
        */

        if (completeness < 30) {
          blocked++;

          await supabase
            .from("ai_scores")
            .upsert(
              {
                instrument_id: instrumentId,
                total_score: null,
                rating: "INSUFFICIENT_DATA",
                action: "WAIT",
                risk_level: "HIGH",
                updated_at:
                  new Date().toISOString(),

                score_breakdown: {
                  engine: "safe_v2",
                  score_available: false,
                  data_status: "BLOCKED",
                  data_completeness: completeness,
                  confidence: 0,
                  reason:
                    "Fundamental data completeness below 30%.",
                  sector,
                },
              },
              {
                onConflict: "instrument_id",
              }
            );

          results.push({
            instrument_id: instrumentId,
            company_name:
              instrument.company_name ||
              instrument.name,
            sector,
            status: "BLOCKED",
            completeness,
          });

          continue;
        }

        /*
          Sector-specific scoring
        */

        let scoring;

        if (sector === "BANK") {
          scoring = calculateBankScore(f);
        } else {
          scoring = calculateGenericScore(
            f,
            sector
          );
        }

        /*
          Effective confidence is constrained
          by actual data health.
        */

        let confidence = Math.min(
          scoring.confidence,
          completeness
        );

        if (completeness < 50) {
          confidence = Math.min(
            confidence,
            59
          );
        } else if (completeness < 80) {
          confidence = Math.min(
            confidence,
            79
          );
        }

        const score = scoring.score;

        /*
          Very low confidence = provisional,
          not a strong BUY/REDUCE signal.
        */

        const rating = getRating(
          score,
          confidence,
          completeness
        );

        const action = getAction(
          score,
          confidence,
          completeness
        );

        const risk = getRisk(
          score,
          completeness,
          sector,
          f
        );

        if (completeness < 50) {
          provisional++;
        } else {
          scored++;
        }

        /*
          Save result
        */

        const payload = {
          instrument_id: instrumentId,
          total_score: score,
          rating,
          action,
          risk_level: risk,
          updated_at:
            new Date().toISOString(),

          score_breakdown: {
            engine: "safe_v2",

            sector,

            score_available:
              score !== null,

            data_status:
              completeness >= 80
                ? "COMPLETE"
                : completeness >= 50
                ? "PARTIAL"
                : "PROVISIONAL",

            data_completeness:
              completeness,

            confidence,

            components:
              scoring.components,

            scoring_notes: [
              "Missing metrics are excluded rather than treated as zero.",
              "Confidence is reduced when fundamental coverage is incomplete.",
              "Scores below 30% data completeness are blocked.",
              "Mutual funds are handled by the MF engine.",
            ],
          },
        };

        const { error: saveError } =
          await supabase
            .from("ai_scores")
            .upsert(payload, {
              onConflict: "instrument_id",
            });

        if (saveError) {
          throw saveError;
        }

        results.push({
          instrument_id: instrumentId,
          company_name:
            instrument.company_name ||
            instrument.name,
          sector,
          score,
          rating,
          action,
          risk,
          completeness,
          confidence,
          status:
            completeness < 50
              ? "PROVISIONAL"
              : "SCORED",
        });
      } catch (error) {
        errors++;

        results.push({
          instrument_id: instrument.id,
          company_name:
            instrument.company_name ||
            instrument.name,
          status: "ERROR",
          error: error.message,
        });
      }
    }

    /*
      Average score
    */

    const validScores = results
      .map((r) => r.score)
      .filter(
        (v) =>
          typeof v === "number" &&
          Number.isFinite(v)
      );

    const averageScore = validScores.length
      ? Math.round(
          validScores.reduce(
            (a, b) => a + b,
            0
          ) / validScores.length
        )
      : null;

    /*
      Action summary
    */

    const actions = {};

    results.forEach((r) => {
      if (r.action) {
        actions[r.action] =
          (actions[r.action] || 0) + 1;
      }
    });

    /*
      Rating summary
    */

    const ratings = {};

    results.forEach((r) => {
      if (r.rating) {
        ratings[r.rating] =
          (ratings[r.rating] || 0) + 1;
      }
    });

    /*
      Risk summary
    */

    const risks = {};

    results.forEach((r) => {
      if (r.risk) {
        risks[r.risk] =
          (risks[r.risk] || 0) + 1;
      }
    });

    return NextResponse.json({
      success: true,

      message:
        "Safe sector-specific portfolio scoring completed.",

      summary: {
        holdings: holdings.length,

        unique_instruments:
          instrumentIds.length,

        scored,

        provisional,

        blocked,

        skipped,

        errors,

        average_score:
          averageScore,

        actions,

        ratings,

        risks,
      },

      results,
    });
  } catch (error) {
    console.error(
      "SAFE SCORE ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Unknown error",
      },
      {
        status: 500,
      }
    );
  }
}
