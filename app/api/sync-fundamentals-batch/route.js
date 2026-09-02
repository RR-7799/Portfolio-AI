import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const BASE_URL = "https://bharatstockapi.com/v1/stocks";

const ENGINE_VERSION = "fundamentals_batch_v1_1";

/*
|--------------------------------------------------------------------------
| ENVIRONMENT
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

function round(
  value,
  decimals = 2
) {
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
    (
      (
        currentValue -
        previousValue
      ) /
      Math.abs(previousValue)
    ) * 100,
    2
  );
}

/*
|--------------------------------------------------------------------------
| PRESERVE EXISTING DATA
|--------------------------------------------------------------------------
|
| Never overwrite good existing values with null.
|
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
  if (!bharatStockApiKey) {
    return {
      ok: false,
      status: 0,
      error:
        "BHARATSTOCK_API_KEY is missing.",
      data: null,
    };
  }

  try {
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

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error:
          `BharatStock ${response.status}: ${
            typeof data === "string"
              ? data
              : JSON.stringify(data)
          }`,
        data,
      };
    }

    return {
      ok: true,
      status: response.status,
      error: null,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error:
        error?.message ||
        "Unknown BharatStock request error.",
      data: null,
    };
  }
}

/*
|--------------------------------------------------------------------------
| GET INSTRUMENTS
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
| GET EXISTING FUNDAMENTALS
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
| Gives:
|
| PE
| PB
| EPS
| BVPS
| MARKET CAP
| DIVIDEND YIELD
| 52W HIGH
| 52W LOW
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
    annuals[0] || null;

  const previous =
    annuals[1] || null;

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
        (
          netProfit /
          totalEquity
        ) * 100,
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
          (
            operatingProfit /
            capitalEmployed
          ) * 100,
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
    (
      available /
      fields.length
    ) * 100,
    1
  );
}

/*
|--------------------------------------------------------------------------
| IS MUTUAL FUND / ETF?
|--------------------------------------------------------------------------
*/

function isFundLike(
  instrument
) {
  const symbol =
    String(
      instrument?.symbol || ""
    ).toUpperCase();

  const sector =
    String(
      instrument?.sector || ""
    ).toUpperCase();

  return (
    symbol.startsWith("INF") ||
    sector ===
      "MUTUAL FUNDS & ETF"
  );
}

/*
|--------------------------------------------------------------------------
| PROCESS ONE INSTRUMENT
|--------------------------------------------------------------------------
*/

