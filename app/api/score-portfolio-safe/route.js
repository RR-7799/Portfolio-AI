import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================================================
   BASIC HELPERS
========================================================= */

function num(value) {
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
  const valid = values.filter(
    (v) => v !== null && v !== undefined && Number.isFinite(v)
  );

  if (!valid.length) return null;

  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/* =========================================================
   SECTOR NORMALIZATION
========================================================= */

function normalizeSector(rawSector = "") {
  const sector = String(rawSector).toUpperCase().trim();

  if (
    sector.includes("BANK") ||
    sector === "BANKING"
  ) {
    return "BANK";
  }

  if (
    sector.includes("DEFENCE") ||
    sector.includes("DEFENSE") ||
    sector.includes("AEROSPACE")
  ) {
    return "DEFENCE";
  }

  if (
    sector.includes("TECHNOLOGY") ||
    sector.includes("IT &") ||
    sector === "IT"
  ) {
    return "TECHNOLOGY";
  }

  if (
    sector.includes("PHARMA") ||
    sector.includes("HEALTHCARE") ||
    sector.includes("LIFE SCIENCE")
  ) {
    return "PHARMA_HEALTHCARE";
  }

  if (
    sector.includes("CONSTRUCTION") ||
    sector.includes("INFRA")
  ) {
    return "CONSTRUCTION_INFRA";
  }

  if (
    sector.includes("AUTOMOBILE") ||
    sector.includes("AUTO COMPONENT")
  ) {
    return "AUTOMOBILE";
  }

  if (
    sector.includes("CONSUMER") ||
    sector.includes("FMCG") ||
    sector.includes("JEWELL")
  ) {
    return "CONSUMER";
  }

  if (
    sector.includes("CHEMICAL") ||
    sector.includes("FERTILIZER")
  ) {
    return "CHEMICALS";
  }

  if (
    sector.includes("POWER") ||
    sector.includes("ENERGY")
  ) {
    return "ENERGY";
  }

  if (
    sector.includes("OIL") ||
    sector.includes("GAS")
  ) {
    return "OIL_GAS";
  }

  if (
    sector.includes("METAL") ||
    sector.includes("MINING")
  ) {
    return "METALS_MINING";
  }

  if (
    sector.includes("FINANCIAL") ||
    sector.includes("NBFC") ||
    sector.includes("INSURANCE")
  ) {
    return "FINANCIAL";
  }

  if (
    sector.includes("INDUSTRIAL") ||
    sector.includes("PACKAGING")
  ) {
    return "INDUSTRIAL";
  }

  return "OTHER";
}

/* =========================================================
   DATA HEALTH
========================================================= */

function calculateCompleteness(f, sector) {
  let fields;

  /*
    Banks need a different data-health model.
  */

  if (sector === "BANK") {
    const capital =
      f.capital_adequacy_ratio ??
      f.capital_adequacy ??
      f.car;

    fields = [
      f.sales_growth,
      f.profit_growth,
      f.roe,
      f.roa,
      f.gross_npa,
      f.net_npa,
      capital,
      f.pe_ratio,
      f.pb_ratio,
      f.promoter_holding,
    ];
  } else {
    fields = [
      f.sales_growth,
      f.profit_growth,
      f.roe,
      f.roce,
      f.debt_to_equity,
      f.operating_cash_flow,
      f.promoter_holding,
      f.market_cap,
      f.pe_ratio,
      f.pb_ratio,
    ];
  }

  const available = fields.filter(
    (v) => v !== null && v !== undefined
  ).length;

  return Math.round(
    (available / fields.length) * 100
  );
}

/* =========================================================
   GROWTH
========================================================= */

function growthScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value >= 25) return 100;
  if (value >= 20) return 92;
  if (value >= 15) return 84;
  if (value >= 10) return 76;
  if (value >= 5) return 64;
  if (value >= 0) return 50;

  if (value >= -10) return 35;

  return 20;
}

/* =========================================================
   PROFITABILITY
========================================================= */

function roeScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value >= 25) return 100;
  if (value >= 20) return 92;
  if (value >= 15) return 84;
  if (value >= 10) return 72;
  if (value >= 5) return 55;
  if (value >= 0) return 35;

  return 20;
}

function roceScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value >= 30) return 100;
  if (value >= 25) return 92;
  if (value >= 18) return 84;
  if (value >= 12) return 72;
  if (value >= 7) return 55;
  if (value >= 0) return 35;

  return 20;
}

/* =========================================================
   BALANCE SHEET
========================================================= */

function debtScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value <= 0.2) return 100;
  if (value <= 0.5) return 90;
  if (value <= 0.75) return 80;
  if (value <= 1.25) return 65;
  if (value <= 2) return 45;
  if (value <= 3) return 30;

  return 15;
}

/* =========================================================
   CASH FLOW
========================================================= */

function cashFlowScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value > 0) return 85;

  return 20;
}

/* =========================================================
   OWNERSHIP
========================================================= */

function promoterScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value >= 60) return 100;
  if (value >= 50) return 92;
  if (value >= 40) return 82;
  if (value >= 30) return 72;
  if (value >= 20) return 60;
  if (value >= 10) return 48;

  return 35;
}

/* =========================================================
   VALUATION
========================================================= */

function peScore(value) {
  value = num(value);

  if (value === null || value <= 0) return null;

  if (value <= 12) return 100;
  if (value <= 18) return 90;
  if (value <= 25) return 80;
  if (value <= 35) return 68;
  if (value <= 50) return 52;
  if (value <= 70) return 35;

  return 20;
}

function pbScore(value) {
  value = num(value);

  if (value === null || value <= 0) return null;

  if (value <= 1.5) return 100;
  if (value <= 2.5) return 90;
  if (value <= 4) return 80;
  if (value <= 6) return 65;
  if (value <= 10) return 45;
  if (value <= 15) return 30;

  return 20;
}

function valuationScore(pe, pb) {
  return average([
    peScore(pe),
    pbScore(pb),
  ]);
}

/* =========================================================
   BANK METRICS
========================================================= */

function npaScore(value, type) {
  value = num(value);

  if (value === null) return null;

  if (type === "gross") {
    if (value <= 1) return 100;
    if (value <= 2) return 90;
    if (value <= 3) return 80;
    if (value <= 5) return 65;
    if (value <= 8) return 45;

    return 20;
  }

  if (value <= 0.5) return 100;
  if (value <= 1) return 90;
  if (value <= 2) return 80;
  if (value <= 3) return 65;
  if (value <= 5) return 45;

  return 20;
}

function capitalScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value >= 18) return 100;
  if (value >= 16) return 95;
  if (value >= 14) return 85;
  if (value >= 12) return 72;
  if (value >= 10) return 55;

  return 30;
}

function roaScore(value) {
  value = num(value);

  if (value === null) return null;

  if (value >= 2) return 100;
  if (value >= 1.5) return 92;
  if (value >= 1) return 82;
  if (value >= 0.75) return 70;
  if (value >= 0.5) return 55;
  if (value >= 0) return 35;

  return 20;
}

/* =========================================================
   SECTOR WEIGHTS
========================================================= */

