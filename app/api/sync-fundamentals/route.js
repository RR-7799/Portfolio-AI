import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const BASE_URL = "https://bharatstockapi.com/v1/stocks";

const ENGINE_VERSION = "fundamentals_sync_v2";

/*
|--------------------------------------------------------------------------
| SUPABASE
|--------------------------------------------------------------------------
*/

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bharatStockApiKey = process.env.BHARATSTOCK_API_KEY;

if (!supabaseUrl || !serviceRoleKey || !bharatStockApiKey) {
  console.error(
    "Missing required environment variables."
  );
}

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

  return Number.isFinite(n) ? n : null;
}

function round(value, decimals = 2) {
  const n = numberOrNull(value);

  if (n === null) {
    return null;
  }

  const factor = 10 ** decimals;

  return Math.round(n * factor) / factor;
}

function calculateGrowth(current, previous) {
  const currentValue = numberOrNull(current);
  const previousValue = numberOrNull(previous);

  if (
    currentValue === null ||
    previousValue === null ||
    previousValue === 0
  ) {
    return null;
  }

  return round(
    ((currentValue - previousValue) /
      Math.abs(previousValue)) *
      100,
    2
  );
}

/*
|--------------------------------------------------------------------------
| DEEP RESPONSE HELPERS
|--------------------------------------------------------------------------
|
| BharatStock uses slightly different response shapes for different
| endpoint types. These helpers intentionally support both current
| documented shapes and the shapes seen in your previous tests.
|
*/

function extractArray(response) {
  if (Array.isArray(response)) {
    return response;
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  if (Array.isArray(response?.data?.data)) {
    return response.data.data;
  }

  if (Array.isArray(response?.results)) {
    return response.results;
  }

  return [];
}

function extractObject(response) {
  if (
    response &&
    typeof response === "object" &&
    !Array.isArray(response)
  ) {
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

  return {};
}

/*
|--------------------------------------------------------------------------
| BHARATSTOCK REQUEST
|--------------------------------------------------------------------------
*/

async function callBharatStock(
  endpoint,
  options = {}
) {
  const {
    retries = 2,
    retryDelayMs = 1200,
  } = options;

  if (!bharatStockApiKey) {
    throw new Error(
      "BHARATSTOCK_API_KEY is missing."
    );
  }

  const url =
    `${BASE_URL}/${endpoint}`;

  let lastError = null;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt++
  ) {
    try {
      const response = await fetch(
        url,
        {
          method: "GET",
          headers: {
            "X-API-Key": bharatStockApiKey,
            Accept: "application/json",
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

      /*
      |--------------------------------------------------------------------------
      | SUCCESS
      |--------------------------------------------------------------------------
      */

      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          data,
          endpoint,
        };
      }

      /*
      |--------------------------------------------------------------------------
      | RATE LIMIT
      |--------------------------------------------------------------------------
      */

      if (response.status === 429) {
        lastError = new Error(
          `BharatStock 429: ${JSON.stringify(
            data
          )}`
        );

        if (attempt < retries) {
          await new Promise(
            (resolve) =>
              setTimeout(
                resolve,
                retryDelayMs *
                  (attempt + 1)
              )
          );

          continue;
        }

        return {
          ok: false,
          status: 429,
          error: lastError.message,
          endpoint,
          data,
        };
      }

      /*
      |--------------------------------------------------------------------------
      | OTHER HTTP ERROR
      |--------------------------------------------------------------------------
      */

      lastError = new Error(
        `BharatStock ${response.status}: ${
          typeof data === "string"
            ? data
            : JSON.stringify(data)
        }`
      );

      /*
      |--------------------------------------------------------------------------
      | Retry temporary server errors
      |--------------------------------------------------------------------------
      */

      if (
        response.status >= 500 &&
        attempt < retries
      ) {
        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              retryDelayMs *
                (attempt + 1)
            )
        );

        continue;
      }

      return {
        ok: false,
        status: response.status,
        error: lastError.message,
        endpoint,
        data,
      };
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              retryDelayMs *
                (attempt + 1)
            )
        );

        continue;
      }
    }
  }

  return {
    ok: false,
    status: 0,
    error:
      lastError?.message ||
      "Unknown BharatStock request failure.",
    endpoint,
  };
}

/*
|--------------------------------------------------------------------------
| PICK LATEST FINANCIAL YEARS
|--------------------------------------------------------------------------
*/

function sortFinancials(rows) {
  return [...rows]
    .filter(
      (item) =>
        item &&
        (
          item.period_end_date ||
          item.fiscal_year
        )
    )
    .sort((a, b) => {
      const dateA =
        a.period_end_date
          ? new Date(
              a.period_end_date
            ).getTime()
          : 0;

      const dateB =
        b.period_end_date
          ? new Date(
              b.period_end_date
            ).getTime()
          : 0;

      return dateB - dateA;
    });
}

