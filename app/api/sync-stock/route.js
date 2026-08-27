import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing.");
  }

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function cleanSymbol(symbol) {
  if (!symbol) return "";

  return String(symbol)
    .trim()
    .toUpperCase();
}

function calculateGrowth(current, previous) {
  if (!previous || previous === 0) return null;

  return Number(
    (((current - previous) / Math.abs(previous)) * 100).toFixed(2)
  );
}

function calculateROE(netProfit, equity) {
  if (!equity || equity === 0) return null;

  return Number(
    ((netProfit / equity) * 100).toFixed(2)
  );
}

function calculateROCE(ebit, equity, debt) {
  const capital =
    Number(equity || 0) +
    Number(debt || 0);

  if (!capital) return null;

  return Number(
    ((ebit / capital) * 100).toFixed(2)
  );
}

export async function GET(request) {
  try {
    const supabase = getSupabase();

    const { searchParams } =
      new URL(request.url);

    const requestedSymbol =
      cleanSymbol(
        searchParams.get("symbol")
      );

    const requestedInstrumentId =
      searchParams.get("instrument_id");

    if (
      !requestedSymbol &&
      !requestedInstrumentId
    ) {
      return NextResponse.json({
        success: false,
        error:
          "Provide symbol or instrument_id.",
        example:
          "/api/sync-stock?symbol=INE376G01013",
      });
    }

    // ==================================================
    // 1. FIND INSTRUMENT
    // ==================================================

    let instrumentQuery =
      supabase
        .from("instruments")
        .select(
          "id, symbol, company_name"
        )
        .limit(1);

    if (requestedInstrumentId) {
      instrumentQuery =
        instrumentQuery.eq(
          "id",
          requestedInstrumentId
        );
    } else {
      instrumentQuery =
        instrumentQuery.eq(
          "symbol",
          requestedSymbol
        );
    }

    const {
      data: instruments,
      error: instrumentError,
    } = await instrumentQuery;

    if (instrumentError) {
      return NextResponse.json({
        success: false,
        step: "find_instrument",
        error:
          instrumentError.message,
      });
    }

    const instrument =
      instruments?.[0];

    if (!instrument) {
      return NextResponse.json({
        success: false,
        step: "find_instrument",
        error:
          "Instrument not found.",
        requested_symbol:
          requestedSymbol || null,
        requested_instrument_id:
          requestedInstrumentId || null,
      });
    }

    const symbol =
      cleanSymbol(
        instrument.symbol
      );

    // ==================================================
    // 2. CALL BHARATSTOCK FINANCIALS
    // ==================================================

    const financialUrl =
      `https://bharatstockapi.com/v1/stocks/${encodeURIComponent(
        symbol
      )}/financials?period_type=annual&page=1&page_size=5`;

    const financialResponse =
      await fetch(financialUrl, {
        headers: {
          "X-API-Key":
            process.env.BHARATSTOCK_API_KEY,
        },
        cache: "no-store",
      });

    const financialText =
      await financialResponse.text();

    let financialJson;

    try {
      financialJson =
        JSON.parse(financialText);
    } catch {
      financialJson = null;
    }

    if (!financialResponse.ok) {
      return NextResponse.json({
        success: false,
        step: "financials",
        error:
          "BharatStock financials request failed.",
        status:
          financialResponse.status,
        response:
          financialJson ||
          financialText,
      });
    }

    const financialRows =
      financialJson?.data;

    if (
      !Array.isArray(financialRows) ||
      financialRows.length === 0
    ) {
      return NextResponse.json({
        success: false,
        step: "financials",
        error:
          "BharatStock returned no annual financial data.",
        symbol,
        company_name:
          instrument.company_name,
      });
    }

    const annualRows =
      financialRows.filter(
        (row) =>
          row.period_type === "annual"
      );

    if (annualRows.length === 0) {
      return NextResponse.json({
        success: false,
        step: "financials",
        error:
          "No annual financial records found.",
        symbol,
        company_name:
          instrument.company_name,
      });
    }

    const latest =
      annualRows[0];

    const previous =
      annualRows[1] || null;

    // ==================================================
    // 3. CALCULATE FUNDAMENTALS
    // ==================================================

    const salesGrowth =
      previous
        ? calculateGrowth(
            Number(
              latest.revenue || 0
            ),
            Number(
              previous.revenue || 0
            )
          )
        : null;

    const profitGrowth =
      previous
        ? calculateGrowth(
            Number(
              latest.net_profit_attributable_to_owners ??
              latest.net_profit ??
              0
            ),
            Number(
              previous.net_profit_attributable_to_owners ??
              previous.net_profit ??
              0
            )
          )
        : null;

    const netProfit =
      Number(
        latest.net_profit_attributable_to_owners ??
        latest.net_profit ??
        0
      );

    const equity =
      Number(
        latest.equity_attributable_to_owners ??
        latest.total_equity ??
        0
      );

    const nonCurrentBorrowings =
      Number(
        latest.borrowings_non_current ||
          0
      );

    const currentBorrowings =
      Number(
        latest.borrowings_current ||
          0
      );

    const totalDebt =
      nonCurrentBorrowings +
      currentBorrowings;

    const debtToEquity =
      equity > 0
        ? Number(
            (
              totalDebt /
              equity
            ).toFixed(4)
          )
        : null;

    const roe =
      calculateROE(
        netProfit,
        equity
      );

    const ebit =
      Number(
        latest.profit_before_tax ||
          0
      ) +
      Number(
        latest.finance_costs ||
          0
      );

    const roce =
      calculateROCE(
        ebit,
        equity,
        totalDebt
      );

    const operatingCashFlow =
      Number(
        latest.cash_flow_operating ||
          0
      );

    // ==================================================
    // 4. CALL SHAREHOLDING
    // ==================================================

    let promoterHolding = null;
    let fiiHolding = null;
    let diiHolding = null;
    let shareholdingDate = null;

    const shareUrl =
      `https://bharatstockapi.com/v1/stocks/${encodeURIComponent(
        symbol
      )}/shareholding?page=1&page_size=20`;

    try {
      const shareResponse =
        await fetch(shareUrl, {
          headers: {
            "X-API-Key":
              process.env.BHARATSTOCK_API_KEY,
          },
          cache: "no-store",
        });

      const shareText =
        await shareResponse.text();

      let shareJson;

      try {
        shareJson =
          JSON.parse(shareText);
      } catch {
        shareJson = null;
      }

      const shareRows =
        shareJson?.data;

      if (
        shareResponse.ok &&
        Array.isArray(shareRows) &&
        shareRows.length > 0
      ) {
        const latestShareholding =
          shareRows[0];

        promoterHolding =
          latestShareholding.promoter_pct ??
          null;

        fiiHolding =
          latestShareholding.fii_pct ??
          null;

        diiHolding =
          latestShareholding.dii_pct ??
          null;

        shareholdingDate =
          latestShareholding.as_on_date ??
          null;
      }
    } catch (shareError) {
      console.error(
        "Shareholding error:",
        shareError
      );
    }

    // ==================================================
    // 5. CALL VALUATION
    // ==================================================

    let marketCap = null;
    let peRatio = null;
    let pbRatio = null;
    let bookValuePerShare = null;
    let eps = null;
    let dividendYield = null;
    let week52High = null;
    let week52Low = null;
    let valuationDate = null;

    const valuationUrl =
      `https://bharatstockapi.com/v1/stocks/${encodeURIComponent(
        symbol
      )}/ratios`;

    try {
      const valuationResponse =
        await fetch(valuationUrl, {
          headers: {
            "X-API-Key":
              process.env.BHARATSTOCK_API_KEY,
          },
          cache: "no-store",
        });

      const valuationText =
        await valuationResponse.text();

      let valuationJson;

      try {
        valuationJson =
          JSON.parse(
            valuationText
          );
      } catch {
        valuationJson = null;
      }

      if (
        valuationResponse.ok &&
        valuationJson?.data
      ) {
        const valuation =
          valuationJson.data;

        valuationDate =
          valuation.as_of_date ??
          null;

        marketCap =
          valuation.market_cap ??
          null;

        peRatio =
          valuation.pe_ratio ??
          null;

        pbRatio =
          valuation.pb_ratio ??
          null;

        bookValuePerShare =
          valuation.book_value_per_share ??
          null;

        eps =
          valuation.eps ??
          null;

        dividendYield =
          valuation.dividend_yield ??
          null;

        week52High =
          valuation.week_52_high ??
          null;

        week52Low =
          valuation.week_52_low ??
          null;
      }
    } catch (valuationError) {
      console.error(
        "Valuation error:",
        valuationError
      );
    }

    // ==================================================
    // 6. SAVE FUNDAMENTALS
    // ==================================================

    const record = {
      instrument_id:
        instrument.id,

      sales_growth:
        salesGrowth,

      profit_growth:
        profitGrowth,

      roe,

      roce,

      debt_to_equity:
        debtToEquity,

      promoter_holding:
        promoterHolding,

      promoter_pledge:
        null,

      fii_holding:
        fiiHolding,

      dii_holding:
        diiHolding,

      operating_cash_flow:
        operatingCashFlow,

      free_cash_flow:
        null,

      financial_year:
        latest.fiscal_year ||
        null,

      quarter:
        null,

      source:
        "BharatStock",

      updated_at:
        new Date().toISOString(),

      market_cap:
        marketCap,

      pe_ratio:
        peRatio,

      pb_ratio:
        pbRatio,

      book_value_per_share:
        bookValuePerShare,

      eps,

      dividend_yield:
        dividendYield,

      week_52_high:
        week52High,

      week_52_low:
        week52Low,

      shareholding_date:
        shareholdingDate,
    };

    const {
      data: saved,
      error: saveError,
    } = await supabase
      .from("fundamentals")
      .upsert(
        record,
        {
          onConflict:
            "instrument_id",
        }
      )
      .select()
      .single();

    if (saveError) {
      return NextResponse.json({
        success: false,
        step: "save_fundamentals",
        error:
          saveError.message,
        record_attempted:
          record,
      });
    }

    // ==================================================
    // 7. RESPONSE
    // ==================================================

    return NextResponse.json({
      success: true,

      message:
        `${instrument.company_name} fundamentals synchronized successfully.`,

      stock: {
        symbol:
          instrument.symbol,

        company_name:
          instrument.company_name,

        instrument_id:
          instrument.id,
      },

      source:
        "BharatStock",

      periods: {
        latest:
          latest.fiscal_year ||
          null,

        previous:
          previous?.fiscal_year ||
          null,
      },

      calculated: {
        sales_growth:
          salesGrowth,

        profit_growth:
          profitGrowth,

        roe,

        roce,

        debt_to_equity:
          debtToEquity,

        operating_cash_flow:
          operatingCashFlow,
      },

      shareholding: {
        as_on_date:
          shareholdingDate,

        promoter_pct:
          promoterHolding,

        fii_pct:
          fiiHolding,

        dii_pct:
          diiHolding,
      },

      valuation: {
        as_of_date:
          valuationDate,

        market_cap:
          marketCap,

        pe_ratio:
          peRatio,

        pb_ratio:
          pbRatio,

        book_value_per_share:
          bookValuePerShare,

        eps,

        dividend_yield:
          dividendYield,

        week_52_high:
          week52High,

        week_52_low:
          week52Low,
      },

      saved_to:
        "fundamentals",

      saved_record:
        saved,
    });

  } catch (error) {
    console.error(
      "sync-stock error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        step: "server",
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      }
    );
  }
}
