import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function normalizeSector(rawSector) {
  const s = String(rawSector || "").toUpperCase();

  if (
    s.includes("BANK") ||
    s.includes("BANKING")
  ) {
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

function num(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function getBreakdown(scoreRow) {
  if (!scoreRow?.score_breakdown) {
    return {};
  }

  if (typeof scoreRow.score_breakdown === "string") {
    try {
      return JSON.parse(scoreRow.score_breakdown);
    } catch {
      return {};
    }
  }

  return scoreRow.score_breakdown;
}

function getComponentValue(breakdown, key) {
  const value = breakdown?.components?.[key];

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "object") {
    return num(value.score);
  }

  return num(value);
}

// ------------------------------------------------------------
// Diagnostic flag engine
// ------------------------------------------------------------

function generateFlags({
  score,
  action,
  rating,
  risk,
  completeness,
  confidence,
  valuationScore,
  sector,
}) {
  const flags = [];

  if (score !== null && score >= 90 && confidence !== null && confidence < 80) {
    flags.push({
      code: "HIGH_SCORE_LOW_CONFIDENCE",
      severity: "HIGH",
      message:
        "Score is extremely high despite incomplete confidence. Review before treating this as a strong candidate.",
    });
  }

  if (score !== null && score >= 85 && completeness !== null && completeness < 80) {
    flags.push({
      code: "HIGH_SCORE_PARTIAL_DATA",
      severity: "HIGH",
      message:
        "High score is being produced with less than 80% data completeness.",
    });
  }

  if (
    action === "BUY" &&
    completeness !== null &&
    completeness < 80
  ) {
    flags.push({
      code: "BUY_WITH_PARTIAL_DATA",
      severity: "HIGH",
      message:
        "BUY action generated while the fundamental dataset is incomplete.",
    });
  }

  if (
    valuationScore === null ||
    valuationScore === undefined
  ) {
    flags.push({
      code: "VALUATION_MISSING",
      severity: "MEDIUM",
      message:
        "No usable valuation component was recorded. The score may be relying heavily on business-quality factors.",
    });
  }

  if (completeness !== null && completeness < 50) {
    flags.push({
      code: "VERY_LOW_DATA",
      severity: "CRITICAL",
      message:
        "Very little fundamental data is available. This stock should not be treated as reliably scored.",
    });
  } else if (completeness !== null && completeness < 80) {
    flags.push({
      code: "PARTIAL_DATA",
      severity: "MEDIUM",
      message:
        "Some important fundamental fields are missing.",
    });
  }

  if (
    sector === "BANK" &&
    completeness !== null &&
    completeness < 80
  ) {
    flags.push({
      code: "BANK_DATA_INCOMPLETE",
      severity: "HIGH",
      message:
        "Bank-specific analysis requires asset-quality and capital data. Review missing banking metrics.",
    });
  }

  if (sector === "OTHER") {
    flags.push({
      code: "SECTOR_UNCLASSIFIED",
      severity: "MEDIUM",
      message:
        "Stock is still classified as OTHER. Sector-specific scoring may therefore be limited.",
    });
  }

  if (
    score !== null &&
    score >= 90
  ) {
    flags.push({
      code: "CALIBRATION_REVIEW",
      severity: "MEDIUM",
      message:
        "Score is in the top range. Review component-level scores before finalizing scoring thresholds.",
    });
  }

  if (
    risk === "HIGH" &&
    score !== null &&
    score >= 80
  ) {
    flags.push({
      code: "HIGH_SCORE_HIGH_RISK",
      severity: "HIGH",
      message:
        "High score and high risk coexist. The model may be rewarding fundamentals more heavily than risk.",
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
    // 1. Holdings
    // --------------------------------------------------------

    const { data: holdings, error: holdingsError } =
      await supabase
        .from("holdings")
        .select(`
          id,
          instrument_id,
          quantity,
          avg_price,
          current_price,
          current_value
        `);

    if (holdingsError) {
      throw new Error(
        `Holdings query failed: ${holdingsError.message}`
      );
    }

    if (!holdings || holdings.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No holdings found.",
        diagnostics: [],
      });
    }

    // --------------------------------------------------------
    // 2. Instruments
    // --------------------------------------------------------

    const instrumentIds = [
      ...new Set(
        holdings
          .map((h) => h.instrument_id)
          .filter(Boolean)
      ),
    ];

    const { data: instruments, error: instrumentsError } =
      await supabase
        .from("instruments")
        .select(`
          id,
          symbol,
          name,
          sector
        `)
        .in("id", instrumentIds);

    if (instrumentsError) {
      throw new Error(
        `Instruments query failed: ${instrumentsError.message}`
      );
    }

    const instrumentMap = new Map(
      (instruments || []).map((i) => [i.id, i])
    );

    // --------------------------------------------------------
    // 3. Existing AI scores
    // --------------------------------------------------------

    const { data: aiScores, error: scoresError } =
      await supabase
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
        .in("instrument_id", instrumentIds);

    if (scoresError) {
      throw new Error(
        `AI scores query failed: ${scoresError.message}`
      );
    }

    const scoreMap = new Map(
      (aiScores || []).map((s) => [s.instrument_id, s])
    );

    // --------------------------------------------------------
    // 4. Build diagnostics
    // --------------------------------------------------------

    const diagnostics = [];

    for (const holding of holdings) {
      const instrument = instrumentMap.get(
        holding.instrument_id
      );

      if (!instrument) {
        continue;
      }

      const scoreRow = scoreMap.get(
        holding.instrument_id
      );

      if (!scoreRow) {
        diagnostics.push({
          instrument_id: instrument.id,
          symbol: instrument.symbol,
          name: instrument.name,

          raw_sector: instrument.sector,
          normalized_sector: normalizeSector(
            instrument.sector
          ),

          status: "NO_SCORE",

          score: null,
          rating: null,
          action: null,
          risk: null,

          completeness: null,
          confidence: null,

          components: {},
          valuation_score: null,

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

      const breakdown = getBreakdown(scoreRow);

      const score = num(scoreRow.total_score);

      const normalizedSector =
        breakdown?.normalized_sector ||
        normalizeSector(instrument.sector);

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

      const profitability =
        num(
          breakdown?.components?.profitability
        );

      const growth =
        num(
          breakdown?.components?.growth
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

      const flags = generateFlags({
        score,
        action: scoreRow.action,
        rating: scoreRow.rating,
        risk: scoreRow.risk_level,
        completeness,
        confidence,
        valuationScore,
        sector: normalizedSector,
      });

      diagnostics.push({
        instrument_id: instrument.id,

        symbol: instrument.symbol,
        name: instrument.name,

        raw_sector: instrument.sector,
        normalized_sector: normalizedSector,

        status:
          completeness !== null && completeness < 30
            ? "BLOCKED"
            : completeness !== null && completeness < 50
            ? "PROVISIONAL"
            : completeness !== null && completeness < 80
            ? "PARTIAL"
            : "NORMAL",

        score,
        rating: scoreRow.rating,
        action: scoreRow.action,
        risk: scoreRow.risk_level,

        completeness,
        confidence,

        components: {
          business_quality: businessQuality,
          growth,
          profitability,
          balance,
          cash_flow: cashFlow,
          ownership,
          valuation: valuationScore,
          risk: riskComponent,
        },

        valuation_score: valuationScore,

        score_breakdown: breakdown,

        flags,

        updated_at: scoreRow.updated_at,
      });
    }

    // --------------------------------------------------------
    // 5. Summary statistics
    // --------------------------------------------------------

    const scored = diagnostics.filter(
      (x) =>
        x.score !== null &&
        x.status !== "BLOCKED"
    );

    const highScoreStocks = diagnostics.filter(
      (x) =>
        x.score !== null &&
        x.score >= 85
    );

    const flagged = diagnostics.filter(
      (x) => x.flags && x.flags.length > 0
    );

    const buyCandidates = diagnostics.filter(
      (x) =>
        x.action === "BUY"
    );

    const buyNeedsReview = buyCandidates.filter(
      (x) =>
        (x.completeness !== null &&
          x.completeness < 80) ||
        (x.confidence !== null &&
          x.confidence < 80) ||
        x.flags.some(
          (f) =>
            f.code === "HIGH_SCORE_LOW_CONFIDENCE" ||
            f.code === "BUY_WITH_PARTIAL_DATA"
        )
    );

    const avgScore =
      scored.length > 0
        ? Number(
            (
              scored.reduce(
                (sum, x) => sum + x.score,
                0
              ) / scored.length
            ).toFixed(2)
          )
        : null;

    const sectorSummary = {};

    for (const item of diagnostics) {
      const sector =
        item.normalized_sector || "OTHER";

      if (!sectorSummary[sector]) {
        sectorSummary[sector] = {
          total: 0,
          scored: 0,
          blocked: 0,
          average_score: null,
          scores: [],
        };
      }

      sectorSummary[sector].total++;

      if (item.status === "BLOCKED") {
        sectorSummary[sector].blocked++;
      }

      if (item.score !== null) {
        sectorSummary[sector].scored++;
        sectorSummary[sector].scores.push(
          item.score
        );
      }
    }

    for (const sector of Object.keys(
      sectorSummary
    )) {
      const data =
        sectorSummary[sector];

      data.average_score =
        data.scores.length > 0
          ? Number(
              (
                data.scores.reduce(
                  (a, b) => a + b,
                  0
                ) /
                data.scores.length
              ).toFixed(2)
            )
          : null;

      delete data.scores;
    }

    // --------------------------------------------------------
    // 6. Top scoring stocks
    // --------------------------------------------------------

    const topScores = [...diagnostics]
      .filter((x) => x.score !== null)
      .sort(
        (a, b) =>
          b.score - a.score
      )
      .slice(0, 15);

    // --------------------------------------------------------
    // 7. Most suspicious scores
    // --------------------------------------------------------

    const calibrationReview = diagnostics
      .filter(
        (x) =>
          x.score !== null &&
          (
            x.score >= 90 ||
            (x.score >= 85 &&
              x.completeness !== null &&
              x.completeness < 80) ||
            x.flags.some(
              (f) =>
                f.code ===
                  "HIGH_SCORE_LOW_CONFIDENCE" ||
                f.code ===
                  "BUY_WITH_PARTIAL_DATA"
            )
          )
      )
      .sort(
        (a, b) =>
          b.score - a.score
      );

    // --------------------------------------------------------
    // 8. Response
    // --------------------------------------------------------

    return NextResponse.json({
      success: true,

      engine_version: "safe_v3",

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
              x.status === "BLOCKED"
          ).length,

        provisional:
          diagnostics.filter(
            (x) =>
              x.status === "PROVISIONAL"
          ).length,

        partial:
          diagnostics.filter(
            (x) =>
              x.status === "PARTIAL"
          ).length,

        normal:
          diagnostics.filter(
            (x) =>
              x.status === "NORMAL"
          ).length,

        average_score:
          avgScore,

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
