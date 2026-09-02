import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ============================================================
// SECTOR NORMALIZATION
// ============================================================

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

// ============================================================
// NUMBER HELPER
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

// ============================================================
// SCORE BREAKDOWN PARSER
// ============================================================

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

// ============================================================
// COMPONENT VALUE
// ============================================================

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

// ============================================================
// DIAGNOSTIC FLAGS
// ============================================================

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

  // High score + low confidence
  if (
    score !== null &&
    score >= 90 &&
    confidence !== null &&
    confidence < 80
  ) {
    flags.push({
      code:
        "HIGH_SCORE_LOW_CONFIDENCE",

      severity:
        "HIGH",

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
      code:
        "HIGH_SCORE_PARTIAL_DATA",

      severity:
        "HIGH",

      message:
        "High score is being generated while fundamental data completeness is below 80%.",
    });
  }

  // BUY + partial data
  if (
    action === "BUY" &&
    completeness !== null &&
    completeness < 80
  ) {
    flags.push({
      code:
        "BUY_WITH_PARTIAL_DATA",

      severity:
        "HIGH",

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
      code:
        "VALUATION_MISSING",

      severity:
        "MEDIUM",

      message:
        "Valuation score is unavailable. Review PE, PB and other valuation inputs.",
    });
  }

  // Very low data
  if (
    completeness !== null &&
    completeness < 30
  ) {
    flags.push({
      code:
        "VERY_LOW_DATA",

      severity:
        "CRITICAL",

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
      code:
        "PARTIAL_DATA",

      severity:
        "MEDIUM",

      message:
        "Important fundamental fields are missing.",
    });
  }

  // Bank-specific warning
  if (
    sector === "BANK" &&
    completeness !== null &&
    completeness < 80
  ) {
    flags.push({
      code:
        "BANK_DATA_INCOMPLETE",

      severity:
        "HIGH",

      message:
        "Bank analysis requires banking-specific metrics such as asset quality and capital strength.",
    });
  }

  // OTHER sector
  if (
    sector === "OTHER"
  ) {
    flags.push({
      code:
        "SECTOR_UNCLASSIFIED",

      severity:
        "MEDIUM",

      message:
        "Sector is classified as OTHER. Sector-specific scoring may be limited.",
    });
  }

  // 90+ score
  if (
    score !== null &&
    score >= 90
  ) {
    flags.push({
      code:
        "CALIBRATION_REVIEW",

      severity:
        "MEDIUM",

      message:
        "Score is in the extreme high range and should be reviewed during calibration.",
    });
  }

  // High score + high risk
  if (
    score !== null &&
    score >= 80 &&
    risk === "HIGH"
  ) {
    flags.push({
      code:
        "HIGH_SCORE_HIGH_RISK",

      severity:
        "HIGH",

      message:
        "The stock has both a high score and high risk. Risk weighting should be reviewed.",
    });
  }

  return flags;
}