const SECTOR_WEIGHTS = {
  TECHNOLOGY: {
    growth: 25,
    profitability: 30,
    balance: 15,
    cash: 15,
    valuation: 10,
    ownership: 5,
  },

  PHARMA_HEALTHCARE: {
    growth: 25,
    profitability: 30,
    balance: 15,
    cash: 15,
    valuation: 10,
    ownership: 5,
  },

  DEFENCE: {
    growth: 25,
    profitability: 25,
    balance: 15,
    cash: 15,
    valuation: 10,
    ownership: 10,
  },

  CONSTRUCTION_INFRA: {
    growth: 25,
    profitability: 20,
    balance: 20,
    cash: 15,
    valuation: 10,
    ownership: 10,
  },

  AUTOMOBILE: {
    growth: 25,
    profitability: 25,
    balance: 15,
    cash: 15,
    valuation: 10,
    ownership: 10,
  },

  CONSUMER: {
    growth: 25,
    profitability: 30,
    balance: 10,
    cash: 15,
    valuation: 15,
    ownership: 5,
  },

  CHEMICALS: {
    growth: 25,
    profitability: 25,
    balance: 15,
    cash: 15,
    valuation: 15,
    ownership: 5,
  },

  ENERGY: {
    growth: 20,
    profitability: 25,
    balance: 20,
    cash: 15,
    valuation: 10,
    ownership: 10,
  },

  OIL_GAS: {
    growth: 20,
    profitability: 25,
    balance: 20,
    cash: 15,
    valuation: 10,
    ownership: 10,
  },

  METALS_MINING: {
    growth: 20,
    profitability: 25,
    balance: 20,
    cash: 15,
    valuation: 10,
    ownership: 10,
  },

  FINANCIAL: {
    growth: 25,
    profitability: 30,
    balance: 15,
    cash: 10,
    valuation: 10,
    ownership: 10,
  },

  INDUSTRIAL: {
    growth: 25,
    profitability: 25,
    balance: 20,
    cash: 15,
    valuation: 10,
    ownership: 5,
  },

  OTHER: {
    growth: 25,
    profitability: 25,
    balance: 20,
    cash: 15,
    valuation: 10,
    ownership: 5,
  },
};

/* =========================================================
   GENERIC SCORE
========================================================= */

function calculateGenericScore(f, sector) {
  const weights =
    SECTOR_WEIGHTS[sector] ||
    SECTOR_WEIGHTS.OTHER;

  const components = {
    growth: average([
      growthScore(f.sales_growth),
      growthScore(f.profit_growth),
    ]),

    profitability: average([
      roeScore(f.roe),
      roceScore(f.roce),
    ]),

    balance: debtScore(
      f.debt_to_equity
    ),

    cash: cashFlowScore(
      f.operating_cash_flow
    ),

    valuation: valuationScore(
      f.pe_ratio,
      f.pb_ratio
    ),

    ownership: promoterScore(
      f.promoter_holding
    ),
  };

  let weightedTotal = 0;
  let availableWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const component = components[key];

    if (component !== null) {
      weightedTotal +=
        component * weight;

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
      clamp(
        weightedTotal /
          availableWeight
      )
    ),

    confidence: Math.round(
      availableWeight
    ),

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
    growth: average([
      growthScore(f.sales_growth),
      growthScore(f.profit_growth),
    ]),

    profitability: average([
      roeScore(f.roe),
      roaScore(f.roa),
    ]),

    asset_quality: average([
      npaScore(
        f.gross_npa,
        "gross"
      ),

      npaScore(
        f.net_npa,
        "net"
      ),
    ]),

    capital: capitalScore(
      capital
    ),

    valuation: valuationScore(
      f.pe_ratio,
      f.pb_ratio
    ),

    ownership: promoterScore(
      f.promoter_holding
    ),
  };

  const weights = {
    growth: 20,
    profitability: 25,
    asset_quality: 20,
    capital: 15,
    valuation: 10,
    ownership: 10,
  };

  let weightedTotal = 0;
  let availableWeight = 0;

  for (const [key, weight] of Object.entries(weights)) {
    const component = components[key];

    if (component !== null) {
      weightedTotal +=
        component * weight;

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
      clamp(
        weightedTotal /
          availableWeight
      )
    ),

    confidence: Math.round(
      availableWeight
    ),

    components,
  };
}

/* =========================================================
   RATING
========================================================= */

function getRating(
  score,
  confidence,
  completeness
) {
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
    Partial data can never generate
    an aggressive BUY signal.
  */

  if (completeness < 50) {
    return score >= 70
      ? "WATCH"
      : "WAIT";
  }

  /*
    50-79% data:
    BUY requires stronger evidence.
  */

  if (completeness < 80) {
    if (score >= 90) return "BUY";
    if (score >= 70) return "HOLD";
    if (score >= 55) return "WATCH";

    return "REDUCE";
  }

  /*
    80%+ data.
  */

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
  f
) {
  if (
    score === null ||
    completeness < 30
  ) {
    return "HIGH";
  }

  if (completeness < 50) {
    return "HIGH";
  }

  let risk = "MODERATE";

  if (score >= 75) {
    risk = "LOW";
  }

  if (score < 55) {
    risk = "HIGH";
  }

  /*
    Very weak profitability
    increases risk.
  */

  const roe = num(f.roe);

  if (
    roe !== null &&
    roe < 5
  ) {
    risk = "HIGH";
  }

  return risk;
}

