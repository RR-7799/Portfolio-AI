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
    // ==================================================
    // 1. FIND BEL IN OUR DATABASE
    // ==================================================

    const { data: instrument, error: instrumentError } =
      await supabase
        .from("instruments")
        .select("id, symbol, company_name")
        .eq("company_name", "BHARAT ELECTRONICS LTD")
        .single();

    if (instrumentError || !instrument) {
      return NextResponse.json(
        {
          success: false,
          step: "find_instrument",
          error:
            instrumentError?.message ||
            "Bharat Electronics not found",
        },
        { status: 404 }
      );
    }

    // ==================================================
    // 2. CALL BHARATSTOCK API
    // ==================================================

    const response = await fetch(
      "https://bharatstockapi.com/v1/stocks/BEL/financials?period_type=annual&page=1&page_size=5",
      {
        method: "GET",
        headers: {
          "X-API-Key":
            process.env.BHARATSTOCK_API_KEY,
          "Accept": "application/json",
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

    // ==================================================
    // 3. GET FINANCIAL DATA
    // ==================================================

    const financials =
      result?.data?.data || [];

    if (financials.length === 0) {
      return NextResponse.json(
        {
          success: false,
          step: "financials",
          error:
            "BharatStock returned no annual financial data.",
        },
        { status: 404 }
      );
    }

    // ==================================================
    // 4. SORT BY DATE
    // ==================================================

    financials.sort(
      (a, b) =>
        new Date(b.period_end_date) -
        new Date(a.period_end_date)
    );

    const latest = financials[0];
    const previous = financials[1];

    // ==================================================
    // 5. SALES GROWTH
    // ==================================================

    let salesGrowth = null;

    if (
      previous?.revenue != null &&
      latest?.revenue != null &&
      Number(previous.revenue) !== 0
    ) {
      salesGrowth =
        ((Number(latest.revenue) -
          Number(previous.revenue)) /
          Number(previous.revenue)) *
        100;
    }

    // ==================================================
    // 6. PROFIT GROWTH
    // ==================================================

    let profitGrowth = null;

    if (
      previous?.net_profit != null &&
      latest?.net_profit != null &&
      Number(previous.net_profit) !== 0
    ) {
      profitGrowth =
        ((Number(latest.net_profit) -
          Number(previous.net_profit)) /
          Math.abs(
            Number(previous.net_profit)
          )) *
        100;
    }

    // ==================================================
    // 7. ROE
    // ==================================================

    let roe = null;

    if (
      latest?.net_profit != null &&
      latest?.total_equity != null &&
      Number(latest.total_equity) !== 0
    ) {
      roe =
        (Number(latest.net_profit) /
          Number(latest.total_equity)) *
        100;
    }

    // ==================================================
    // 8. ROCE
    // ==================================================

    let roce = null;

    const operatingProfit =
      Number(latest?.operating_profit || 0);

    const totalAssets =
      Number(latest?.total_assets || 0);

    const currentLiabilities =
      Number(
        latest?.current_liabilities || 0
      );

    const capitalEmployed =
      totalAssets - currentLiabilities;

    if (
      operatingProfit !== 0 &&
      capitalEmployed > 0
    ) {
      roce =
        (operatingProfit /
          capitalEmployed) *
        100;
    }

    // ==================================================
    // 9. DEBT / EQUITY
    // ==================================================

    let debtToEquity =
      latest?.debt_equity_ratio;

    if (debtToEquity == null) {
      const nonCurrentDebt =
        Number(
          latest?.borrowings_non_current || 0
        );

      const currentDebt =
        Number(
          latest?.borrowings_current || 0
        );

      const totalDebt =
        nonCurrentDebt + currentDebt;

      const equity =
        Number(
          latest?.total_equity || 0
        );

      if (equity > 0) {
        debtToEquity =
          totalDebt / equity;
      } else {
        debtToEquity = null;
      }
    }

    // ==================================================
    // 10. OPERATING CASH FLOW
    // ==================================================

    const operatingCashFlow =
      latest?.cash_flow_operating ?? null;

    // ==================================================
    // 11. PREPARE DATABASE RECORD
    // ==================================================

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
              Number(debtToEquity).toFixed(3)
            )
          : null,

      operating_cash_flow:
        operatingCashFlow != null
          ? Number(operatingCashFlow)
          : null,

      financial_year:
        latest?.fiscal_year || null,

      quarter:
        latest?.quarter || null,

      source:
        "BharatStock",

      updated_at:
        new Date().toISOString(),
    };

    // ==================================================
    // 12. SAVE TO FUNDAMENTALS
    // ==================================================

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

    // ==================================================
    // 13. SUCCESS RESPONSE
    // ==================================================

    return NextResponse.json({
      success: true,

      message:
        "BEL fundamentals successfully synchronized.",

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

      latest_period:
        latest?.fiscal_year || null,

      previous_period:
        previous?.fiscal_year || null,

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
    console.error(
      "Fundamentals sync error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        step: "unexpected_error",
        error:
          error?.message ||
          "Unknown server error",
      },
      { status: 500 }
    );
  }
}
