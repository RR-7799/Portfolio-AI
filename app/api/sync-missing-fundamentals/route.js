import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BHARATSTOCK_BASE_URL = "https://bharatstockapi.com";

/*
  IMPORTANT:
  BharatStock requires a ticker such as BEL, TCS, WIPRO etc.
  Our instruments table currently stores ISINs in symbol,
  so we maintain known mappings here.

  We will expand this mapping as we discover more symbols.
*/

const TICKER_MAP = {
  "INE172A01027": "CASTROLIND",
  "INE694X01030": "GGENGINEERING",
  "INE275B01026": "HUHTAMAKI",
  "INE987A01010": "MAKERSLAB",
  "INE486D01017": "RESONANCE",
  "INE560D01027": "TUNI",
  "INE882C01035": "VEERHEALTH",
  "INE051N01026": "SHREEGANESH",
  "INE094S01041": "MISHTANN",
  "INE160O01031": "MUKTAAGRI",
  "INE204N01013": "LOOKS",
  "INE313M01030": "EVEXIA",
  "INE368E01023": "BCLIND",
  "INE435E01020": "SHALIMAR",
  "INE607V01028": "VIRAMSU",
  "INE655P01029": "PANAFIC",
  "INE763M01028": "MERCURYEV",
  "INE872J01023": "DEVYANI",
};

/*
  Some BharatStock symbols may differ from exchange symbols.
  These aliases give us a second chance when the primary
  ticker doesn't work.
*/

const TICKER_ALIASES = {
  CASTROLIND: ["CASTROLIND", "CASTROL"],
  GGENGINEERING: ["GGENGINEERING", "GGENG"],
  HUHTAMAKI: ["HUHTAMAKI", "HUHTAMAKIIND"],
  MAKERSLAB: ["MAKERSLAB", "MAKERS"],
  RESONANCE: ["RESONANCE", "RESONANCE SPECIALTIES"],
  TUNI: ["TUNI", "TUNITECH"],
  VEERHEALTH: ["VEERHEALTH", "VEERHEALTHCARE"],
  SHREEGANESH: ["SHREEGANESH", "SHREEGANES"],
  MISHTANN: ["MISHTANN", "MISHTANNFOODS"],
  MUKTAAGRI: ["MUKTAAGRI", "MUKTA"],
  LOOKS: ["LOOKS", "LOOKSHEALTH"],
  EVEXIA: ["EVEXIA", "EVEXIALIFE"],
  BCLIND: ["BCLIND", "BCLENTERPRISE"],
  SHALIMAR: ["SHALIMAR", "SHALIMARPROD"],
  VIRAMSU: ["VIRAMSU", "VIRAMSUVARNA"],
  PANAFIC: ["PANAFIC", "PANAFICIND"],
  MERCURYEV: ["MERCURYEV", "MERCURYEVTECH"],
  DEVYANI: ["DEVYANI", "DEVYANIINT"],
};

/* =========================================================
   HELPERS
========================================================= */

function cleanNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    value === "null" ||
    value === "NA" ||
    value === "N/A"
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = cleanNumber(value);

    if (n !== null) return n;
  }

  return null;
}

