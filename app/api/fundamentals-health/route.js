import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const REQUIRED_FIELDS = [
  "sales_growth",
  "profit_growth",
  "roe",
  "roce",
  "debt_to_equity",
  "operating_cash_flow",
  "promoter_holding",
  "fii_holding",
  "dii_holding",
];

const VALUATION_FIELDS = [
  "pe_ratio",
  "pb_ratio",
  "market_cap",
  "book_value_per_share",
  "eps",
  "dividend_yield",
];

const BANK_FIELDS = [
  "gross_npa",
  "net_npa",
  "capital_adequacy_ratio",
  "roa",
];

function isAvailable(value) {
  return (
    value !== null &&
    value !== undefined &&
    value !== ""
  );
}

function calculateCompleteness(data, fields) {
  if (!data || fields.length === 0) {
    return 0;
  }

  const available = fields.filter((field) =>
    isAvailable(data[field])
  ).length;

  return Math.round(
    (available / fields.length) * 100
  );
}

function classifyData(
  percentage,
  availableFields
) {
  if (percentage >= 80) {
    return "COMPLETE";
  }

  if (percentage >= 50) {
    return "PARTIAL";
  }

  if (availableFields === 0) {
    return "MISSING";
  }

  return "INSUFFICIENT";
}

function getSector(instrument) {
  return (
    instrument.security_type ||
    instrument.sector ||
    "OTHER"
  ).toUpperCase();
}