/*
|--------------------------------------------------------------------------
| PRESERVE EXISTING GOOD DATA
|--------------------------------------------------------------------------
|
| Missing API data must never erase an existing good database value.
|
*/

function chooseNewValue(
  newValue,
  oldValue
) {
  const normalizedNew =
    numberOrNull(newValue);

  if (normalizedNew !== null) {
    return normalizedNew;
  }

  const normalizedOld =
    numberOrNull(oldValue);

  return normalizedOld;
}

/*
|--------------------------------------------------------------------------
| GET CURRENT FUNDAMENTALS
|--------------------------------------------------------------------------
*/

async function getExistingFundamentals(
  instrumentId
) {
  const { data, error } =
    await supabase
      .from("fundamentals")
      .select("*")
      .eq(
        "instrument_id",
        instrumentId
      )
      .limit(1)
      .maybeSingle();

  if (error) {
    throw new Error(
      `Existing fundamentals query failed: ${error.message}`
    );
  }

  return data || null;
}

/*
|--------------------------------------------------------------------------
| SYNC ONE INSTRUMENT
|--------------------------------------------------------------------------
*/

async function syncInstrument(
  instrument
) {
  const symbol = instrument.symbol;

  /*
  |--------------------------------------------------------------------------
  | Existing record
  |--------------------------------------------------------------------------
  */

  const existing =
    await getExistingFundamentals(
      instrument.id
    );

  /*
  |--------------------------------------------------------------------------
  | Endpoint results
  |--------------------------------------------------------------------------
  */

  const apiStatus = {
    financials: null,
    ratios: null,
    shareholding: null,
  };

  let financialResponse = null;
  let ratiosResponse = null;
  let shareholdingResponse = null;

  /*
  |--------------------------------------------------------------------------
  | 1. FINANCIALS
  |--------------------------------------------------------------------------
  */

  try {
    financialResponse =
      await callBharatStock(
        `${symbol}/financials?period_type=annual&page=1&page_size=5`
      );

    apiStatus.financials = {
      ok: financialResponse.ok,
      status:
        financialResponse.status,
      error:
        financialResponse.error ||
        null,
    };
  } catch (error) {
    apiStatus.financials = {
      ok: false,
      status: 0,
      error: error.message,
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Parse financials even when response wrapper varies
  |--------------------------------------------------------------------------
  */

  const financialRows =
    financialResponse?.ok
      ? extractArray(
          financialResponse.data
        )
      : [];

  const annuals =
    sortFinancials(
      financialRows
    );

  const latest =
    annuals[0] || null;

  const previous =
    annuals[1] || null;

  /*
  |--------------------------------------------------------------------------
  | Calculate financial metrics
  |--------------------------------------------------------------------------
  */

  const salesGrowth =
    latest && previous
      ? calculateGrowth(
          latest.revenue,
          previous.revenue
        )
      : null;

  const profitGrowth =
    latest && previous
      ? calculateGrowth(
          latest.net_profit,
          previous.net_profit
        )
      : null;

  const netProfit =
    numberOrNull(
      latest?.net_profit
    );

  const totalEquity =
    numberOrNull(
      latest?.total_equity
    );

  let calculatedROE = null;

  if (
    netProfit !== null &&
    totalEquity !== null &&
    totalEquity !== 0
  ) {
    calculatedROE = round(
      (netProfit /
        totalEquity) *
        100,
      2
    );
  }

  const operatingProfit =
    numberOrNull(
      latest?.operating_profit
    );

  const totalAssets =
    numberOrNull(
      latest?.total_assets
    );

  const currentLiabilities =
    numberOrNull(
      latest?.current_liabilities
    );

  let calculatedROCE = null;

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
      calculatedROCE = round(
        (operatingProfit /
          capitalEmployed) *
          100,
        2
      );
    }
  }

  let debtToEquity =
    numberOrNull(
      latest?.debt_equity_ratio
    );

  if (
    debtToEquity === null &&
    latest
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
      latest?.cash_flow_operating
    );

  /*
  |--------------------------------------------------------------------------
  | 2. RATIOS
  |--------------------------------------------------------------------------
  */

  try {
    ratiosResponse =
      await callBharatStock(
        `${symbol}/ratios`
      );

    apiStatus.ratios = {
      ok: ratiosResponse.ok,
      status:
        ratiosResponse.status,
      error:
        ratiosResponse.error ||
        null,
    };
  } catch (error) {
    apiStatus.ratios = {
      ok: false,
      status: 0,
      error: error.message,
    };
  }

  const ratios =
    ratiosResponse?.ok
      ? extractObject(
          ratiosResponse.data
        )
      : {};

  /*
  |--------------------------------------------------------------------------
  | 3. SHAREHOLDING
  |--------------------------------------------------------------------------
  */

  try {
    shareholdingResponse =
      await callBharatStock(
        `${symbol}/shareholding`
      );

    apiStatus.shareholding = {
      ok:
        shareholdingResponse.ok,
      status:
        shareholdingResponse.status,
      error:
        shareholdingResponse.error ||
        null,
    };
  } catch (error) {
    apiStatus.shareholding = {
      ok: false,
      status: 0,
      error: error.message,
    };
  }

  const shareholdingRows =
    shareholdingResponse?.ok
      ? extractArray(
          shareholdingResponse.data
        )
      : [];

  /*
  |--------------------------------------------------------------------------
  | Find latest shareholding record
  |--------------------------------------------------------------------------
  */

  const latestShareholding =
    [...shareholdingRows]
      .sort((a, b) => {
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
      })[0] || null;

  /*
  |--------------------------------------------------------------------------
  | Extract shareholding
  |--------------------------------------------------------------------------
  */

  const promoterHolding =
    numberOrNull(
      latestShareholding?.promoter_pct
    );

  const fiiHolding =
    numberOrNull(
      latestShareholding?.fii_pct
    );

  const diiHolding =
    numberOrNull(
      latestShareholding?.dii_pct
    );

  /*
  |--------------------------------------------------------------------------
  | BUILD RECORD
  |--------------------------------------------------------------------------
  */

  const record = {
    instrument_id:
      instrument.id,

    /*
    |--------------------------------------------------------------------------
    | Fundamentals
    |--------------------------------------------------------------------------
    */

    sales_growth:
      chooseNewValue(
        salesGrowth,
        existing?.sales_growth
      ),

    profit_growth:
      chooseNewValue(
        profitGrowth,
        existing?.profit_growth
      ),

    roe:
      chooseNewValue(
        numberOrNull(
          ratios?.roe
        ),
        calculatedROE ??
          existing?.roe
      ),

    roce:
      chooseNewValue(
        numberOrNull(
          ratios?.roce
        ),
        calculatedROCE ??
          existing?.roce
      ),

    debt_to_equity:
      chooseNewValue(
        debtToEquity,
        existing?.debt_to_equity
      ),

    operating_cash_flow:
      chooseNewValue(
        operatingCashFlow,
        existing?.operating_cash_flow
      ),

    /*
    |--------------------------------------------------------------------------
    | Free cash flow
    |--------------------------------------------------------------------------
    |
    | We don't fabricate this value.
    |
    */

    free_cash_flow:
      existing?.free_cash_flow ??
      null,

    /*
    |--------------------------------------------------------------------------
    | Shareholding
    |--------------------------------------------------------------------------
    */

    promoter_holding:
      chooseNewValue(
        promoterHolding,
        existing?.promoter_holding
      ),

    promoter_pledge:
      existing?.promoter_pledge ??
      null,

    fii_holding:
      chooseNewValue(
        fiiHolding,
        existing?.fii_holding
      ),

    dii_holding:
      chooseNewValue(
        diiHolding,
        existing?.dii_holding
      ),

    /*
    |--------------------------------------------------------------------------
    | Period metadata
    |--------------------------------------------------------------------------
    */

    financial_year:
      latest?.fiscal_year ??
      existing?.financial_year ??
      null,

    quarter:
      latest?.quarter ??
      existing?.quarter ??
      null,

    /*
    |--------------------------------------------------------------------------
    | Source
    |--------------------------------------------------------------------------
    */

    source: "BharatStock",

    updated_at:
      new Date().toISOString(),

    /*
    |--------------------------------------------------------------------------
    | Valuation
    |--------------------------------------------------------------------------
    */

    market_cap:
      chooseNewValue(
        ratios?.market_cap,
        existing?.market_cap
      ),

    pe_ratio:
      chooseNewValue(
        ratios?.pe_ratio,
        existing?.pe_ratio
      ),

    pb_ratio:
      chooseNewValue(
        ratios?.pb_ratio,
        existing?.pb_ratio
      ),

    book_value_per_share:
      chooseNewValue(
        ratios?.book_value_per_share,
        existing?.book_value_per_share
      ),

    eps:
      chooseNewValue(
        ratios?.eps,
        existing?.eps
      ),

    dividend_yield:
      chooseNewValue(
        ratios?.dividend_yield,
        existing?.dividend_yield
      ),

    week_52_high:
      chooseNewValue(
        ratios?.week_52_high,
        existing?.week_52_high
      ),

    week_52_low:
      chooseNewValue(
        ratios?.week_52_low,
        existing?.week_52_low
      ),

    shareholding_date:
      latestShareholding?.as_on_date ??
      existing?.shareholding_date ??
      null,
  };

  /*
  |--------------------------------------------------------------------------
  | Remove undefined values
  |--------------------------------------------------------------------------
  */

  for (const key of Object.keys(
    record
  )) {
    if (
      record[key] === undefined
    ) {
      record[key] = null;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Calculate completeness before/after
  |--------------------------------------------------------------------------
  */

  const trackedFields = [
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

  const presentFields =
    trackedFields.filter(
      (field) =>
        record[field] !==
          null &&
        record[field] !==
          undefined
    );

  const completeness =
    round(
      (presentFields.length /
        trackedFields.length) *
        100,
      1
    );

  /*
  |--------------------------------------------------------------------------
  | Determine whether valuation is present
  |--------------------------------------------------------------------------
  */

  const hasPE =
    numberOrNull(
      record.pe_ratio
    ) !== null;

  const hasPB =
    numberOrNull(
      record.pb_ratio
    ) !== null;

  const hasEPS =
    numberOrNull(
      record.eps
    ) !== null;

  const hasBVPS =
    numberOrNull(
      record.book_value_per_share
    ) !== null;

  const hasValuation =
    hasPE ||
    hasPB ||
    hasEPS ||
    hasBVPS;

  /*
  |--------------------------------------------------------------------------
  | Save
  |--------------------------------------------------------------------------
  */

  const {
    data: savedRecord,
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
    throw new Error(
      `Fundamentals upsert failed: ${saveError.message}`
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Endpoint health
  |--------------------------------------------------------------------------
  */

  const successfulEndpoints =
    Object.values(apiStatus).filter(
      (item) => item?.ok
    ).length;

  const failedEndpoints =
    Object.values(apiStatus).filter(
      (item) =>
        item &&
        !item.ok
    ).length;

  return {
    success: true,

    instrument: {
      id: instrument.id,
      symbol: instrument.symbol,
      company_name:
        instrument.company_name,
    },

    sync: {
      engine_version:
        ENGINE_VERSION,
      completeness,
      has_valuation:
        hasValuation,
      successful_endpoints:
        successfulEndpoints,
      failed_endpoints:
        failedEndpoints,
    },

    periods: {
      latest:
        latest?.fiscal_year ??
        null,
      previous:
        previous?.fiscal_year ??
        null,
    },

    api_status: apiStatus,

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

    ownership: {
      promoter:
        record.promoter_holding,
      fii:
        record.fii_holding,
      dii:
        record.dii_holding,
    },

    valuation: {
      market_cap:
        record.market_cap,
      pe_ratio:
        record.pe_ratio,
      pb_ratio:
        record.pb_ratio,
      book_value_per_share:
        record.book_value_per_share,
      eps: record.eps,
      dividend_yield:
        record.dividend_yield,
      week_52_high:
        record.week_52_high,
      week_52_low:
        record.week_52_low,
      available:
        hasValuation,
    },

    database: {
      saved_to:
        "fundamentals",
      saved_record:
        savedRecord,
    },
  };
}

/*
|--------------------------------------------------------------------------
| GET
|--------------------------------------------------------------------------
|
| Usage:
|
| /api/sync-fundamentals?symbol=INE263A01024
|
| If no symbol is supplied, BEL is used as the test instrument.
|
*/

export async function GET(request) {
  try {
    /*
    |--------------------------------------------------------------------------
    | Configuration
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
            "Supabase client could not be initialized. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
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
    | Request symbol
    |--------------------------------------------------------------------------
    */

    const { searchParams } =
      new URL(request.url);

    const requestedSymbol =
      searchParams.get(
        "symbol"
      ) ||
      "INE263A01024";

    /*
    |--------------------------------------------------------------------------
    | Find instrument
    |--------------------------------------------------------------------------
    */

    const {
      data: instruments,
      error: instrumentError,
    } = await supabase
      .from("instruments")
      .select(
        "id, symbol, company_name, sector"
      )
      .eq(
        "symbol",
        requestedSymbol
      )
      .limit(1);

    if (instrumentError) {
      return NextResponse.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          step: "find_instrument",
          error:
            instrumentError.message,
        },
        { status: 500 }
      );
    }

    if (
      !instruments ||
      instruments.length === 0
    ) {
      return NextResponse.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          step: "find_instrument",
          error:
            `No instrument found for symbol ${requestedSymbol}.`,
        },
        { status: 404 }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | Sync one stock
    |--------------------------------------------------------------------------
    */

    const result =
      await syncInstrument(
        instruments[0]
      );

    return NextResponse.json(
      result
    );
  } catch (error) {
    console.error(
      "Fundamentals sync error:",
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
          "Unknown fundamentals sync error.",
      },
      { status: 500 }
    );
  }
}