/* =========================================================
   POST
========================================================= */

export async function POST() {
  try {
    /*
      GET HOLDINGS
    */

    const {
      data: holdings,
      error: holdingsError,
    } = await supabase
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
      UNIQUE INSTRUMENTS
    */

    const instrumentIds = [
      ...new Set(
        holdings
          .map(
            (h) =>
              h.instrument_id
          )
          .filter(Boolean)
      ),
    ];

    /*
      INSTRUMENTS
    */

    const {
      data: instruments,
      error: instrumentsError,
    } = await supabase
      .from("instruments")
      .select("*")
      .in("id", instrumentIds);

    if (instrumentsError) {
      throw instrumentsError;
    }

    /*
      FUNDAMENTALS
    */

    const {
      data: fundamentalsRows,
      error: fundamentalsError,
    } = await supabase
      .from("fundamentals")
      .select("*")
      .in(
        "instrument_id",
        instrumentIds
      );

    if (fundamentalsError) {
      throw fundamentalsError;
    }

    const fundamentalsMap =
      new Map(
        (fundamentalsRows || []).map(
          (f) => [
            f.instrument_id,
            f,
          ]
        )
      );

    /*
      SUMMARY
    */

    const results = [];

    let scored = 0;
    let provisional = 0;
    let blocked = 0;
    let skipped = 0;
    let errors = 0;

    /*
      PROCESS
    */

    for (const instrument of instruments || []) {
      try {
        const instrumentId =
          instrument.id;

        const securityType =
          String(
            instrument.security_type ||
              ""
          ).toUpperCase();

        const rawSector =
          instrument.sector ||
          "OTHER";

        const sector =
          normalizeSector(
            rawSector
          );

        /*
          MF handled separately.
        */

        if (
          securityType === "FUND" ||
          sector === "FUND"
        ) {
          skipped++;

          results.push({
            instrument_id:
              instrumentId,

            company_name:
              instrument.company_name ||
              instrument.name,

            raw_sector:
              rawSector,

            status:
              "SKIPPED_FUND",
          });

          continue;
        }

        const f =
          fundamentalsMap.get(
            instrumentId
          ) || {};

        /*
          DATA HEALTH
        */

        const completeness =
          calculateCompleteness(
            f,
            sector
          );

        /*
          BELOW 30%:
          NO SCORE
        */

        if (
          completeness < 30
        ) {
          blocked++;

          const {
            error: saveError,
          } = await supabase
            .from("ai_scores")
            .upsert(
              {
                instrument_id:
                  instrumentId,

                total_score: null,

                rating:
                  "INSUFFICIENT_DATA",

                action: "WAIT",

                risk_level: "HIGH",

                updated_at:
                  new Date().toISOString(),

                score_breakdown: {
                  engine:
                    "safe_v3",

                  raw_sector:
                    rawSector,

                  normalized_sector:
                    sector,

                  score_available:
                    false,

                  data_status:
                    "BLOCKED",

                  data_completeness:
                    completeness,

                  confidence: 0,

                  reason:
                    "Fundamental data completeness is below 30%.",
                },
              },
              {
                onConflict:
                  "instrument_id",
              }
            );

          if (saveError) {
            throw saveError;
          }

          results.push({
            instrument_id:
              instrumentId,

            company_name:
              instrument.company_name ||
              instrument.name,

            sector,

            completeness,

            status: "BLOCKED",
          });

          continue;
        }

        /*
          SECTOR ENGINE
        */

        const scoring =
          sector === "BANK"
            ? calculateBankScore(f)
            : calculateGenericScore(
                f,
                sector
              );

        /*
          Confidence cannot exceed
          actual data completeness.
        */

        let confidence =
          Math.min(
            scoring.confidence,
            completeness
          );

        /*
          Confidence caps
        */

        if (
          completeness < 50
        ) {
          confidence =
            Math.min(
              confidence,
              49
            );
        } else if (
          completeness < 80
        ) {
          confidence =
            Math.min(
              confidence,
              69
            );
        } else {
          confidence =
            Math.min(
              confidence,
              100
            );
        }

        const score =
          scoring.score;

        /*
          FINAL DECISION
        */

        const rating =
          getRating(
            score,
            confidence,
            completeness
          );

        const action =
          getAction(
            score,
            confidence,
            completeness
          );

        const risk =
          getRisk(
            score,
            completeness,
            f
          );

        if (
          completeness < 50
        ) {
          provisional++;
        } else {
          scored++;
        }

        /*
          SAVE
        */

        const {
          error: saveError,
        } = await supabase
          .from("ai_scores")
          .upsert(
            {
              instrument_id:
                instrumentId,

              total_score:
                score,

              rating,

              action,

              risk_level:
                risk,

              updated_at:
                new Date().toISOString(),

              score_breakdown: {
                engine:
                  "safe_v3",

                raw_sector:
                  rawSector,

                normalized_sector:
                  sector,

                score_available:
                  score !== null,

                data_status:
                  completeness >= 80
                    ? "COMPLETE"
                    : completeness >=
                      50
                    ? "PARTIAL"
                    : "PROVISIONAL",

                data_completeness:
                  completeness,

                confidence,

                components:
                  scoring.components,

                valuation: {
                  pe:
                    num(
                      f.pe_ratio
                    ),

                  pb:
                    num(
                      f.pb_ratio
                    ),

                  valuation_score:
                    valuationScore(
                      f.pe_ratio,
                      f.pb_ratio
                    ),
                },

                notes: [
                  "Sector is normalized before scoring.",
                  "Missing metrics are excluded instead of treated as zero.",
                  "Confidence is capped by actual data completeness.",
                  "Partial data cannot generate an aggressive BUY signal unless evidence is exceptionally strong.",
                  "Below 30% completeness is blocked.",
                  "Mutual funds are handled separately.",
                ],
              },
            },
            {
              onConflict:
                "instrument_id",
            }
          );

        if (saveError) {
          throw saveError;
        }

        results.push({
          instrument_id:
            instrumentId,

          company_name:
            instrument.company_name ||
            instrument.name,

          raw_sector:
            rawSector,

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
          instrument_id:
            instrument.id,

          company_name:
            instrument.company_name ||
            instrument.name,

          status: "ERROR",

          error:
            error?.message ||
            "Unknown error",
        });
      }
    }

    /*
      SUMMARY
    */

    const validScores =
      results
        .map((r) => r.score)
        .filter(
          (v) =>
            typeof v ===
              "number" &&
            Number.isFinite(v)
        );

    const averageScore =
      validScores.length
        ? Math.round(
            validScores.reduce(
              (a, b) =>
                a + b,
              0
            ) /
              validScores.length
          )
        : null;

    const actions = {};

    const ratings = {};

    const risks = {};

    const sectors = {};

    results.forEach((r) => {
      if (r.action) {
        actions[r.action] =
          (actions[r.action] ||
            0) + 1;
      }

      if (r.rating) {
        ratings[r.rating] =
          (ratings[r.rating] ||
            0) + 1;
      }

      if (r.risk) {
        risks[r.risk] =
          (risks[r.risk] ||
            0) + 1;
      }

      if (r.sector) {
        sectors[r.sector] =
          (sectors[r.sector] ||
            0) + 1;
      }
    });

    return NextResponse.json({
      success: true,

      message:
        "Portfolio scoring V3 completed successfully.",

      engine_version:
        "safe_v3",

      summary: {
        holdings:
          holdings.length,

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

        sectors,
      },

      results,
    });
  } catch (error) {
    console.error(
      "SAFE V3 SCORE ERROR:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error?.message ||
          "Unknown server error",
      },
      {
        status: 500,
      }
    );
  }
}
