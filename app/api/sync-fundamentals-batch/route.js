import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const BASE_URL = "https://bharatstockapi.com/v1/stocks";

const ENGINE_VERSION = "fundamentals_batch_v1";

/*
|--------------------------------------------------------------------------
| ENV
|--------------------------------------------------------------------------
*/

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const bharatStockApiKey =
  process.env.BHARATSTOCK_API_KEY;

/*
|--------------------------------------------------------------------------
| SUPABASE
|--------------------------------------------------------------------------
*/

const supabase =
  supabaseUrl && serviceRoleKey
    ? createClient(
        supabaseUrl,
        serviceRoleKey,
        {
          auth: {
            autoRefreshToken: false,
            persistSession: false,
          },
        }
      )
    : null;

/*
|--------------------------------------------------------------------------
| HELPERS
|--------------------------------------------------------------------------
*/

function numberOrNull(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function round(value, decimals = 2) {
  const n = numberOrNull(value);

  if (n === null) {
    return null;
  }

  const factor =
    10 ** decimals;

  return (
    Math.round(n * factor) /
    factor
  );
}

function extractArray(response) {
  if (Array.isArray(response)) {
    return response;
  }

  if (
    Array.isArray(
      response?.data
    )
  ) {
    return response.data;
  }

  if (
    Array.isArray(
      response?.data?.data
    )
  ) {
    return response.data.data;
  }

  return [];
}

function extractObject(response) {
  if (
    !response ||
    typeof response !== "object" ||
    Array.isArray(response)
  ) {
    return {};
  }

  if (
    response.data &&
    typeof response.data === "object" &&
    !Array.isArray(response.data)
  ) {
    if (
      response.data.data &&
      typeof response.data.data === "object" &&
      !Array.isArray(response.data.data)
    ) {
      return response.data.data;
    }

    return response.data;
  }

  return response;
}

function calculateGrowth(
  current,
  previous
) {
  const currentValue =
    numberOrNull(current);

  const previousValue =
    numberOrNull(previous);

  if (
    currentValue === null ||
    previousValue === null ||
    previousValue === 0
  ) {
    return null;
  }

  return round(
    ((currentValue -
      previousValue) /
      Math.abs(previousValue)) *
      100,
    2
  );
}

/*
|--------------------------------------------------------------------------
| NEVER OVERWRITE GOOD DATA WITH NULL
|--------------------------------------------------------------------------
*/

function preserveValue(
  incoming,
  existing
) {
  const newValue =
    numberOrNull(incoming);

  if (newValue !== null) {
    return newValue;
  }

  const oldValue =
    numberOrNull(existing);

  return oldValue;
}

/*
|--------------------------------------------------------------------------
| BHARATSTOCK REQUEST
|--------------------------------------------------------------------------
*/

async function callBharatStock(
  endpoint
) {
  const response =
    await fetch(
      `${BASE_URL}/${endpoint}`,
      {
        method: "GET",
        headers: {
          "X-API-Key":
            bharatStockApiKey,
          Accept:
            "application/json",
        },
        cache: "no-store",
      }
    );

  const text =
    await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      raw_text: text,
    };
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    error: response.ok
      ? null
      : `BharatStock ${response.status}: ${
          typeof data === "string"
            ? data
            : JSON.stringify(data)
        }`,
  };
}

/*
|--------------------------------------------------------------------------
| FETCH INSTRUMENTS
|--------------------------------------------------------------------------
*/

async function getInstruments({
  limit,
  offset,
}) {
  const {
    data,
    error,
  } = await supabase
    .from("instruments")
    .select(
      "id, symbol, company_name, sector"
    )
    .order(
      "company_name",
      {
        ascending: true,
      }
    )
    .range(
      offset,
      offset + limit - 1
    );

  if (error) {
    throw new Error(
      `Instruments query failed: ${error.message}`
    );
  }

  return data || [];
}

/*
|--------------------------------------------------------------------------
| EXISTING FUNDAMENTALS
|--------------------------------------------------------------------------
*/

async function getExisting(
  instrumentId
) {
  const {
    data,
    error,
  } = await supabase
    .from("fundamentals")
    .select("*")
    .eq(
      "instrument_id",
      instrumentId
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `Fundamentals lookup failed: ${error.message}`
    );
  }

  return data || null;
}

/*
|--------------------------------------------------------------------------
| SAVE FUNDAMENTALS
|--------------------------------------------------------------------------
*/