export async function GET() {
  try {
    /* =====================================================
       1. LOAD PORTFOLIO HOLDINGS
    ===================================================== */

    const {
      data: holdings,
      error: holdingsError,
    } = await supabase
      .from("holdings")
      .select("instrument_id")
      .not("instrument_id", "is", null);

    if (holdingsError) {
      throw new Error(
        `Holdings error: ${holdingsError.message}`
      );
    }

    const instrumentIds = [
      ...new Set(
        (holdings || [])
          .map((item) => item.instrument_id)
          .filter(Boolean)
      ),
    ];

    /* =====================================================
       2. LOAD INSTRUMENTS
    ===================================================== */

    const {
      data: instruments,
      error: instrumentsError,
    } = await supabase
      .from("instruments")
      .select("*")
      .in("id", instrumentIds);

    if (instrumentsError) {
      throw new Error(
        `Instrument error: ${instrumentsError.message}`
      );
    }

    /* =====================================================
       3. LOAD FUNDAMENTALS
    ===================================================== */

    const {
      data: fundamentals,
      error: fundamentalsError,
    } = await supabase
      .from("fundamentals")
      .select("*")
      .in("instrument_id", instrumentIds);

    if (fundamentalsError) {
      throw new Error(
        `Fundamentals error: ${fundamentalsError.message}`
      );
    }

    const fundamentalsMap = new Map();

    for (const row of fundamentals || []) {
      fundamentalsMap.set(
        row.instrument_id,
        row
      );
    }

    /* =====================================================
       4. ANALYSE EACH INSTRUMENT
    ===================================================== */

    const stocks = [];
    const funds = [];

    for (const instrument of instruments || []) {
      const fundamentals =
        fundamentalsMap.get(instrument.id) || null;

      const isFund =
        String(instrument.security_type || "")
          .toUpperCase() === "FUND";

      if (isFund) {
        funds.push({
          instrument_id: instrument.id,
          company_name:
            instrument.company_name,
          status: "MF_ENGINE",
        });

        continue;
      }

      const availableCoreFields =
        REQUIRED_FIELDS.filter((field) =>
          isAvailable(
            fundamentals?.[field]
          )
        );

      const availableValuationFields =
        VALUATION_FIELDS.filter((field) =>
          isAvailable(
            fundamentals?.[field]
          )
        );

      const coreCompleteness =
        calculateCompleteness(
          fundamentals,
          REQUIRED_FIELDS
        );

      const valuationCompleteness =
        calculateCompleteness(
          fundamentals,
          VALUATION_FIELDS
        );

      const totalFields =
        REQUIRED_FIELDS.length +
        VALUATION_FIELDS.length;

      const totalAvailable =
        availableCoreFields.length +
        availableValuationFields.length;

      let totalCompleteness = Math.round(
        (totalAvailable / totalFields) *
          100
      );

      /* -----------------------------------------------
         BANK-SPECIFIC DATA
      ------------------------------------------------ */

      const sector =
        getSector(instrument);

      let bankCompleteness = null;

      if (sector === "BANK") {
        bankCompleteness =
          calculateCompleteness(
            fundamentals,
            BANK_FIELDS
          );
      }

      /* -----------------------------------------------
         OVERALL STATUS
      ------------------------------------------------ */

      let status = classifyData(
        totalCompleteness,
        totalAvailable
      );

      /*
        If a bank has weak bank-specific data,
        don't call it fully complete.
      */

      if (
        sector === "BANK" &&
        bankCompleteness !== null &&
        bankCompleteness < 50 &&
        status === "COMPLETE"
      ) {
        status = "PARTIAL";
      }

      stocks.push({
        instrument_id: instrument.id,

        symbol:
          instrument.symbol || null,

        company_name:
          instrument.company_name || "Unknown",

        sector,

        status,

        completeness: totalCompleteness,

        core_completeness:
          coreCompleteness,

        valuation_completeness:
          valuationCompleteness,

        bank_completeness:
          bankCompleteness,

        available_fields: [
          ...availableCoreFields,
          ...availableValuationFields,
        ],

        missing_fields: [
          ...REQUIRED_FIELDS.filter(
            (field) =>
              !availableCoreFields.includes(
                field
              )
          ),

          ...VALUATION_FIELDS.filter(
            (field) =>
              !availableValuationFields.includes(
                field
              )
          ),
        ],

        has_fundamentals:
          Boolean(fundamentals),
      });
    }

    /* =====================================================
       5. SUMMARY
    ===================================================== */

    const summary = {
      total_instruments:
        stocks.length + funds.length,

      stocks: stocks.length,

      funds: funds.length,

      complete: stocks.filter(
        (x) => x.status === "COMPLETE"
      ).length,

      partial: stocks.filter(
        (x) => x.status === "PARTIAL"
      ).length,

      insufficient: stocks.filter(
        (x) => x.status === "INSUFFICIENT"
      ).length,

      missing: stocks.filter(
        (x) => x.status === "MISSING"
      ).length,

      average_completeness:
        stocks.length
          ? Math.round(
              stocks.reduce(
                (sum, x) =>
                  sum + x.completeness,
                0
              ) / stocks.length
            )
          : 0,
    };

    /* =====================================================
       6. SCORING ELIGIBILITY
    ===================================================== */

    const scoringEligible =
      stocks.filter(
        (x) =>
          x.completeness >= 50
      );

    const provisional =
      stocks.filter(
        (x) =>
          x.completeness >= 30 &&
          x.completeness < 50
      );

    const scoringBlocked =
      stocks.filter(
        (x) =>
          x.completeness < 30
      );

    /* =====================================================
       7. SORT WORST DATA FIRST
    ===================================================== */

    const missingPriority = [
      ...scoringBlocked,
      ...provisional,
      ...stocks.filter(
        (x) =>
          x.status === "PARTIAL"
      ),
    ].sort(
      (a, b) =>
        a.completeness -
        b.completeness
    );

    /* =====================================================
       8. RESPONSE
    ===================================================== */

    return NextResponse.json({
      success: true,

      message:
        "Portfolio fundamentals health analysis completed.",

      summary,

      scoring: {
        eligible:
          scoringEligible.length,

        provisional:
          provisional.length,

        blocked:
          scoringBlocked.length,
      },

      priority_sync_queue:
        missingPriority,

      stocks,

      funds,
    });
  } catch (error) {
    console.error(
      "Fundamentals health error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          error.message ||
          "Fundamentals health check failed.",
      },
      { status: 500 }
    );
  }
}