async function processInstrument(
  instrument,
  type
) {
  /*
  |--------------------------------------------------------------------------
  | Skip funds
  |--------------------------------------------------------------------------
  */

  if (
    isFundLike(
      instrument
    )
  ) {
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

  /*
  |--------------------------------------------------------------------------
  | Existing record
  |--------------------------------------------------------------------------
  */

  const existing =
    await getExisting(
      instrument.id
    );

  let result;

  /*
  |--------------------------------------------------------------------------
  | TYPE
  |--------------------------------------------------------------------------
  */

  if (
    type === "ratios"
  ) {
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
      `Invalid type "${type}".`
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Fetch updated fundamentals
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

    skipped: false,

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
        updated?.eps !==
          null ||
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
| Examples:
|
| /api/sync-fundamentals-batch?type=ratios&limit=10&offset=0
|
| /api/sync-fundamentals-batch?type=financials&limit=10&offset=0
|
| /api/sync-fundamentals-batch?type=shareholding&limit=10&offset=0
|
|--------------------------------------------------------------------------
*/

export async function GET(
  request
) {
  try {
    /*
    |--------------------------------------------------------------------------
    | CONFIGURATION
    |--------------------------------------------------------------------------
    */

    if (!supabase) {
      return NextResponse.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          error:
            "Supabase client unavailable. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        },
        {
          status: 500,
        }
      );
    }

    if (!bharatStockApiKey) {
      return NextResponse.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          error:
            "BHARATSTOCK_API_KEY is missing.",
        },
        {
          status: 500,
        }
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

    /*
    |--------------------------------------------------------------------------
    | Validate type
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
        {
          status: 400,
        }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Validate limit
    |--------------------------------------------------------------------------
    */

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
    | Safety limits
    |--------------------------------------------------------------------------
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
    | GET PAGE
    |--------------------------------------------------------------------------
    */

    const instruments =
      await getInstruments({
        limit,
        offset,
      });

    /*
    |--------------------------------------------------------------------------
    | NO DATA
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

        pagination: {
          requested_limit:
            limit,
          requested_offset:
            offset,
          instruments_returned: 0,
        },

        summary: {
          attempted: 0,
          successful: 0,
          failed: 0,
          skipped: 0,
          rate_limited: 0,
        },

        next_offset:
          offset,

        has_more: false,

        results: [],

        message:
          "No instruments found for this page.",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | COUNTERS
    |--------------------------------------------------------------------------
    */

    let attempted = 0;

    let successful = 0;

    let failed = 0;

    let skipped = 0;

    let rateLimited = 0;

    /*
    |--------------------------------------------------------------------------
    | PROGRESS
    |--------------------------------------------------------------------------
    |
    | "progressed" means the item was safely completed
    | or intentionally skipped.
    |
    | A failed item is NOT progressed.
    |
    | Therefore, when we hit 429, next_offset remains
    | positioned at the first item that still needs work.
    |
    */

    let progressed = 0;

    const results = [];

    /*
    |--------------------------------------------------------------------------
    | PROCESS SEQUENTIALLY
    |--------------------------------------------------------------------------
    */

    for (
      const instrument of instruments
    ) {
      attempted++;

      try {
        const result =
          await processInstrument(
            instrument,
            type
          );

        results.push(
          result
        );

        /*
        |--------------------------------------------------------------------------
        | MUTUAL FUND / ETF
        |--------------------------------------------------------------------------
        |
        | Skipping is safe, so this item can be considered
        | progressed.
        |
        */

        if (
          result.skipped
        ) {
          skipped++;

          progressed++;

          continue;
        }

        /*
        |--------------------------------------------------------------------------
        | SUCCESS
        |--------------------------------------------------------------------------
        */

        if (
          result.success
        ) {
          successful++;

          progressed++;
        } else {
          /*
          |--------------------------------------------------------------------------
          | FAILURE
          |--------------------------------------------------------------------------
          */

          failed++;

          /*
          |--------------------------------------------------------------------------
          | RATE LIMIT
          |--------------------------------------------------------------------------
          */

          if (
            result.result?.status ===
              429
          ) {
            rateLimited++;

            /*
            |--------------------------------------------------------------------------
            | IMPORTANT
            |--------------------------------------------------------------------------
            |
            | Do NOT increment progressed.
            |
            | This means the next request will retry
            | the exact same instrument.
            |
            */

            break;
          }
        }

        /*
        |--------------------------------------------------------------------------
        | Small delay
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
        failed++;

        results.push({
          success: false,
          skipped: false,

          instrument: {
            id: instrument.id,
            symbol:
              instrument.symbol,
            company_name:
              instrument.company_name,
          },

          type,

          error:
            error?.message ||
            "Unknown error.",
        });

        /*
        |--------------------------------------------------------------------------
        | Continue after normal errors
        |--------------------------------------------------------------------------
        |
        | We only stop automatically on 429.
        |
        */
      }
    }

    /*
    |--------------------------------------------------------------------------
    | NEXT OFFSET
    |--------------------------------------------------------------------------
    |
    | Example:
    |
    | offset = 0
    |
    | stock 0 -> success
    | stock 1 -> success
    | stock 2 -> 429
    |
    | progressed = 2
    |
    | next_offset = 2
    |
    | Therefore stock 2 will be retried next time.
    |
    */

    const nextOffset =
      offset + progressed;

    /*
    |--------------------------------------------------------------------------
    | MORE DATA?
    |--------------------------------------------------------------------------
    |
    | If 429 occurs, there may be more data, but we deliberately
    | report has_more=false for this request because the API quota
    | has stopped processing.
    |
    */

    const hasMore =
      rateLimited === 0 &&
      instruments.length ===
        limit &&
      nextOffset <
        offset +
          instruments.length;

    /*
    |--------------------------------------------------------------------------
    | RESPONSE STATUS
    |--------------------------------------------------------------------------
    */

    let responseStatus = 200;

    if (
      rateLimited > 0
    ) {
      responseStatus = 429;
    }

    /*
    |--------------------------------------------------------------------------
    | FINAL RESPONSE
    |--------------------------------------------------------------------------
    */

    return NextResponse.json(
      {
        success:
          rateLimited === 0 &&
          failed === 0,

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

          attempted,

          progressed,

          next_offset:
            nextOffset,
        },

        summary: {
          attempted,

          successful,

          failed,

          skipped,

          rate_limited:
            rateLimited,
        },

        resume: {
          safe_to_resume:
            true,

          next_offset:
            nextOffset,

          retry_same_instrument:
            rateLimited > 0,

          message:
            rateLimited > 0
              ? "BharatStock rate limit reached. Resume from next_offset; the rate-limited instrument was not marked as completed."
              : "Batch completed normally.",
        },

        has_more:
          hasMore,

        results,

        notes: [
          "Requests are processed sequentially.",
          "Maximum batch size is 20.",
          "Existing good fundamentals are preserved.",
          "Mutual funds and ETFs are skipped.",
          "A rate-limited instrument is never counted as completed.",
          "Processing stops immediately after HTTP 429.",
          "next_offset always points to the first item still requiring processing.",
        ],
      },
      {
        status: responseStatus,
      }
    );
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
      {
        status: 500,
      }
    );
  }
}
