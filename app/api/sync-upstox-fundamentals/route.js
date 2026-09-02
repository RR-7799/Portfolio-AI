import { createClient } from "@supabase/supabase-js";

const ENGINE_VERSION = "upstox_fundamentals_v1_4";
const UPSTOX_BASE_URL = "https://api.upstox.com/v2";

/* =========================================================
   SUPABASE
========================================================= */

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Missing Supabase environment variables");
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/* =========================================================
   UPSTOX
========================================================= */

function getUpstoxHeaders() {
  const token = process.env.UPSTOX_ANALYTICS_TOKEN;

  if (!token) {
    throw new Error("Missing UPSTOX_ANALYTICS_TOKEN");
  }

  return {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function upstoxGet(endpoint) {
  const startedAt = Date.now();

  try {
    const response = await fetch(
      `${UPSTOX_BASE_URL}${endpoint}`,
      {
        method: "GET",
        headers: getUpstoxHeaders(),
        cache: "no-store",
      }
    );

    const text = await response.text();

    let json = null;

    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      duration_ms: Date.now() - startedAt,
      data: json,
      error: response.ok
        ? null
        : (
            json?.errors?.[0]?.message ||
            json?.message ||
            `HTTP ${response.status}`
          ),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      duration_ms: Date.now() - startedAt,
      data: null,
      error:
        error?.message ||
        "Upstox request failed",
    };
  }
}

/* =========================================================
   BASIC HELPERS
========================================================= */

function toNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const cleaned = String(value)
    .replace(/,/g, "")
    .replace(/%/g, "")
    .trim();

  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = toNumber(value);

    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function firstValue(...values) {
  for (const value of values) {
    if (
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      return value;
    }
  }

  return null;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[%()]/g, "")
    .replace(/[\/_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function calculateGrowth(current, previous) {
  const currentValue = toNumber(current);
  const previousValue = toNumber(previous);

  if (
    currentValue === null ||
    previousValue === null ||
    previousValue === 0
  ) {
    return null;
  }

  return Number(
    (
      ((currentValue - previousValue) /
        Math.abs(previousValue)) *
      100
    ).toFixed(2)
  );
}

/* =========================================================
   PERIOD HELPERS
========================================================= */

function parsePeriodToDate(period) {
  if (!period) {
    return null;
  }

  const value = String(period).trim();

  /*
    Already YYYY-MM-DD
  */
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  /*
    Examples:
      Mar 2026
      Jun 2026
      March 2026
  */
  const monthMap = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };

  const match = value.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})$/i
  );

  if (!match) {
    return null;
  }

  const month =
    monthMap[
      match[1]
        .slice(0, 3)
        .toLowerCase()
    ];

  const year = Number(match[2]);

  const lastDay = new Date(
    year,
    Number(month),
    0
  ).getDate();

  return `${year}-${month}-${String(lastDay).padStart(
    2,
    "0"
  )}`;
}

function periodTimestamp(period) {
  const parsed = parsePeriodToDate(period);

  if (!parsed) {
    return 0;
  }

  const timestamp = Date.parse(
    `${parsed}T00:00:00Z`
  );

  return Number.isFinite(timestamp)
    ? timestamp
    : 0;
}

function latestHistoryValue(history) {
  if (
    !Array.isArray(history) ||
    history.length === 0
  ) {
    return null;
  }

  return [...history]
    .filter(Boolean)
    .sort(
      (a, b) =>
        periodTimestamp(b?.period) -
        periodTimestamp(a?.period)
    )[0] || null;
}

function previousHistoryValue(
  history,
  latestPeriod
) {
  if (
    !Array.isArray(history) ||
    history.length === 0
  ) {
    return null;
  }

  return [...history]
    .filter(
      (row) =>
        row &&
        row?.period &&
        row.period !== latestPeriod
    )
    .sort(
      (a, b) =>
        periodTimestamp(b.period) -
        periodTimestamp(a.period)
    )[0] || null;
}

/* =========================================================
   RESPONSE DATA
========================================================= */

function getResponseData(response) {
  return response?.data ?? null;
}