async function bharatStockFetch(path) {
  const apiKey = process.env.BHARATSTOCK_API_KEY;

  if (!apiKey) {
    throw new Error("BHARATSTOCK_API_KEY is not configured.");
  }

  const response = await fetch(
    `${BHARATSTOCK_BASE_URL}${path}`,
    {
      method: "GET",
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  const text = await response.text();

  let json;

  try {
    json = JSON.parse(text);
  } catch {
    json = {
      success: false,
      raw: text,
    };
  }

  if (!response.ok) {
    throw new Error(
      `BharatStock ${response.status}: ${
        json?.message || json?.error || "Request failed"
      }`
    );
  }

  if (json?.success === false) {
    throw new Error(
      json?.message ||
        json?.error ||
        "BharatStock returned success=false."
    );
  }

  return json;
}

function extractFinancialData(json) {
  /*
    BharatStock financials are normally:

    {
      data: [...]
    }

    Keep this defensive because different endpoints /
    response versions can differ.
  */

  if (Array.isArray(json?.data)) {
    return json.data;
  }

  if (Array.isArray(json?.data?.data)) {
    return json.data.data;
  }

  return [];
}

function extractRatioData(json) {
  /*
    Ratios response previously observed in this project:

    {
      data: {
        pe_ratio: ...,
        pb_ratio: ...
      }
    }
  */

  if (json?.data?.data && !Array.isArray(json.data.data)) {
    return json.data.data;
  }

  if (json?.data && !Array.isArray(json.data)) {
    return json.data;
  }

  return {};
}

function extractShareholdingData(json) {
  /*
    Shareholding response previously observed:

    {
      data: {
        data: [...]
      }
    }
  */

  if (Array.isArray(json?.data?.data)) {
    return json.data.data;
  }

  if (Array.isArray(json?.data)) {
    return json.data;
  }

  return [];
}

function selectLatestFinancial(financials) {
  if (!financials.length) return null;

  /*
    Prefer annual results where possible.
  */

  const annual = financials.filter((item) => {
    const type =
      item?.period_type ||
      item?.financials_period_type ||
      item?.frequency;

    return (
      !type ||
      String(type).toLowerCase().includes("annual")
    );
  });

  const source = annual.length ? annual : financials;

  return source[0];
}

function calculateGrowth(current, previous) {
  const c = cleanNumber(current);
  const p = cleanNumber(previous);

  if (c === null || p === null || p === 0) {
    return null;
  }

  return ((c - p) / Math.abs(p)) * 100;
}

function mergeExisting(existing, incoming) {
  /*
    Never replace a useful existing value with null.

    This is critical.
  */

  const output = {
    ...(existing || {}),
  };

  for (const [key, value] of Object.entries(incoming)) {
    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      output[key] = value;
    }
  }

  return output;
}

/* =========================================================
   FINANCIAL EXTRACTION
========================================================= */

function buildFundamentals(financials, ratios, shareholding) {
  const latest = selectLatestFinancial(financials);

  const previous =
    financials.length > 1
      ? financials[1]
      : null;

  if (!latest && !ratios && !shareholding) {
    return {};
  }

  /*
    BharatStock field names can vary slightly between
    financial datasets, so use multiple possible names.
  */

  const revenue = firstNumber(
    latest?.sales,
    latest?.revenue,
    latest?.total_revenue,
    latest?.net_sales
  );

  const previousRevenue = firstNumber(
    previous?.sales,
    previous?.revenue,
    previous?.total_revenue,
    previous?.net_sales
  );

  const profit = firstNumber(
    latest?.net_profit,
    latest?.profit_after_tax,
    latest?.pat,
    latest?.profit
  );

  const previousProfit = firstNumber(
    previous?.net_profit,
    previous?.profit_after_tax,
    previous?.pat,
    previous?.profit
  );

  const salesGrowth = calculateGrowth(
    revenue,
    previousRevenue
  );

  const profitGrowth = calculateGrowth(
    profit,
    previousProfit
  );

  const latestHolding =
    Array.isArray(shareholding) &&
    shareholding.length
      ? shareholding[0]
      : null;

  return {
    sales_growth: firstNumber(
      ratios?.sales_growth,
      latest?.sales_growth,
      salesGrowth
    ),

    profit_growth: firstNumber(
      ratios?.profit_growth,
      latest?.profit_growth,
      profitGrowth
    ),

    roe: firstNumber(
      ratios?.roe,
      latest?.roe,
      latest?.return_on_equity
    ),

    roce: firstNumber(
      ratios?.roce,
      latest?.roce,
      latest?.return_on_capital_employed
    ),

    debt_to_equity: firstNumber(
      ratios?.debt_to_equity,
      latest?.debt_to_equity
    ),

    operating_cash_flow: firstNumber(
      ratios?.operating_cash_flow,
      latest?.operating_cash_flow,
      latest?.cash_from_operating_activities
    ),

    promoter_holding: firstNumber(
      ratios?.promoter_pct,
      latestHolding?.promoter_pct,
      latestHolding?.promoter_holding
    ),

    fii_holding: firstNumber(
      ratios?.fii_pct,
      latestHolding?.fii_pct,
      latestHolding?.fii_holding
    ),

    dii_holding: firstNumber(
      ratios?.dii_pct,
      latestHolding?.dii_pct,
      latestHolding?.dii_holding
    ),

    pe_ratio: firstNumber(
      ratios?.pe_ratio
    ),

    pb_ratio: firstNumber(
      ratios?.pb_ratio
    ),

    market_cap: firstNumber(
      ratios?.market_cap
    ),

    book_value_per_share: firstNumber(
      ratios?.book_value_per_share
    ),

    eps: firstNumber(
      ratios?.eps
    ),

    dividend_yield: firstNumber(
      ratios?.dividend_yield
    ),

    week_52_high: firstNumber(
      ratios?.week_52_high
    ),

    week_52_low: firstNumber(
      ratios?.week_52_low
    ),
  };
}

/* =========================================================
   TICKER RESOLUTION
========================================================= */

async function tryTicker(ticker) {
  const aliases =
    TICKER_ALIASES[ticker] || [ticker];

  const attempts = [];

  for (const candidate of aliases) {
    try {
      const stock = await bharatStockFetch(
        `/v1/stocks/${encodeURIComponent(candidate)}`
      );

      if (stock) {
        return {
          ticker: candidate,
          stock,
          attempts,
        };
      }
    } catch (error) {
      attempts.push({
        ticker: candidate,
        error: error.message,
      });
    }
  }

  return {
    ticker: null,
    stock: null,
    attempts,
  };
}

/* =========================================================
   MAIN
========================================================= */

export async function GET() {
  try {
    /* -----------------------------------------------------
       1. CHECK API KEY
    ----------------------------------------------------- */

    if (!process.env.BHARATSTOCK_API_KEY) {
      return NextResponse.json(
        {
          success: false,
          message:
            "BHARATSTOCK_API_KEY is missing in Vercel environment variables.",
        },
        { status: 500 }
      );
    }

    /* -----------------------------------------------------
       2. LOAD HOLDINGS
    ----------------------------------------------------- */

    const { data: holdings, error: holdingsError } =
      await supabase
        .from("holdings")
        .select("instrument_id")
        .not("instrument_id", "is", null);

    if (holdingsError) {
      throw new Error(
        `Holdings load failed: ${holdingsError.message}`
      );
    }

    const instrumentIds = [
      ...new Set(
        (holdings || [])
          .map((h) => h.instrument_id)
          .filter(Boolean)
      ),
    ];

    /* -----------------------------------------------------
       3. LOAD INSTRUMENTS
    ----------------------------------------------------- */

    const { data: instruments, error: instrumentsError } =
      await supabase
        .from("instruments")
        .select("*")
        .in("id", instrumentIds);

    if (instrumentsError) {
      throw new Error(
        `Instrument load failed: ${instrumentsError.message}`
      );
    }

    /* -----------------------------------------------------
       4. PROCESS ONLY MISSING FUNDAMENTALS
    ----------------------------------------------------- */

    const results = [];
    const skipped = [];
    const errors = [];

    for (const instrument of instruments || []) {
      /*
        Funds are handled separately.
      */

      if (instrument.security_type === "FUND") {
        skipped.push({
          instrument_id: instrument.id,
          company_name: instrument.company_name,
          reason: "Fund — handled by MF engine.",
        });

        continue;
      }

      /*
        Check whether fundamentals already exist.
      */

      const { data: existingFundamentals } =
        await supabase
          .from("fundamentals")
          .select("*")
          .eq("instrument_id", instrument.id)
          .maybeSingle();

      /*
        Count useful fields.
      */

      const existingValues = existingFundamentals
        ? Object.entries(existingFundamentals).filter(
            ([key, value]) =>
              ![
                "id",
                "instrument_id",
                "created_at",
                "updated_at",
              ].includes(key) &&
              value !== null &&
              value !== undefined
          ).length
        : 0;

      /*
        If we already have reasonable fundamentals,
        don't waste API calls.
      */

      if (existingValues >= 8) {
        skipped.push({
          instrument_id: instrument.id,
          company_name: instrument.company_name,
          reason: "Fundamentals already sufficiently populated.",
        });

        continue;
      }

      const isin = instrument.symbol;

      const ticker = TICKER_MAP[isin];

      if (!ticker) {
        skipped.push({
          instrument_id: instrument.id,
          symbol: isin,
          company_name: instrument.company_name,
          reason:
            "No BharatStock ticker mapping available yet.",
        });

        continue;
      }

      /* ---------------------------------------------------
         5. RESOLVE STOCK
      --------------------------------------------------- */

      const resolved = await tryTicker(ticker);

      if (!resolved.ticker) {
        errors.push({
          instrument_id: instrument.id,
          symbol: isin,
          company_name: instrument.company_name,
          ticker,
          reason: "BharatStock ticker could not be resolved.",
          attempts: resolved.attempts,
        });

        continue;
      }

      const actualTicker = resolved.ticker;

      /* ---------------------------------------------------
         6. FETCH FUNDAMENTALS DATA
      --------------------------------------------------- */

      let financialsJson = null;
      let ratiosJson = null;
      let shareholdingJson = null;

      try {
        financialsJson = await bharatStockFetch(
          `/v1/stocks/${encodeURIComponent(
            actualTicker
          )}/financials`
        );
      } catch (error) {
        console.warn(
          `Financials failed for ${actualTicker}:`,
          error.message
        );
      }

      try {
        ratiosJson = await bharatStockFetch(
          `/v1/stocks/${encodeURIComponent(
            actualTicker
          )}/ratios`
        );
      } catch (error) {
        console.warn(
          `Ratios failed for ${actualTicker}:`,
          error.message
        );
      }

      try {
        shareholdingJson = await bharatStockFetch(
          `/v1/stocks/${encodeURIComponent(
            actualTicker
          )}/shareholding`
        );
      } catch (error) {
        console.warn(
          `Shareholding failed for ${actualTicker}:`,
          error.message
        );
      }

      const financials =
        extractFinancialData(financialsJson);

      const ratios =
        extractRatioData(ratiosJson);

      const shareholding =
        extractShareholdingData(shareholdingJson);

      const incoming = buildFundamentals(
        financials,
        ratios,
        shareholding
      );

      const merged = mergeExisting(
        existingFundamentals,
        incoming
      );

      const usefulNewValues = Object.entries(
        incoming
      ).filter(
        ([, value]) =>
          value !== null &&
          value !== undefined
      ).length;

      if (usefulNewValues === 0) {
        errors.push({
          instrument_id: instrument.id,
          symbol: isin,
          company_name: instrument.company_name,
          ticker: actualTicker,
          reason:
            "BharatStock responded, but no usable fundamental values were found.",
        });

        continue;
      }

      /* ---------------------------------------------------
         7. SAVE
      --------------------------------------------------- */

      const { data: saved, error: saveError } =
        await supabase
          .from("fundamentals")
          .upsert(
            {
              instrument_id: instrument.id,
              ...merged,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "instrument_id",
            }
          )
          .select()
          .single();

      if (saveError) {
        errors.push({
          instrument_id: instrument.id,
          symbol: isin,
          company_name: instrument.company_name,
          ticker: actualTicker,
          reason: `Save failed: ${saveError.message}`,
        });

        continue;
      }

      results.push({
        instrument_id: instrument.id,
        symbol: isin,
        company_name: instrument.company_name,
        ticker: actualTicker,
        values_added: usefulNewValues,
        fundamentals_id: saved?.id || null,
      });
    }

    /* -----------------------------------------------------
       8. SUMMARY
    ----------------------------------------------------- */

    return NextResponse.json({
      success: true,

      message:
        "Missing fundamentals synchronization completed.",

      summary: {
        portfolio_instruments: instrumentIds.length,
        attempted: results.length + errors.length,
        updated: results.length,
        skipped: skipped.length,
        errors: errors.length,
      },

      updated: results,
      skipped,
      errors,
    });
  } catch (error) {
    console.error(
      "Missing fundamentals sync error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        message:
          error.message ||
          "Missing fundamentals sync failed.",
      },
      { status: 500 }
    );
  }
}
