import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ------------------------------------------------------------
// SECTOR NORMALIZATION
// ------------------------------------------------------------

function normalizeSector(rawSector) {
  const s = String(rawSector || "").toUpperCase();

  if (s.includes("BANK")) return "BANK";

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

// ------------------------------------------------------------
// NUMBER HELPER
// ------------------------------------------------------------

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

// ------------------------------------------------------------
// SCORE BREAKDOWN PARSER
// ------------------------------------------------------------

function getBreakdown(scoreRow) {
  if (!scoreRow?.score_breakdown) {
    return {};
  }

  if (
    typeof scoreRow.score_breakdown === "string"
  ) {
    try {
      return JSON.parse(
        scoreRow.score_breakdown
      );
    } catch {
      return {};
    }
  }

  return scoreRow.score_breakdown;
}

// ------------------------------------------------------------
// COMPONENT EXTRACTOR
// ------------------------------------------------------------

function getComponentValue(
  breakdown,
  key
) {
  const value =
    breakdown?.components?.[key];

  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (
    typeof value === "object"
  ) {
    return num(value.score);
  }

  return num(value);
}

// ------------------------------------------------------------
// DIAGNOSTIC FLAGS
// ------------------------------------------------------------

function generateFlags({
  score,
  action,
  risk,
  completeness,
  confidence,
  valuationScore,
  sector,
}) {
  const flags = [];

  // Very high score + low confidence
  if (
    score !== null &&
    score >= 90 &&
    confidence !== null &&
    confidence < 80
  ) {
    flags.push({
      code: "HIGH_SCORE_LOW_CONFIDENCE",
      severity: "HIGH",
      message:
        "Very high score despite reduced data confidence. Review before relying on this score.",
    });
  }

  // High score + partial data
  if (
    score !== null &&
    score >= 85 &&
    completeness !== null &&
    completeness < 80
  ) {
    flags.push({
      code: "HIGH_SCORE_PARTIAL_DATA",
      severity: "HIGH",
      message:
        "High score is being generated while fundamental data completeness is below 80%.",
    });
  }

  // BUY + incomplete data
  if (
    action === "BUY" &&
    completeness !== null &&
    completeness < 80
  ) {
    flags.push({
      code: "BUY_WITH_PARTIAL_DATA",
      severity: "HIGH",
      message:
        "BUY action exists even though the underlying data is incomplete.",
    });
  }

  // Missing valuation
  if (
    valuationScore === null ||
    valuationScore === undefined
  ) {
    flags.push({
      code: "VALUATION_MISSING",
      severity: "MEDIUM",
      message:
        "Valuation score is unavailable. Review PE/PB and other valuation inputs.",
    });
  }

  // Very low data
  if (
    completeness !== null &&
    completeness < 30
  ) {
    flags.push({
      code: "VERY_LOW_DATA",
      severity: "CRITICAL",
      message:
        "Fundamental data is too incomplete for a reliable score.",
    });
  }

  // Partial data
  else if (
    completeness !== null &&
    completeness < 80
  ) {
    flags.push({
      code: "PARTIAL_DATA",
      severity: "MEDIUM",
      message:
        "Important fundamental fields are missing.",
    });
  }

  // Bank-specific
  if (
    sector === "BANK" &&
    completeness !== null &&
    completeness < 80
  ) {
    flags.push({
      code: "BANK_DATA_INCOMPLETE",
      severity: "HIGH",
      message:
        "Bank analysis requires banking-specific metrics such as asset quality and capital strength.",
    });
  }

  // Other sector
  if (
    sector === "OTHER"
  ) {
    flags.push({
      code: "SECTOR_UNCLASSIFIED",
      severity: "MEDIUM",
      message:
        "Sector is classified as OTHER. Sector-specific scoring may be limited.",
    });
  }

  // Extremely high score
  if (
    score !== null &&
    score >= 90
  ) {
    flags.push({
      code: "CALIBRATION_REVIEW",
      severity: "MEDIUM",
      message:
        "Score is in the extreme high range and should be reviewed during model calibration.",
    });
  }

  // High score + high risk
  if (
    score !== null &&
    score >= 80 &&
    risk === "HIGH"
  ) {
    flags.push({
      code: "HIGH_SCORE_HIGH_RISK",
      severity: "HIGH",
      message:
        "The stock has both a high score and high risk. Risk weighting should be reviewed.",
    });
  }

  return flags;
}

// ------------------------------------------------------------
// GET
// ------------------------------------------------------------

export async function GET() {
  try {
    // --------------------------------------------------------
    // 1. GET HOLDINGS
    //
    // IMPORTANT:
    // Only request instrument_id.
    // Do NOT assume avg_price/current_value/etc.
    // --------------------------------------------------------

    const {
      data: holdings,
      error: holdingsError,
    } = await supabase
      .from("holdings")
      .select("instrument_id");

    if (holdingsError) {
      throw new Error(
        `Holdings query failed: ${holdingsError.message}`
      );
    }

    if (
      !holdings ||
      holdings.length === 0
    ) {
      return NextResponse.json({
        success: true,
        message: "No holdings found.",
        diagnostics: [],
      });
    }

    // --------------------------------------------------------
    // 2. UNIQUE INSTRUMENT IDS
    // --------------------------------------------------------

    const instrumentIds = [
      ...new Set(
        holdings
          .map(
            (h) => h.instrument_id
          )
          .filter(Boolean)
      ),
    ];

    // --------------------------------------------------------
    // 3. GET INSTRUMENTS
    // --------------------------------------------------------

    const {
      data: instruments,
      error: instrumentsError,
    } = await supabase
      .from("instruments")
      .select(`
        id,
        symbol,
        name,
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

    const instrumentMap =
      new Map(
        (instruments || []).map(
          (item) => [
            item.id,
            item,
          ]
        )
      );

    // --------------------------------------------------------
    // 4. GET AI SCORES
    // --------------------------------------------------------

    const {
      data: aiScores,
      error: scoresError,
    } = await supabase
      .from("ai_scores")
      .select(`
        instrument_id,
        action,
        rating,
        risk_level,
        total_score,
        updated_at,
        score_breakdown
      `)
      .in(
        "instrument_id",
        instrumentIds
      );

    if (scoresError) {
      throw new Error(
        `AI scores query failed: ${scoresError.message}`
      );
    }

    const scoreMap =
      new Map(
        (aiScores || []).map(
          (item) => [
            item.instrument_id,
            item,
          ]
        )
      );

    // --------------------------------------------------------
    // 5. BUILD DIAGNOSTICS
    // --------------------------------------------------------

    const diagnostics = [];

    for (
      const instrumentId of instrumentIds
    ) {
      const instrument =
        instrumentMap.get(
          instrumentId
        );

      if (!instrument) {
        continue;
      }

      const scoreRow =
        scoreMap.get(
          instrumentId
        );

      // ------------------------------------------------------
      // NO SCORE
      // ------------------------------------------------------

      if (!scoreRow) {
        diagnostics.push({
          instrument_id:
            instrument.id,

          symbol:
            instrument.symbol,

          name:
            instrument.name,

          raw_sector:
            instrument.sector,

          normalized_sector:
            normalizeSector(
              instrument.sector
            ),

          status:
            "NO_SCORE",

          score: null,
          rating: null,
          action: null,
          risk: null,

          completeness: null,
          confidence: null,

          components: {},

          valuation_score:
            null,

          flags: [
            {
              code: "NO_SCORE",
              severity: "CRITICAL",
              message:
                "No AI score exists for this instrument.",
            },
          ],
        });

        continue;
      }

      // ------------------------------------------------------
      // EXISTING BREAKDOWN
      // ------------------------------------------------------

      const breakdown =
        getBreakdown(
          scoreRow
        );

      const score =
        num(
          scoreRow.total_score
        );

      const normalizedSector =
        breakdown?.normalized_sector ||
        normalizeSector(
          instrument.sector
        );

      const completeness =
        num(
          breakdown?.data_completeness ??
          breakdown?.completeness ??
          breakdown?.data_status?.completeness
        );

      const confidence =
        num(
          breakdown?.confidence ??
          breakdown?.data_confidence ??
          breakdown?.data_status?.confidence
        );

      const valuationScore =
        num(
          breakdown?.valuation_score ??
          breakdown?.valuation?.score ??
          getComponentValue(
            breakdown,
            "valuation"
          )
        );

      const businessQuality =
        num(
          breakdown?.components?.business_quality ??
          breakdown?.components?.quality ??
          breakdown?.business_quality
        );

      const growth =
        num(
          breakdown?.components?.growth
        );

      const profitability =
        num(
          breakdown?.components?.profitability
        );

      const balance =
        num(
          breakdown?.components?.balance ??
          breakdown?.components?.balance_sheet
        );

      const cashFlow =
        num(
          breakdown?.components?.cash_flow ??
          breakdown?.components?.cash
        );

      const ownership =
        num(
          breakdown?.components?.ownership
        );

      const riskComponent =
        num(
          breakdown?.components?.risk
        );

      // ------------------------------------------------------
      // FLAGS
      // ------------------------------------------------------

      const flags =
        generateFlags({
          score,
          action:
            scoreRow.action,
          risk:
            scoreRow.risk_level,
          completeness,
          confidence,
          valuationScore,
          sector:
            normalizedSector,
        });

      // ------------------------------------------------------
      // STATUS
      // ------------------------------------------------------

      let status = "NORMAL";

      if (
        completeness !== null &&
        completeness < 30
      ) {
        status = "BLOCKED";
      } else if (
        completeness !== null &&
        completeness < 50
      ) {
        status = "PROVISIONAL";
      } else if (
        completeness !== null &&
        completeness < 80
      ) {
        status = "PARTIAL";
      }

      diagnostics.push({
        instrument_id:
          instrument.id,

        symbol:
          instrument.symbol,

        name:
          instrument.name,

        raw_sector:
          instrument.sector,

        normalized_sector:
          normalizedSector,

        status,

        score,

        rating:
          scoreRow.rating,

        action:
          scoreRow.action,

        risk:
          scoreRow.risk_level,

        completeness,

        confidence,

        components: {
          business_quality:
            businessQuality,

          growth,

          profitability,

          balance,

          cash_flow:
            cashFlow,

          ownership,

          valuation:
            valuationScore,

          risk:
            riskComponent,
        },

        valuation_score:
          valuationScore,

        score_breakdown:
          breakdown,

        flags,

        updated_at:
          scoreRow.updated_at,
      });
    }

    // --------------------------------------------------------
    // 6. SUMMARY
    // --------------------------------------------------------

    const scored =
      diagnostics.filter(
        (x) =>
          x.score !== null &&
          x.status !== "BLOCKED"
      );

    const averageScore =
      scored.length
        ? Number(
            (
              scored.reduce(
                (sum, item) =>
                  sum +
                  item.score,
                0
              ) /
              scored.length
            ).toFixed(2)
          )
        : null;

    const highScoreStocks =
      diagnostics.filter(
        (x) =>
          x.score !== null &&
          x.score >= 85
      );

    const flagged =
      diagnostics.filter(
        (x) =>
          x.flags &&
          x.flags.length > 0
      );

    const buyCandidates =
      diagnostics.filter(
        (x) =>
          x.action === "BUY"
      );

    const buyNeedsReview =
      buyCandidates.filter(
        (x) =>
          (
            x.completeness !== null &&
            x.completeness < 80
          ) ||
          (
            x.confidence !== null &&
            x.confidence < 80
          ) ||
          x.flags.some(
            (flag) =>
              flag.code ===
                "HIGH_SCORE_LOW_CONFIDENCE" ||
              flag.code ===
                "BUY_WITH_PARTIAL_DATA"
          )
      );

    // --------------------------------------------------------
    // 7. SECTOR SUMMARY
    // --------------------------------------------------------

    const sectorSummary = {};

    for (
      const item of diagnostics
    ) {
      const sector =
        item.normalized_sector ||
        "OTHER";

      if (
        !sectorSummary[sector]
      ) {
        sectorSummary[sector] = {
          total: 0,
          scored: 0,
          blocked: 0,
          scores: [],
          average_score: null,
        };
      }

      sectorSummary[sector]
        .total++;

      if (
        item.status ===
        "BLOCKED"
      ) {
        sectorSummary[
          sector
        ].blocked++;
      }

      if (
        item.score !== null
      ) {
        sectorSummary[
          sector
        ].scored++;

        sectorSummary[
          sector
        ].scores.push(
          item.score
        );
      }
    }

    for (
      const sector of Object.keys(
        sectorSummary
      )
    ) {
      const data =
        sectorSummary[
          sector
        ];

      data.average_score =
        data.scores.length
          ? Number(
              (
                data.scores.reduce(
                  (a, b) =>
                    a + b,
                  0
                ) /
                data.scores.length
              ).toFixed(2)
            )
          : null;

      delete data.scores;
    }

    // --------------------------------------------------------
    // 8. TOP SCORES
    // --------------------------------------------------------

    const topScores =
      diagnostics
        .filter(
          (x) =>
            x.score !== null
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        )
        .slice(0, 15);

    // --------------------------------------------------------
    // 9. CALIBRATION REVIEW
    // --------------------------------------------------------

    const calibrationReview =
      diagnostics
        .filter(
          (x) =>
            x.score !== null &&
            (
              x.score >= 90 ||

              (
                x.score >= 85 &&
                x.completeness !== null &&
                x.completeness < 80
              ) ||

              x.flags.some(
                (flag) =>
                  flag.code ===
                    "HIGH_SCORE_LOW_CONFIDENCE" ||
                  flag.code ===
                    "BUY_WITH_PARTIAL_DATA"
              )
            )
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        );

    // --------------------------------------------------------
    // 10. FINAL RESPONSE
    // --------------------------------------------------------

    return NextResponse.json({
      success: true,

      engine_version:
        "safe_v3",

      generated_at:
        new Date().toISOString(),

      summary: {
        total_instruments:
          diagnostics.length,

        scored:
          scored.length,

        blocked:
          diagnostics.filter(
            (x) =>
              x.status ===
              "BLOCKED"
          ).length,

        provisional:
          diagnostics.filter(
            (x) =>
              x.status ===
              "PROVISIONAL"
          ).length,

        partial:
          diagnostics.filter(
            (x) =>
              x.status ===
              "PARTIAL"
          ).length,

        normal:
          diagnostics.filter(
            (x) =>
              x.status ===
              "NORMAL"
          ).length,

        average_score:
          averageScore,

        high_score_count:
          highScoreStocks.length,

        flagged_count:
          flagged.length,

        buy_candidates:
          buyCandidates.length,

        buy_candidates_needing_review:
          buyNeedsReview.length,
      },

      sector_summary:
        sectorSummary,

      top_scores:
        topScores,

      calibration_review:
        calibrationReview,

      buy_candidates_needing_review:
        buyNeedsReview,

      diagnostics,
    });

  } catch (error) {
    console.error(
      "Score diagnostics error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Unknown diagnostic error",
      },
      {
        status: 500,
      }
    );
  }
}