/* =========================================================
   KEY RATIOS
========================================================= */

function parseKeyRatios(response) {
  const rows = Array.isArray(response?.data)
    ? response.data
    : [];

  function findRow(possibleNames) {
    return rows.find((row) => {
      const normalized =
        normalizeText(row?.name);

      return possibleNames.some(
        (name) =>
          normalized ===
          normalizeText(name)
      );
    });
  }

  const peRow = findRow([
    "p/e",
    "pe",
    "p/e ratio",
    "price to earnings",
    "price earnings",
  ]);

  const pbRow = findRow([
    "p/b",
    "pb",
    "p/b ratio",
    "price to book",
    "price book",
  ]);

  const roaRow = findRow([
    "roa",
    "roa %",
    "return on assets",
  ]);

  const roeRow = findRow([
    "roe",
    "roe %",
    "return on equity",
  ]);

  const roceRow = findRow([
    "roce",
    "roce %",
    "return on capital employed",
  ]);

  const evEbitdaRow = findRow([
    "ev/ebitda",
    "ev / ebitda",
    "enterprise value/ebitda",
    "enterprise value ebitda",
  ]);

  return {
    pe: firstNumber(
      peRow?.company_value,
      peRow?.value
    ),

    pb: firstNumber(
      pbRow?.company_value,
      pbRow?.value
    ),

    roa: firstNumber(
      roaRow?.company_value,
      roaRow?.value
    ),

    roe: firstNumber(
      roeRow?.company_value,
      roeRow?.value
    ),

    roce: firstNumber(
      roceRow?.company_value,
      roceRow?.value
    ),

    ev_ebitda: firstNumber(
      evEbitdaRow?.company_value,
      evEbitdaRow?.value
    ),

    raw_rows: rows,
  };
}

/* =========================================================
   INCOME STATEMENT
========================================================= */

function parseIncomeStatement(response) {
  const data = getResponseData(response);

  const statementRows = Array.isArray(
    data?.income_statement
  )
    ? data.income_statement
    : [];

  function findCategory(possibleNames) {
    return statementRows.find((row) => {
      const normalized =
        normalizeText(row?.category);

      return possibleNames.some(
        (name) =>
          normalized ===
          normalizeText(name)
      );
    });
  }

  const revenueRow = findCategory([
    "revenue",
    "sales",
    "net sales",
    "total revenue",
  ]);

  const operatingProfitRow =
    findCategory([
      "operating profit",
      "operating_profit",
      "profit from operations",
    ]);

  const netProfitRow =
    findCategory([
      "net profit",
      "net_profit",
      "profit after tax",
      "profit_after_tax",
      "pat",
    ]);

  const revenueHistory =
    Array.isArray(revenueRow?.history)
      ? revenueRow.history
      : [];

  const operatingProfitHistory =
    Array.isArray(
      operatingProfitRow?.history
    )
      ? operatingProfitRow.history
      : [];

  const netProfitHistory =
    Array.isArray(
      netProfitRow?.history
    )
      ? netProfitRow.history
      : [];

  const revenueLatest =
    latestHistoryValue(
      revenueHistory
    );

  const revenuePrevious =
    previousHistoryValue(
      revenueHistory,
      revenueLatest?.period
    );

  const operatingProfitLatest =
    latestHistoryValue(
      operatingProfitHistory
    );

  const netProfitLatest =
    latestHistoryValue(
      netProfitHistory
    );

  const netProfitPrevious =
    previousHistoryValue(
      netProfitHistory,
      netProfitLatest?.period
    );

  /*
    Revenue is our canonical income-statement period.
  */
  const latestPeriod =
    revenueLatest?.period ||
    operatingProfitLatest?.period ||
    netProfitLatest?.period ||
    null;

  const revenueLatestValue =
    toNumber(
      revenueLatest?.value
    );

  const revenuePreviousValue =
    toNumber(
      revenuePrevious?.value
    );

  const operatingProfitLatestValue =
    toNumber(
      operatingProfitLatest?.value
    );

  const netProfitLatestValue =
    toNumber(
      netProfitLatest?.value
    );

  const netProfitPreviousValue =
    toNumber(
      netProfitPrevious?.value
    );

  const providerSalesGrowth =
    revenueLatest?.change !== undefined
      ? toNumber(
          revenueLatest.change
        )
      : null;

  const providerProfitGrowth =
    netProfitLatest?.change !== undefined
      ? toNumber(
          netProfitLatest.change
        )
      : null;

  return {
    latest_period:
      latestPeriod,

    previous_period:
      revenuePrevious?.period ||
      netProfitPrevious?.period ||
      null,

    revenue_latest:
      revenueLatestValue,

    revenue_previous:
      revenuePreviousValue,

    operating_profit_latest:
      operatingProfitLatestValue,

    net_profit_latest:
      netProfitLatestValue,

    net_profit_previous:
      netProfitPreviousValue,

    sales_growth:
      providerSalesGrowth ??
      calculateGrowth(
        revenueLatestValue,
        revenuePreviousValue
      ),

    profit_growth:
      providerProfitGrowth ??
      calculateGrowth(
        netProfitLatestValue,
        netProfitPreviousValue
      ),
  };
}