// ============================================================
// GET
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

    // ========================================================
    // 2. UNIQUE INSTRUMENT IDS
    // ========================================================

    const instrumentIds = [
      ...new Set(
        holdings
          .map(
            (holding) =>
              holding.instrument_id
          )
          .filter(Boolean)
      ),
    ];

    // ========================================================
    // 3. INSTRUMENTS
    //
    // IMPORTANT:
    // Actual schema uses company_name.
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

    const instrumentMap =
      new Map(
        (instruments || []).map(
          (instrument) => [
            instrument.id,
            instrument,
          ]
        )
      );

    // ========================================================
    // 4. AI SCORES
    // ========================================================

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
          (score) => [
            score.instrument_id,
            score,
          ]
        )
      );

    // ========================================================
    // 5. BUILD DIAGNOSTICS
    // ========================================================

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

          company_name:
            instrument.company_name,

          raw_sector:
            instrument.sector,

          normalized_sector:
            normalizeSector(
              instrument.sector
            ),

          status:
            "NO_SCORE",

          score:
            null,

          rating:
            null,

          action:
            null,

          risk:
            null,

          completeness:
            null,

          confidence:
            null,

          components: {},

          valuation_score:
            null,

          flags: [
            {
              code:
                "NO_SCORE",

              severity:
                "CRITICAL",

              message:
                "No AI score exists for this instrument.",
            },
          ],
        });

        continue;
      }

      // ------------------------------------------------------
      // BREAKDOWN
      // ------------------------------------------------------

      const breakdown =
        getBreakdown(
          scoreRow
        );

      // ------------------------------------------------------
      // SCORE
      // ------------------------------------------------------

      const score =
        num(
          scoreRow.total_score
        );

      // ------------------------------------------------------
      // SECTOR
      // ------------------------------------------------------

      const normalizedSector =
        breakdown?.normalized_sector ||
        normalizeSector(
          instrument.sector
        );

      // ------------------------------------------------------
      // COMPLETENESS
      // ------------------------------------------------------

      const completeness =
        num(
          breakdown?.data_completeness ??
          breakdown?.completeness ??
          breakdown?.data_status?.completeness
        );

      // ------------------------------------------------------
      // CONFIDENCE
      // ------------------------------------------------------

      const confidence =
        num(
          breakdown?.confidence ??
          breakdown?.data_confidence ??
          breakdown?.data_status?.confidence
        );

      // ------------------------------------------------------
      // VALUATION
      // ------------------------------------------------------

      const valuationScore =
        num(
          breakdown?.valuation_score ??
          breakdown?.valuation?.score ??
          getComponentValue(
            breakdown,
            "valuation"
          )
        );

      // ------------------------------------------------------
      // COMPONENTS
      // ------------------------------------------------------

      const businessQuality =
        num(
          breakdown?.components
            ?.business_quality ??
          breakdown?.components
            ?.quality ??
          breakdown?.business_quality
        );

      const growth =
        num(
          breakdown?.components
            ?.growth
        );

      const profitability =
        num(
          breakdown?.components
            ?.profitability
        );

      const balance =
        num(
          breakdown?.components
            ?.balance ??
          breakdown?.components
            ?.balance_sheet
        );

      const cashFlow =
        num(
          breakdown?.components
            ?.cash_flow ??
          breakdown?.components
            ?.cash
        );

      const ownership =
        num(
          breakdown?.components
            ?.ownership
        );

      const riskComponent =
        num(
          breakdown?.components
            ?.risk
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

      let status =
        "NORMAL";

      if (
        completeness !== null &&
        completeness < 30
      ) {
        status =
          "BLOCKED";
      }

      else if (
        completeness !== null &&
        completeness < 50
      ) {
        status =
          "PROVISIONAL";
      }

      else if (
        completeness !== null &&
        completeness < 80
      ) {
        status =
          "PARTIAL";
      }

      // ------------------------------------------------------
      // RESULT
      // ------------------------------------------------------

      diagnostics.push({
        instrument_id:
          instrument.id,

        symbol:
          instrument.symbol,

        company_name:
          instrument.company_name,

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

    // ========================================================
    // 6. SCORED
    // ========================================================

    const scored =
      diagnostics.filter(
        (item) =>
          item.score !== null &&
          item.status !==
            "BLOCKED"
      );

    // ========================================================
    // 7. AVERAGE SCORE
    // ========================================================

    const averageScore =
      scored.length > 0
        ? Number(
            (
              scored.reduce(
                (
                  total,
                  item
                ) =>
                  total +
                  item.score,
                0
              ) /
              scored.length
            ).toFixed(2)
          )
        : null;

    // ========================================================
    // 8. HIGH SCORES
    // ========================================================

    const highScoreStocks =
      diagnostics.filter(
        (item) =>
          item.score !== null &&
          item.score >= 85
      );

    // ========================================================
    // 9. FLAGGED
    // ========================================================

    const flagged =
      diagnostics.filter(
        (item) =>
          item.flags &&
          item.flags.length > 0
      );

    // ========================================================
    // 10. BUY CANDIDATES
    // ========================================================

    const buyCandidates =
      diagnostics.filter(
        (item) =>
          item.action === "BUY"
      );

    // ========================================================
    // 11. BUY CANDIDATES NEEDING REVIEW
    // ========================================================

    const buyNeedsReview =
      buyCandidates.filter(
        (item) =>
          (
            item.completeness !== null &&
            item.completeness < 80
          ) ||
          (
            item.confidence !== null &&
            item.confidence < 80
          ) ||
          item.flags.some(
            (flag) =>
              flag.code ===
                "HIGH_SCORE_LOW_CONFIDENCE" ||
              flag.code ===
                "BUY_WITH_PARTIAL_DATA"
          )
      );

    // ========================================================
    // 12. SECTOR SUMMARY
    // ========================================================

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
          total:
            0,

          scored:
            0,

          blocked:
            0,

          average_score:
            null,

          scores: [],
        };
      }

      sectorSummary[
        sector
      ].total++;

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
        data.scores.length > 0
          ? Number(
              (
                data.scores.reduce(
                  (
                    a,
                    b
                  ) =>
                    a + b,
                  0
                ) /
                data.scores.length
              ).toFixed(2)
            )
          : null;

      delete data.scores;
    }

    // ========================================================
    // 13. TOP SCORES
    // ========================================================

    const topScores =
      diagnostics
        .filter(
          (item) =>
            item.score !== null
        )
        .sort(
          (a, b) =>
            b.score -
            a.score
        )
        .slice(
          0,
          15
        );

    // ========================================================
    // 14. CALIBRATION REVIEW
    // ========================================================

    const calibrationReview =
      diagnostics
        .filter(
          (item) =>
            item.score !== null &&
            (
              item.score >= 90 ||

              (
                item.score >= 85 &&
                item.completeness !== null &&
                item.completeness < 80
              ) ||

              item.flags.some(
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

    // ========================================================
    // 15. FLAG SUMMARY
    // ========================================================

    const flagSummary = {};

    for (
      const item of diagnostics
    ) {
      for (
        const flag of item.flags || []
      ) {
        if (
          !flagSummary[
            flag.code
          ]
        ) {
          flagSummary[
            flag.code
          ] = {
            count:
              0,

            severity:
              flag.severity,

            message:
              flag.message,
          };
        }

        flagSummary[
          flag.code
        ].count++;
      }
    }

    // ========================================================
    // 16. RESPONSE
    // ========================================================

    return NextResponse.json({
      success:
        true,

      engine_version:
        "safe_v3",

      diagnostic_engine:
        "score_diagnostics_v1",

      generated_at:
        new Date().toISOString(),

      summary: {
        total_instruments:
          diagnostics.length,

        scored:
          scored.length,

        blocked:
          diagnostics.filter(
            (item) =>
              item.status ===
              "BLOCKED"
          ).length,

        provisional:
          diagnostics.filter(
            (item) =>
              item.status ===
              "PROVISIONAL"
          ).length,

        partial:
          diagnostics.filter(
            (item) =>
              item.status ===
              "PARTIAL"
          ).length,

        normal:
          diagnostics.filter(
            (item) =>
              item.status ===
              "NORMAL"
          ).length,

        no_score:
          diagnostics.filter(
            (item) =>
              item.status ===
              "NO_SCORE"
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

      flag_summary:
        flagSummary,

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
        success:
          false,

        error:
          error?.message ||
          "Unknown diagnostic error",
      },
      {
        status:
          500,
      }
    );
  }
}
