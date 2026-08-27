import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const API_KEY = process.env.BHARATSTOCK_API_KEY;

const BASE_URL = "https://bharatstockapi.com/v1/stocks";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n) ? n : null;
}

function growth(current, previous) {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined ||
    Number(previous) === 0
  ) {
    return null;
  }

  return Number(
    (((Number(current) - Number(previous)) / Number(previous)) * 100).toFixed(
      2
    )
  );
}

async function bharatStockFetch(path) {
  const response = await fetch(`${BASE_URL}/${path}`, {
    method: "GET",
    headers: {
      "X-API-Key": API_KEY,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `BharatStock ${response.status}: ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`
    );
  }

  return data;
}

export async function GET(request) {
  try {
    if (!API_KEY) {
      return NextResponse.json(
        {
          success: false,
          step: "configuration",
          error: "BHARATSTOCK_API_KEY is missing",
        },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);

    const requestedSymbol =
      searchParams.get("symbol") || "INE263A01024";

    /*
     * ---------------------------------------------------------
     * 1. FIND INSTRUMENT
     * ---------------------------------------------------------
     */

    const { data: instruments, error: instrumentError } = await supabase
      .from("instruments")
      .select("id, symbol, company_name")
      .eq("symbol", requestedSymbol)
      .limit(1);

    if (instrumentError) {
      return NextResponse.json({
        success: false,
        step: "find_instrument",
        error: instrumentError.message,
      });
    }

    if (!instruments || instruments.length === 0) {
      return NextResponse.json({
        success: false,
        step: "find_instrument",
        error: `Instrument not found for symbol ${requestedSymbol}`,
      });
    }

    const instrument = instruments[0];

    /*
     * ---------------------------------------------------------
     * 2. FINANCIALS
     * ---------------------------------------------------------
     */

    const financialResponse = await bharatStockFetch(
      `${requestedSymbol}/financials?period_type=annual&page=1&page_size=5`
    );

    const financialData = financialResponse?.data?.data;

    if (!Array.isArray(financialData) || financialData.length === 0) {
      return NextResponse.json({
        success: false,
        step: "financials",
        error: "BharatStock returned no annual financial data.",
      });
    }

    const annuals = financialData
      .filter((x) => x?.period_end_date)
      .sort(
        (a, b) =>
          new Date(b.period_end_date) -
          new Date(a.period_end_date)
      );

    const latest = annuals[0];
    const previous = annuals[1];

    if (!latest) {
      return NextResponse.json({
        success: false,
        step: "financials",
        error: "Latest financial year could not be determined.",
      });
    }

    /*
     * ---------------------------------------------------------
     * 3. CALCULATE FUNDAMENTALS
     * ---------------------------------------------------------
     */

    const salesGrowth = previous
      ? growth(latest.revenue, previous.revenue)
      : null;

    const profitGrowth = previous
      ? growth(latest.net_profit, previous.net_profit)
      : null;

    const totalEquity = numberOrNull(latest.total_equity);
    const netProfit = numberOrNull(latest.net_profit);

    const roe =
      totalEquity && totalEquity !== 0 && netProfit !== null
        ? Number(((netProfit / totalEquity) * 100).toFixed(2))
        : null;

    /*
     * Approximate ROCE using EBIT / Capital Employed.
     *
     * BharatStock ratios will also provide ROCE.
     * The ratio API value will be preferred below.
     */

    const totalAssets = numberOrNull(latest.total_assets);
    const currentLiabilities = numberOrNull(
      latest.current_liabilities
    );
    const operatingProfit = numberOrNull(
      latest.operating_profit
    );

    const capitalEmployed =
      totalAssets !== null && currentLiabilities !== null
        ? totalAssets - currentLiabilities
        : null;

    const calculatedRoce =
      capitalEmployed &&
      capitalEmployed !== 0 &&
      operatingProfit !== null
        ? Number(
            ((operatingProfit / capitalEmployed) * 100).toFixed(2)
          )
        : null;

    const debtToEquity =
      latest.debt_equity_ratio !== null &&
      latest.debt_equity_ratio !== undefined
        ? numberOrNull(latest.debt_equity_ratio)
        : 0;

    const operatingCashFlow = numberOrNull(
      latest.cash_flow_operating
    );

    /*
     * ---------------------------------------------------------
     * 4. SHAREHOLDING
     * ---------------------------------------------------------
     */

    const shareholdingResponse = await bharatStockFetch(
      `${requestedSymbol}/shareholding`
    );

    const shareholdingData = shareholdingResponse?.data?.data;

    if (
      !Array.isArray(shareholdingData) ||
      shareholdingData.length === 0
    ) {
      return NextResponse.json({
        success: false,
        step: "shareholding",
        error: "BharatStock returned no shareholding data.",
      });
    }

    const latestShareholding = shareholdingData[0];

    /*
     * ---------------------------------------------------------
     * 5. RATIOS / VALUATION
     * ---------------------------------------------------------
     */

    const ratioResponse = await bharatStockFetch(
      `${requestedSymbol}/ratios`
    );

    const ratios = ratioResponse?.data;

    if (!ratios || typeof ratios !== "object") {
      return NextResponse.json({
        success: false,
        step: "ratios",
        error: "BharatStock returned no ratio data.",
      });
    }

    /*
     * ---------------------------------------------------------
     * 6. FINAL FUNDAMENTALS RECORD
     * ---------------------------------------------------------
     */

    const record = {
      instrument_id: instrument.id,

      sales_growth: salesGrowth,
      profit_growth: profitGrowth,

      roe:
        numberOrNull(ratios.roe) !== null
          ? numberOrNull(ratios.roe)
          : roe,

      roce:
        numberOrNull(ratios.roce) !== null
          ? numberOrNull(ratios.roce)
          : calculatedRoce,

      debt_to_equity: debtToEquity,

      promoter_holding: numberOrNull(
        latestShareholding.promoter_pct
      ),

      promoter_pledge: null,

      fii_holding: numberOrNull(
        latestShareholding.fii_pct
      ),

      dii_holding: numberOrNull(
        latestShareholding.dii_pct
      ),

      operating_cash_flow: operatingCashFlow,

      free_cash_flow: null,

      financial_year: latest.fiscal_year || null,

      quarter: latest.quarter || null,

      source: "BharatStock",

      updated_at: new Date().toISOString(),

      /*
       * Valuation
       */

      market_cap: numberOrNull(ratios.market_cap),

      pe_ratio: numberOrNull(ratios.pe_ratio),

      pb_ratio: numberOrNull(ratios.pb_ratio),

      book_value_per_share: numberOrNull(
        ratios.book_value_per_share
      ),

      eps: numberOrNull(ratios.eps),

      dividend_yield: numberOrNull(
        ratios.dividend_yield
      ),

      week_52_high: numberOrNull(
        ratios.week_52_high
      ),

      week_52_low: numberOrNull(
        ratios.week_52_low
      ),

      shareholding_date:
        latestShareholding.as_on_date || null,
    };

    /*
     * ---------------------------------------------------------
     * 7. SAVE / UPSERT
     * ---------------------------------------------------------
     */

    const { data: savedRecord, error: saveError } =
      await supabase
        .from("fundamentals")
        .upsert(record, {
          onConflict: "instrument_id",
        })
        .select()
        .single();

    if (saveError) {
      return NextResponse.json({
        success: false,
        step: "save_fundamentals",
        error: saveError.message,
        record_attempted: record,
      });
    }

    /*
     * ---------------------------------------------------------
     * 8. SUCCESS
     * ---------------------------------------------------------
     */

    return NextResponse.json({
      success: true,

      message:
        `${instrument.company_name} fundamentals successfully synchronized.`,

      stock: {
        symbol: instrument.symbol,
        company_name: instrument.company_name,
        instrument_id: instrument.id,
      },

      source: "BharatStock",

      periods: {
        latest: latest.fiscal_year,
        previous: previous?.fiscal_year || null,
      },

      calculated: {
        sales_growth: salesGrowth,
        profit_growth: profitGrowth,
        roe: record.roe,
        roce: record.roce,
        debt_to_equity: debtToEquity,
        operating_cash_flow: operatingCashFlow,
      },

      shareholding: {
        as_on_date: latestShareholding.as_on_date,
        promoter_pct: record.promoter_holding,
        fii_pct: record.fii_holding,
        dii_pct: record.dii_holding,
        mutual_funds_pct:
          numberOrNull(
            latestShareholding.mutual_funds_pct
          ),
      },

      valuation: {
        market_cap: record.market_cap,
        pe_ratio: record.pe_ratio,
        pb_ratio: record.pb_ratio,
        book_value_per_share:
          record.book_value_per_share,
        eps: record.eps,
        dividend_yield: record.dividend_yield,
        week_52_high: record.week_52_high,
        week_52_low: record.week_52_low,
      },

      saved_to: "fundamentals",

      saved_record: savedRecord,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        step: "unexpected",
        error: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