/* =========================================================
   BALANCE SHEET
========================================================= */

function parseBalanceSheet(response) {
  const data = getResponseData(response);

  const history = Array.isArray(
    data?.history
  )
    ? data.history
    : [];

  const latest =
    latestHistoryValue(history);

  return {
    total_assets:
      firstNumber(
        latest?.total_asset,
        latest?.total_assets
      ),

    total_liabilities:
      firstNumber(
        latest?.total_liability,
        latest?.total_liabilities
      ),

    /*
      Only use a direct D/E supplied by provider.
      Do NOT derive D/E from total liabilities.
    */
    debt_to_equity:
      firstNumber(
        latest?.debt_to_equity,
        latest?.debtEquity,
        latest?.debt_to_equity_ratio
      ),

    period:
      latest?.period || null,
  };
}

/* =========================================================
   CASH FLOW
========================================================= */

function parseCashFlow(response) {
  const data =
    getResponseData(response);

  const categories =
    Array.isArray(data?.cash_flow)
      ? data.cash_flow
      : [];

  function findCategory(
    possibleNames
  ) {
    return categories.find((row) => {
      const normalized =
        normalizeText(
          row?.category
        );

      return possibleNames.some(
        (name) =>
          normalized ===
          normalizeText(name)
      );
    });
  }

  const operatingRow =
    findCategory([
      "operating",
      "operating cash flow",
    ]);

  const investingRow =
    findCategory([
      "investing",
      "investing cash flow",
    ]);

  const financingRow =
    findCategory([
      "financing",
      "financing cash flow",
    ]);

  const operatingLatest =
    latestHistoryValue(
      operatingRow?.history
    );

  const investingLatest =
    latestHistoryValue(
      investingRow?.history
    );

  const financingLatest =
    latestHistoryValue(
      financingRow?.history
    );

  return {
    operating:
      toNumber(
        operatingLatest?.value
      ),

    investing:
      toNumber(
        investingLatest?.value
      ),

    financing:
      toNumber(
        financingLatest?.value
      ),

    period:
      operatingLatest?.period ||
      investingLatest?.period ||
      financingLatest?.period ||
      null,
  };
}

/* =========================================================
   SHAREHOLDING
========================================================= */

