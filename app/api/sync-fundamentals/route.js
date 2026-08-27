import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

export async function GET() {
  try {
    // --------------------------------------------------
    // 1. FIND BEL IN OUR DATABASE
    // --------------------------------------------------

    const { data: instrument, error: instrumentError } =
      await supabase
        .from("instruments")
        .select("id, symbol, company_name")
        .eq("symbol", "BEL")
        .single();

    if (instrumentError || !instrument) {
      return NextResponse.json(
        {
          success: false,
          step: "find_instrument",
          error:
            instrumentError?.message ||
            "BEL not found in instruments",
        },
        { status: 404 }
      );
    }

    // --------------------------------------------------
    // 2. CALL BHARATSTOCK
    // --------------------------------------------------

    const response = await fetch(
      "https://bharatstockapi.com/v1/stocks/BEL/financials?period_type=annual&page=1&page_size=5",
      {
        headers: {
          "X-API-Key":
            process.env.BHARATSTOCK_API_KEY,
        },
        cache: "no-store",
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          step: "bharatstock",
          status: response.status,
          error: result,
        },
        { status: response.status }
      );
    }

    const financials =
      result?.data || [];

    if (financials.length === 0) {
      return NextResponse.json(
        {
          success: false,
          step: "financials",
          error:
            "No annual financial data returned.",
        },
        { status: 404 }
      );
    }

    // --------------------------------------------------
    // 3. SORT BY DATE
    // --------------------------------------------------

    financials.sort(
      (a, b) =>
        new Date(b.period_end_date) -
        new Date(a.period_end_date)
    );

    const latest = financials[0];
    const previous = financials[1];

    // --------------------------------------------------
    // 4. CALCULATE SALES GROWTH
    // --------------------------------------------------

    let salesGrowth = null;

    if (
      previous?.revenue &&
      latest?.revenue
    ) {
      salesGrowth =
        ((latest.revenue -
          previous.revenue) /
          previous.revenue) *
        100;
    }

    // --------------------------------------------------
    // 5. CALCULATE PROFIT GROWTH
    // --------------------------------------------------

    let profitGrowth = null;

    if (
      previous?.net_profit &&
      latest?.net_profit
    ) {
      profitGrowth =
        ((latest.net_profit -
          previous.net_profit) /
          Math.abs(previous.net_profit)) *
        100;
    }

    // --------------------------------------------------
    // 6. CALCULATE ROE
    // --------------------------------------------------

    let roe = null;

    if (
      latest?.net_profit &&
      latest?.total_equity
    ) {
      roe =
        (latest.net_profit /
          latest.total_equity) *
        100;
    }

    // --------------------------------------------------
    // 7. CALCULATE ROCE
    // --------------------------------------------------

    let roce = null;

    const operatingProfit =
      latest?.operating_profit;

    const totalAssets =
      latest?.total_assets;

    const currentLiabilities =
      latest?.current_liabilities;

    if (
      operatingProfit != null &&
      totalAssets != null &&
      currentLiabilities != null
    ) {
      const capitalEmployed =
        totalAssets -
        currentLiabilities;

      if (capitalEmployed > 0) {
        roce =
          (operatingProfit /
            capitalEmployed) *
          100;
      }
    }

    // --------------------------------------------------
    // 8. DEBT / EQUITY
    // --------------------------------------------------

    let debtToEquity =
      latest?.debt_equity_ratio;

    if (
      debtToEquity == null
    ) {
      const debt =
        Number(
          latest?.borrowings_non_current || 0
        ) +
        Number(
          latest?.borrowings_current || 0
        );

      const equity =
        Number(
          latest?.total_equity || 0
        );

      if (equity > 0) {
        debtToEquity =
          debt / equity;
      }
    }

    // --------------------------------------------------
    // 9. SAVE FUNDAMENTALS
    // --------------------------------------------------

    const record = {
      instrument_id: instrument.id,

      sales_growth:
        salesGrowth != null
          ? Number(
              salesGrowth.toFixed(2)
            )
          : null,

      profit_growth:
        profitGrowth != null
          ? Number(
              profitGrowth.toFixed(2)
            )
          : null,

      roe:
        roe != null
          ? Number(
              roe.toFixed(2)
            )
          : null,

      roce:
        roce != null
          ? Number(
              roce.toFixed(2)
            )
          : null,

      debt_to_equity:
        debtToEquity != null
          ? Number(
              debtToEquity.toFixed(3)
            )
          : null,

      operating_cash_flow:
        latest?.cash_flow_operating ??
        null,

      financial_year:
        latest?.fiscal_year ??
        null,

      quarter:
        latest?.quarter ??
        null,

      source:
        "BharatStock",

      updated_at:
        new Date().toISOString(),
    };

    const { data: saved, error: saveError } =
      await supabase
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
      return NextResponse.json(
        {
          success: false,
          step: "save_fundamentals",
          error: saveError.message,
          record_attempted: record,
        },
        { status: 500 }
      );
    }

    // --------------------------------------------------
    // 10. RETURN RESULTS
    // --------------------------------------------------

    return NextResponse.json({
      success: true,

      stock: {
        symbol: instrument.symbol,
        company_name:
          instrument.company_name,
        instrument_id:
          instrument.id,
      },

      source:
        "BharatStock",

      latest_period:
        latest?.fiscal_year,

      calculated: {
        sales_growth:
          record.sales_growth,

        profit_growth:
          record.profit_growth,

        roe:
          record.roe,

        roce:
          record.roce,

        debt_to_equity:
          record.debt_to_equity,

        operating_cash_flow:
          record.operating_cash_flow,
      },

      saved_to:
        "fundamentals",

      saved_record:
        saved,
    });

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        step: "unexpected_error",
        error: error.message,
      },
      { status: 500 }
    );
  }
}