async function saveRecord(
  record
) {
  const {
    data,
    error,
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

  if (error) {
    throw new Error(
      `Fundamentals upsert failed: ${error.message}`
    );
  }

  return data;
}

/*
|--------------------------------------------------------------------------
| SYNC RATIOS
|--------------------------------------------------------------------------
|
| PRIORITY #1
|
| One BharatStock request gives us:
|
| PE
| PB
| EPS
| BVPS
| Market Cap
| Dividend Yield
| 52W High
| 52W Low
|
*/

async function syncRatios(
  instrument,
  existing
) {
  const api =
    await callBharatStock(
      `${instrument.symbol}/ratios`
    );

  if (!api.ok) {
    return {
      success: false,
      type: "ratios",
      status: api.status,
      error: api.error,
    };
  }

  const ratios =
    extractObject(
      api.data
    );

  const record = {
    instrument_id:
      instrument.id,

    market_cap:
      preserveValue(
        ratios.market_cap,
        existing?.market_cap
      ),

    pe_ratio:
      preserveValue(
        ratios.pe_ratio,
        existing?.pe_ratio
      ),

    pb_ratio:
      preserveValue(
        ratios.pb_ratio,
        existing?.pb_ratio
      ),

    book_value_per_share:
      preserveValue(
        ratios.book_value_per_share,
        existing?.book_value_per_share
      ),

    eps:
      preserveValue(
        ratios.eps,
        existing?.eps
      ),

    dividend_yield:
      preserveValue(
        ratios.dividend_yield,
        existing?.dividend_yield
      ),

    week_52_high:
      preserveValue(
        ratios.week_52_high,
        existing?.week_52_high
      ),

    week_52_low:
      preserveValue(
        ratios.week_52_low,
        existing?.week_52_low
      ),

    source:
      "BharatStock",

    updated_at:
      new Date().toISOString(),
  };

  const saved =
    await saveRecord(
      record
    );

  return {
    success: true,
    type: "ratios",
    status: api.status,

    valuation: {
      market_cap:
        record.market_cap,
      pe_ratio:
        record.pe_ratio,
      pb_ratio:
        record.pb_ratio,
      book_value_per_share:
        record.book_value_per_share,
      eps:
        record.eps,
      dividend_yield:
        record.dividend_yield,
      week_52_high:
        record.week_52_high,
      week_52_low:
        record.week_52_low,
    },

    saved,
  };
}

/*
|--------------------------------------------------------------------------
| SYNC FINANCIALS
|--------------------------------------------------------------------------
|
| PRIORITY #2
|
*/

async function syncFinancials(
  instrument,
  existing
) {
  const api =
    await callBharatStock(
      `${instrument.symbol}/financials?period_type=annual&page=1&page_size=5`
    );

  if (!api.ok) {
    return {
      success: false,
      type: "financials",
      status: api.status,
      error: api.error,
    };
  }

  const rows =
    extractArray(
      api.data
    );

  if (!rows.length) {
    return {
      success: false,
      type: "financials",
      status: api.status,
      error:
        "No annual financial data returned.",
    };
  }

  const annuals =
    [...rows].sort(
      (a, b) => {
        const dateA =
          a?.period_end_date
            ? new Date(
                a.period_end_date
              ).getTime()
            : 0;

        const dateB =
          b?.period_end_date
            ? new Date(
                b.period_end_date
              ).getTime()
            : 0;

        return dateB - dateA;
      }
    );

  const latest =
    annuals[0] ||
    null;

  const previous =
    annuals[1] ||
    null;

  if (!latest) {
    return {
      success: false,
      type: "financials",
      status: api.status,
      error:
        "Latest financial period unavailable.",
    };
  }

  const salesGrowth =
    previous
      ? calculateGrowth(
          latest.revenue,
          previous.revenue
        )
      : null;

  const profitGrowth =
    previous
      ? calculateGrowth(
          latest.net_profit,
          previous.net_profit
        )
      : null;

  const netProfit =
    numberOrNull(
      latest.net_profit
    );

  const totalEquity =
    numberOrNull(
      latest.total_equity
    );

  let calculatedROE =
    null;

  if (
    netProfit !== null &&
    totalEquity !== null &&
    totalEquity !== 0
  ) {
    calculatedROE =
      round(
        (netProfit /
          totalEquity) *
          100,
        2
      );
  }

  const operatingProfit =
    numberOrNull(
      latest.operating_profit
    );

  const totalAssets =
    numberOrNull(
      latest.total_assets
    );

  const currentLiabilities =
    numberOrNull(
      latest.current_liabilities
    );

  let calculatedROCE =
    null;

  if (
    operatingProfit !== null &&
    totalAssets !== null &&
    currentLiabilities !==
      null
  ) {
    const capitalEmployed =
      totalAssets -
      currentLiabilities;

    if (
      capitalEmployed > 0
    ) {
      calculatedROCE =
        round(
          (operatingProfit /
            capitalEmployed) *
            100,
          2
        );
    }
  }

  let debtToEquity =
    numberOrNull(
      latest.debt_equity_ratio
    );

  if (
    debtToEquity === null
  ) {
    const nonCurrentDebt =
      numberOrNull(
        latest.borrowings_non_current
      ) || 0;

    const currentDebt =
      numberOrNull(
        latest.borrowings_current
      ) || 0;

    const totalDebt =
      nonCurrentDebt +
      currentDebt;

    if (
      totalEquity !== null &&
      totalEquity > 0
    ) {
      debtToEquity =
        round(
          totalDebt /
            totalEquity,
          3
        );
    }
  }

  const operatingCashFlow =
    numberOrNull(
      latest.cash_flow_operating
    );

  const record = {
    instrument_id:
      instrument.id,

    sales_growth:
      preserveValue(
        salesGrowth,
        existing?.sales_growth
      ),

    profit_growth:
      preserveValue(
        profitGrowth,
        existing?.profit_growth
      ),

    roe:
      preserveValue(
        calculatedROE,
        existing?.roe
      ),

    roce:
      preserveValue(
        calculatedROCE,
        existing?.roce
      ),

    debt_to_equity:
      preserveValue(
        debtToEquity,
        existing?.debt_to_equity
      ),

    operating_cash_flow:
      preserveValue(
        operatingCashFlow,
        existing?.operating_cash_flow
      ),

    financial_year:
      latest?.fiscal_year ??
      existing?.financial_year ??
      null,

    quarter:
      latest?.quarter ??
      existing?.quarter ??
      null,

    source:
      "BharatStock",

    updated_at:
      new Date().toISOString(),
  };

  const saved =
    await saveRecord(
      record
    );

  return {
    success: true,
    type: "financials",
    status: api.status,

    latest_period:
      latest?.fiscal_year ??
      null,

    previous_period:
      previous?.fiscal_year ??
      null,

    calculated: {
      sales_growth:
        record.sales_growth,
      profit_growth:
        record.profit_growth,
      roe: record.roe,
      roce: record.roce,
      debt_to_equity:
        record.debt_to_equity,
      operating_cash_flow:
        record.operating_cash_flow,
    },

    saved,
  };
}

/*
|--------------------------------------------------------------------------
| SYNC SHAREHOLDING
|--------------------------------------------------------------------------
|
| PRIORITY #3
|
*/

async function syncShareholding(
  instrument,
  existing
) {
  const api =
    await callBharatStock(
      `${instrument.symbol}/shareholding`
    );

  if (!api.ok) {
    return {
      success: false,
      type: "shareholding",
      status: api.status,
      error: api.error,
    };
  }

  const rows =
    extractArray(
      api.data
    );

  if (!rows.length) {
    return {
      success: false,
      type: "shareholding",
      status: api.status,
      error:
        "No shareholding data returned.",
    };
  }

  const latest =
    [...rows].sort(
      (a, b) => {
        const dateA =
          a?.as_on_date
            ? new Date(
                a.as_on_date
              ).getTime()
            : 0;

        const dateB =
          b?.as_on_date
            ? new Date(
                b.as_on_date
              ).getTime()
            : 0;

        return dateB - dateA;
      }
    )[0];

  const record = {
    instrument_id:
      instrument.id,

    promoter_holding:
      preserveValue(
        latest?.promoter_pct,
        existing?.promoter_holding
      ),

    promoter_pledge:
      existing?.promoter_pledge ??
      null,

    fii_holding:
      preserveValue(
        latest?.fii_pct,
        existing?.fii_holding
      ),

    dii_holding:
      preserveValue(
        latest?.dii_pct,
        existing?.dii_holding
      ),

    shareholding_date:
      latest?.as_on_date ??
      existing?.shareholding_date ??
      null,

    source:
      "BharatStock",

    updated_at:
      new Date().toISOString(),
  };

  const saved =
    await saveRecord(
      record
    );

  return {
    success: true,
    type: "shareholding",
    status: api.status,

    ownership: {
      promoter:
        record.promoter_holding,
      fii:
        record.fii_holding,
      dii:
        record.dii_holding,
      as_on_date:
        record.shareholding_date,
    },

    saved,
  };
}

/*
|--------------------------------------------------------------------------
| COMPLETENESS
|--------------------------------------------------------------------------
*/

function calculateCompleteness(
  fundamentals
) {
  const fields = [
    "sales_growth",
    "profit_growth",
    "roe",
    "roce",
    "debt_to_equity",
    "operating_cash_flow",
    "promoter_holding",
    "fii_holding",
    "dii_holding",
    "market_cap",
    "pe_ratio",
    "pb_ratio",
    "book_value_per_share",
    "eps",
    "dividend_yield",
    "week_52_high",
    "week_52_low",
  ];

  const available =
    fields.filter(
      (field) =>
        fundamentals?.[field] !==
          null &&
        fundamentals?.[field] !==
          undefined
    ).length;

  return round(
    (available /
      fields.length) *
      100,
    1
  );
}

/*
|--------------------------------------------------------------------------
| SINGLE INSTRUMENT
|--------------------------------------------------------------------------
*/

async function processInstrument(
  instrument,
  type
) {
  const existing =
    await getExisting(
      instrument.id
    );

  /*
  |--------------------------------------------------------------------------
  | FUND INSTRUMENTS
  |--------------------------------------------------------------------------
  */

  const fundLike =
    instrument.symbol?.startsWith(
      "INF"
    ) ||
    instrument.sector ===
      "MUTUAL FUNDS & ETF";

  if (fundLike) {
    return {
      success: true,
      skipped: true,
      reason:
        "Mutual fund / ETF instrument.",
      instrument: {
        id: instrument.id,
        symbol: instrument.symbol,
        company_name:
          instrument.company_name,
      },
    };
  }

  let result;

  /*
  |--------------------------------------------------------------------------
  | TYPE SELECTION
  |--------------------------------------------------------------------------
  */

  if (type === "ratios") {
    result =
      await syncRatios(
        instrument,
        existing
      );
  } else if (
    type === "financials"
  ) {
    result =
      await syncFinancials(
        instrument,
        existing
      );
  } else if (
    type === "shareholding"
  ) {
    result =
      await syncShareholding(
        instrument,
        existing
      );
  } else {
    throw new Error(
      `Invalid type "${type}". Use ratios, financials, or shareholding.`
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Fetch updated record
  |--------------------------------------------------------------------------
  */

  const {
    data: updated,
    error,
  } = await supabase
    .from("fundamentals")
    .select("*")
    .eq(
      "instrument_id",
      instrument.id
    )
    .maybeSingle();

  if (error) {
    throw new Error(
      `Updated fundamentals query failed: ${error.message}`
    );
  }

  return {
    success:
      result?.success === true,

    instrument: {
      id: instrument.id,
      symbol: instrument.symbol,
      company_name:
        instrument.company_name,
    },

    type,

    result,

    completeness:
      calculateCompleteness(
        updated
      ),

    valuation_available:
      Boolean(
        updated?.pe_ratio !==
          null ||
        updated?.pb_ratio !==
          null ||
        updated?.eps !== null ||
        updated?.book_value_per_share !==
          null
      ),
  };
}

/*
|--------------------------------------------------------------------------
| GET
|--------------------------------------------------------------------------
|
| Example:
|
| /api/sync-fundamentals-batch?type=ratios&limit=10&offset=0
|
| type:
| ratios
| financials
| shareholding
|
| limit:
| maximum stocks to process in this request
|
| offset:
| pagination offset
|
| dry_run=true:
| inspect target stocks without calling BharatStock
|
|--------------------------------------------------------------------------
*/

export async function GET(
  request
) {
  try {
    /*
    |--------------------------------------------------------------------------
    | CONFIG
    |--------------------------------------------------------------------------
    */

    if (!supabase) {
      return NextResponse.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          step: "configuration",
          error:
            "Supabase client unavailable. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        },
        { status: 500 }
      );
    }

    if (!bharatStockApiKey) {
      return NextResponse.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          step: "configuration",
          error:
            "BHARATSTOCK_API_KEY is missing.",
        },
        { status: 500 }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | PARAMETERS
    |--------------------------------------------------------------------------
    */

    const { searchParams } =
      new URL(request.url);

    const type =
      (
        searchParams.get(
          "type"
        ) || "ratios"
      ).toLowerCase();

    let limit =
      Number(
        searchParams.get(
          "limit"
        ) || "10"
      );

    let offset =
      Number(
        searchParams.get(
          "offset"
        ) || "0"
      );

    const dryRun =
      searchParams.get(
        "dry_run"
      ) === "true";

    /*
    |--------------------------------------------------------------------------
    | SAFETY LIMITS
    |--------------------------------------------------------------------------
    */

    if (
      ![
        "ratios",
        "financials",
        "shareholding",
      ].includes(type)
    ) {
      return NextResponse.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          error:
            "Invalid type. Use ratios, financials, or shareholding.",
        },
        { status: 400 }
      );
    }

    if (
      !Number.isFinite(limit) ||
      limit < 1
    ) {
      limit = 10;
    }

    if (
      !Number.isFinite(offset) ||
      offset < 0
    ) {
      offset = 0;
    }

    /*
    |--------------------------------------------------------------------------
    | HARD REQUEST LIMIT
    |--------------------------------------------------------------------------
    |
    | Never allow a single browser request to consume
    | the entire BharatStock quota.
    |
    */

    limit =
      Math.min(
        Math.floor(limit),
        20
      );

    offset =
      Math.floor(offset);

    /*
    |--------------------------------------------------------------------------
    | GET STOCKS
    |--------------------------------------------------------------------------
    */

    const instruments =
      await getInstruments({
        limit,
        offset,
      });

    /*
    |--------------------------------------------------------------------------
    | EMPTY PAGE
    |--------------------------------------------------------------------------
    */

    if (
      !instruments.length
    ) {
      return NextResponse.json({
        success: true,
        engine_version:
          ENGINE_VERSION,
        type,
        limit,
        offset,
        processed: 0,
        message:
          "No instruments found for this page.",
        results: [],
      });
    }

    /*
    |--------------------------------------------------------------------------
    | DRY RUN
    |--------------------------------------------------------------------------
    */

    if (dryRun) {
      return NextResponse.json({
        success: true,
        engine_version:
          ENGINE_VERSION,
        type,
        limit,
        offset,
        dry_run: true,
        instruments:
          instruments.map(
            (item) => ({
              id: item.id,
              symbol: item.symbol,
              company_name:
                item.company_name,
              sector:
                item.sector,
            })
          ),
      });
    }

    /*
    |--------------------------------------------------------------------------
    | PROCESS
    |--------------------------------------------------------------------------
    */

    const results = [];

    let successCount = 0;
    let failureCount = 0;
    let rateLimitCount = 0;
    let skippedCount = 0;

    /*
    |--------------------------------------------------------------------------
    | IMPORTANT
    |--------------------------------------------------------------------------
    |
    | Process sequentially.
    |
    | Do NOT use Promise.all().
    |
    | This avoids firing many API requests at exactly
    | the same time.
    |
    */

    for (const instrument of instruments) {
      try {
        const result =
          await processInstrument(
            instrument,
            type
          );

        results.push(
          result
        );

        if (
          result.skipped
        ) {
          skippedCount++;
          continue;
        }

        if (
          result.success
        ) {
          successCount++;
        } else {
          failureCount++;

          if (
            result.result?.status ===
              429
          ) {
            rateLimitCount++;

            /*
            |--------------------------------------------------------------------------
            | Stop immediately on 429.
            |--------------------------------------------------------------------------
            |
            | Once the daily quota is exhausted there is no reason
            | to continue sending requests.
            |
            */

            break;
          }
        }

        /*
        |--------------------------------------------------------------------------
        | Small delay between requests
        |--------------------------------------------------------------------------
        */

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              250
            )
        );
      } catch (error) {
        failureCount++;

        results.push({
          success: false,
          instrument: {
            id: instrument.id,
            symbol: instrument.symbol,
            company_name:
              instrument.company_name,
          },
          type,
          error:
            error?.message ||
            "Unknown error",
        });
      }
    }

    /*
    |--------------------------------------------------------------------------
    | RESPONSE
    |--------------------------------------------------------------------------
    */

    const completed =
      successCount +
      failureCount +
      skippedCount;

    return NextResponse.json({
      success:
        rateLimitCount === 0,

      engine_version:
        ENGINE_VERSION,

      type,

      pagination: {
        requested_limit:
          limit,
        requested_offset:
          offset,
        instruments_returned:
          instruments.length,
        processed:
          completed,
      },

      summary: {
        success:
          successCount,
        failed:
          failureCount,
        rate_limited:
          rateLimitCount,
        skipped:
          skippedCount,
      },

      next_offset:
        offset +
        completed,

      has_more:
        instruments.length ===
          limit &&
        rateLimitCount ===
          0,

      results,

      notes: [
        "Requests are processed sequentially.",
        "Maximum batch size is 20.",
        "Processing stops immediately after HTTP 429.",
        "Existing good fundamentals are preserved.",
        "Mutual funds and ETF instruments are skipped.",
      ],
    });
  } catch (error) {
    console.error(
      "Fundamentals batch sync failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        engine_version:
          ENGINE_VERSION,
        step: "unexpected",
        error:
          error?.message ||
          "Unknown batch sync error.",
      },
      { status: 500 }
    );
  }
}