function parseShareholding(response) {
  const rows =
    Array.isArray(response?.data)
      ? response.data
      : [];

  function findCategory(
    possibleNames
  ) {
    return rows.find((row) => {
      const normalized =
        normalizeText(
          row?.category
        );

      return possibleNames.some(
        (name) =>
          normalized ===
          normalizeText(name)
      );
    });
  }

  function latestCategory(
    possibleNames
  ) {
    const row =
      findCategory(
        possibleNames
      );

    const latest =
      latestHistoryValue(
        row?.history
      );

    return {
      value:
        toNumber(
          latest?.value
        ),

      period:
        latest?.period ||
        null,
    };
  }

  const promoter =
    latestCategory([
      "promoters",
      "promoter",
    ]);

  const fii =
    latestCategory([
      "fii",
      "foreign institutional investors",
    ]);

  const directDii =
    latestCategory([
      "dii",
      "domestic institutional investors",
    ]);

  const otherDii =
    latestCategory([
      "other dii",
      "other_dii",
    ]);

  const mutualFunds =
    latestCategory([
      "mutual funds",
      "mutual_funds",
    ]);

  const publicHolding =
    latestCategory([
      "retail and other",
      "retail_and_other",
      "public",
    ]);

  /*
    If Upstox does not provide direct DII,
    use Other DII + Mutual Funds for compatibility
    with the current scoring model.
  */
  let diiValue =
    directDii.value;

  if (
    diiValue === null &&
    (
      otherDii.value !== null ||
      mutualFunds.value !== null
    )
  ) {
    diiValue = Number(
      (
        (otherDii.value || 0) +
        (mutualFunds.value || 0)
      ).toFixed(2)
    );
  }

  const periods = [
    promoter.period,
    fii.period,
    directDii.period,
    otherDii.period,
    mutualFunds.period,
    publicHolding.period,
  ].filter(Boolean);

  periods.sort(
    (a, b) =>
      periodTimestamp(b) -
      periodTimestamp(a)
  );

  return {
    promoter:
      promoter.value,

    fii:
      fii.value,

    dii:
      diiValue,

    direct_dii:
      directDii.value,

    other_dii:
      otherDii.value,

    mutual_funds:
      mutualFunds.value,

    public:
      publicHolding.value,

    raw_period:
      periods[0] || null,
  };
}

/* =========================================================
   DATABASE MERGE
========================================================= */

function preserveExisting(
  newValue,
  existingValue
) {
  return newValue !== null &&
    newValue !== undefined
    ? newValue
    : existingValue ?? null;
}

function calculateCompleteness(
  record
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
        record?.[field] !== null &&
        record?.[field] !== undefined
    );

  return {
    available,
    completeness: Number(
      (
        (available.length /
          fields.length) *
        100
      ).toFixed(1)
    ),
  };
}

/* =========================================================
   ROUTE
========================================================= */

export async function GET(request) {
  try {
    const supabase =
      getSupabase();

    const { searchParams } =
      new URL(request.url);

    const isin =
      searchParams
        .get("isin")
        ?.trim()
        .toUpperCase();

    if (!isin) {
      return Response.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          error:
            "Missing isin parameter",
        },
        { status: 400 }
      );
    }

    const validIsin =
      /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(
        isin
      );

    if (!validIsin) {
      return Response.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          error:
            "Invalid ISIN",
        },
        { status: 400 }
      );
    }

    /* -----------------------------------------------------
       Load instrument
    ----------------------------------------------------- */

    const {
      data: instrument,
      error: instrumentError,
    } = await supabase
      .from("instruments")
      .select(
        "id,symbol,company_name,sector"
      )
      .eq("symbol", isin)
      .maybeSingle();

    if (instrumentError) {
      throw new Error(
        `Failed to load instrument: ${instrumentError.message}`
      );
    }

    if (!instrument) {
      return Response.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          error:
            `Instrument not found for ISIN ${isin}`,
        },
        { status: 404 }
      );
    }

    /* -----------------------------------------------------
       Upstox API calls
    ----------------------------------------------------- */

    const profile =
      await upstoxGet(
        `/fundamentals/${isin}/profile`
      );

    const keyRatios =
      await upstoxGet(
        `/fundamentals/${isin}/key-ratios`
      );

    const balanceSheet =
      await upstoxGet(
        `/fundamentals/${isin}/balance-sheet?type=consolidated&fs=true`
      );

    const cashFlow =
      await upstoxGet(
        `/fundamentals/${isin}/cash-flow?type=consolidated&fs=true`
      );

    const incomeStatement =
      await upstoxGet(
        `/fundamentals/${isin}/income-statement?type=consolidated&time_period=yearly&fs=true`
      );

    const shareHoldings =
      await upstoxGet(
        `/fundamentals/${isin}/share-holdings`
      );

    const endpointStatus = {
      profile: {
        ok: profile.ok,
        status: profile.status,
        error: profile.error,
      },

      key_ratios: {
        ok: keyRatios.ok,
        status:
          keyRatios.status,
        error:
          keyRatios.error,
      },

      balance_sheet: {
        ok: balanceSheet.ok,
        status:
          balanceSheet.status,
        error:
          balanceSheet.error,
      },

      cash_flow: {
        ok: cashFlow.ok,
        status:
          cashFlow.status,
        error:
          cashFlow.error,
      },

      income_statement: {
        ok: incomeStatement.ok,
        status:
          incomeStatement.status,
        error:
          incomeStatement.error,
      },

      share_holdings: {
        ok: shareHoldings.ok,
        status:
          shareHoldings.status,
        error:
          shareHoldings.error,
      },
    };

    /* -----------------------------------------------------
       Parse provider data
    ----------------------------------------------------- */

    const ratios =
      parseKeyRatios(
        keyRatios.data
      );

    const income =
      parseIncomeStatement(
        incomeStatement.data
      );

    const balance =
      parseBalanceSheet(
        balanceSheet.data
      );

    const cash =
      parseCashFlow(
        cashFlow.data
      );

    const ownership =
      parseShareholding(
        shareHoldings.data
      );

    const profileData =
      getResponseData(
        profile.data
      );

    /* -----------------------------------------------------
       Existing DB record
    ----------------------------------------------------- */

    const {
      data: existing,
      error: existingError,
    } = await supabase
      .from("fundamentals")
      .select("*")
      .eq(
        "instrument_id",
        instrument.id
      )
      .maybeSingle();

    if (existingError) {
      throw new Error(
        `Failed to load existing fundamentals: ${existingError.message}`
      );
    }

    /* -----------------------------------------------------
       Merge

       Critical rule:
       Upstox null does NOT erase an existing good value.
    ----------------------------------------------------- */

    const merged = {
      instrument_id:
        instrument.id,

      sales_growth:
        preserveExisting(
          income.sales_growth,
          existing?.sales_growth
        ),

      profit_growth:
        preserveExisting(
          income.profit_growth,
          existing?.profit_growth
        ),

      roe:
        preserveExisting(
          ratios.roe,
          existing?.roe
        ),

      roce:
        preserveExisting(
          ratios.roce,
          existing?.roce
        ),

      debt_to_equity:
        preserveExisting(
          balance.debt_to_equity,
          existing?.debt_to_equity
        ),

      operating_cash_flow:
        preserveExisting(
          cash.operating,
          existing?.operating_cash_flow
        ),

      promoter_holding:
        preserveExisting(
          ownership.promoter,
          existing?.promoter_holding
        ),

      fii_holding:
        preserveExisting(
          ownership.fii,
          existing?.fii_holding
        ),

      dii_holding:
        preserveExisting(
          ownership.dii,
          existing?.dii_holding
        ),

      /*
        Keep existing valuation values because
        these are not consistently returned by the
        Upstox fundamentals endpoint.
      */
      market_cap:
        existing?.market_cap ??
        null,

      pe_ratio:
        preserveExisting(
          ratios.pe,
          existing?.pe_ratio
        ),

      pb_ratio:
        preserveExisting(
          ratios.pb,
          existing?.pb_ratio
        ),

      book_value_per_share:
        existing?.book_value_per_share ??
        null,

      eps:
        existing?.eps ??
        null,

      dividend_yield:
        existing?.dividend_yield ??
        null,

      week_52_high:
        existing?.week_52_high ??
        null,

      week_52_low:
        existing?.week_52_low ??
        null,

      financial_year:
        income.latest_period ??
        existing?.financial_year ??
        null,

      shareholding_date:
        parsePeriodToDate(
          ownership.raw_period
        ) ??
        existing?.shareholding_date ??
        null,

      updated_at:
        new Date().toISOString(),
    };

    /* -----------------------------------------------------
       Completeness
    ----------------------------------------------------- */

    const completeness =
      calculateCompleteness(
        merged
      );

    /* -----------------------------------------------------
       Save
    ----------------------------------------------------- */

    const {
      data: saved,
      error: saveError,
    } = await supabase
      .from("fundamentals")
      .upsert(
        merged,
        {
          onConflict:
            "instrument_id",
        }
      )
      .select()
      .single();

    if (saveError) {
      throw new Error(
        `Failed to save fundamentals: ${saveError.message}`
      );
    }

    /* -----------------------------------------------------
       Financial period diagnostics
    ----------------------------------------------------- */

    const incomePeriod =
      income.latest_period;

    const balancePeriod =
      balance.period;

    const cashPeriod =
      cash.period;

    const incomeDate =
      parsePeriodToDate(
        incomePeriod
      );

    const balanceDate =
      parsePeriodToDate(
        balancePeriod
      );

    const cashDate =
      parsePeriodToDate(
        cashPeriod
      );

    let periodStatus =
      "MISSING_PERIOD";

    if (
      incomeDate &&
      balanceDate &&
      cashDate
    ) {
      if (
        incomeDate === balanceDate &&
        incomeDate === cashDate
      ) {
        periodStatus =
          "ALIGNED";
      } else if (
        incomeDate === balanceDate ||
        incomeDate === cashDate ||
        balanceDate === cashDate
      ) {
        periodStatus =
          "PARTIALLY_ALIGNED";
      } else {
        periodStatus =
          "DIFFERENT_PERIODS";
      }
    }

    /* -----------------------------------------------------
       Return
    ----------------------------------------------------- */

    return Response.json({
      success: true,

      engine_version:
        ENGINE_VERSION,

      instrument: {
        id:
          instrument.id,

        symbol:
          instrument.symbol,

        company_name:
          instrument.company_name,

        sector:
          instrument.sector,
      },

      provider:
        "Upstox",

      endpoint_status:
        endpointStatus,

      profile: {
        sector:
          profileData?.sector ??
          null,
      },

      ratios: {
        pe:
          ratios.pe,

        pb:
          ratios.pb,

        roe:
          ratios.roe,

        roce:
          ratios.roce,

        roa:
          ratios.roa,

        ev_ebitda:
          ratios.ev_ebitda,
      },

      income_statement:
        income,

      balance_sheet:
        balance,

      cash_flow:
        cash,

      ownership: {
        promoter:
          ownership.promoter,

        fii:
          ownership.fii,

        dii:
          ownership.dii,

        direct_dii:
          ownership.direct_dii,

        other_dii:
          ownership.other_dii,

        mutual_funds:
          ownership.mutual_funds,

        public:
          ownership.public,

        raw_period:
          ownership.raw_period,

        database_date:
          parsePeriodToDate(
            ownership.raw_period
          ),
      },

      valuation: {
        market_cap:
          merged.market_cap,

        pe:
          merged.pe_ratio,

        pb:
          merged.pb_ratio,

        eps:
          merged.eps,

        book_value_per_share:
          merged.book_value_per_share,

        dividend_yield:
          merged.dividend_yield,

        week_52_high:
          merged.week_52_high,

        week_52_low:
          merged.week_52_low,
      },

      financial_period_check: {
        income_statement:
          incomePeriod,

        balance_sheet:
          balancePeriod,

        cash_flow:
          cashPeriod,

        income_date:
          incomeDate,

        balance_date:
          balanceDate,

        cash_date:
          cashDate,

        status:
          periodStatus,
      },

      preservation: {
        existing_record_found:
          Boolean(existing),

        nulls_do_not_overwrite_existing:
          true,
      },

      sync: {
        completeness:
          completeness.completeness,

        available_fields:
          completeness.available,

        saved_to:
          "fundamentals",

        record_id:
          saved?.id ??
          null,
      },
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        engine_version:
          ENGINE_VERSION,
        step: "unexpected",
        error:
          error?.message ||
          "Unknown error",
      },
      { status: 500 }
    );
  }
}
