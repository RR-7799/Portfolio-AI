import { createClient } from "@supabase/supabase-js";

const ENGINE_VERSION = "upstox_fundamentals_v1_3";

const UPSTOX_BASE_URL = "https://api.upstox.com/v2";

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

function toNumber(value) {
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

function firstNumber(...values) {
  for (const value of values) {
    const n = toNumber(value);

    if (n !== null) {
      return n;
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

/*
  Converts:
    Mar 2026 -> 2026-03-31
    Jun 2026 -> 2026-06-30
    2026-03-31 -> same
*/
function parsePeriodToDate(period) {
  if (!period) {
    return null;
  }

  const value = String(period).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

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
    monthMap[match[1].slice(0, 3).toLowerCase()];

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
  if (!Array.isArray(history) || !history.length) {
    return null;
  }

  const rows = history
    .filter(Boolean)
    .map((row) => ({
      row,
      period: row?.period || null,
      timestamp: periodTimestamp(row?.period),
    }))
    .sort((a, b) => b.timestamp - a.timestamp);

  return rows[0]?.row || null;
}

function findHistoryByPeriod(history, period) {
  if (!Array.isArray(history)) {
    return null;
  }

  return history.find(
    (row) => String(row?.period || "") === String(period)
  ) || null;
}

function getResponseData(response) {
  if (!response) {
    return null;
  }

  return response?.data ?? null;
}

/*
  -----------------------------
  KEY RATIOS
  -----------------------------
*/

function parseKeyRatios(response) {
  const rows = Array.isArray(response?.data)
    ? response.data
    : [];

  const getCompanyValue = (names) => {
    const row = rows.find((item) => {
      const name = String(item?.name || "")
        .trim()
        .toLowerCase();

      return names.some((candidate) =>
        name === candidate
      );
    });

    return firstNumber(
      row?.company_value,
      row?.value
    );
  };

  return {
    pe: getCompanyValue([
      "p/e",
      "pe",
      "p/e ratio",
    ]),

    pb: getCompanyValue([
      "p/b",
      "pb",
      "p/b ratio",
    ]),

    roa: getCompanyValue([
      "roa",
      "return on assets",
    ]),

    roe: getCompanyValue([
      "roe",
      "return on equity",
    ]),

    roce: getCompanyValue([
      "roce",
      "return on capital employed",
    ]),

    ev_ebitda: getCompanyValue([
      "ev/ebitda",
      "ev / ebitda",
      "enterprise value/ebitda",
    ]),
  };
}

/*
  -----------------------------
  INCOME STATEMENT
  -----------------------------
*/

function parseIncomeStatement(response) {
  const data = getResponseData(response);

  const rows = Array.isArray(
    data?.income_statement
  )
    ? data.income_statement
    : [];

  function getCategory(categoryNames) {
    return rows.find((row) =>
      categoryNames.some(
        (name) =>
          String(row?.category || "")
            .trim()
            .toLowerCase() === name
      )
    );
  }

  const revenueRow = getCategory([
    "revenue",
    "sales",
    "net_sales",
    "total_revenue",
  ]);

  const operatingProfitRow = getCategory([
    "operating_profit",
    "operating profit",
    "profit_from_operations",
  ]);

  const netProfitRow = getCategory([
    "net_profit",
    "net profit",
    "profit_after_tax",
    "profit after tax",
  ]);

  const revenueHistory = Array.isArray(
    revenueRow?.history
  )
    ? revenueRow.history
    : [];

  const operatingProfitHistory = Array.isArray(
    operatingProfitRow?.history
  )
    ? operatingProfitRow.history
    : [];

  const netProfitHistory = Array.isArray(
    netProfitRow?.history
  )
    ? netProfitRow.history
    : [];

  const latestRevenue =
    latestHistoryValue(revenueHistory);

  const latestOperatingProfit =
    latestHistoryValue(
      operatingProfitHistory
    );

  const latestNetProfit =
    latestHistoryValue(netProfitHistory);

  /*
    The income statement itself contains the correct
    historical periods. We explicitly use the latest
    revenue period as the canonical financial period.
  */
  const latestPeriod =
    latestRevenue?.period ||
    latestOperatingProfit?.period ||
    latestNetProfit?.period ||
    null;

  const previousRevenue =
    revenueHistory
      .filter(
        (row) =>
          row?.period &&
          row.period !== latestPeriod
      )
      .sort(
        (a, b) =>
          periodTimestamp(b.period) -
          periodTimestamp(a.period)
      )[0] || null;

  const previousNetProfit =
    netProfitHistory
      .filter(
        (row) =>
          row?.period &&
          row.period !== latestPeriod
      )
      .sort(
        (a, b) =>
          periodTimestamp(b.period) -
          periodTimestamp(a.period)
      )[0] || null;

  const revenueLatest = toNumber(
    latestRevenue?.value
  );

  const revenuePrevious = toNumber(
    previousRevenue?.value
  );

  const operatingProfitLatest =
    toNumber(latestOperatingProfit?.value);

  const netProfitLatest =
    toNumber(latestNetProfit?.value);

  const netProfitPrevious =
    toNumber(previousNetProfit?.value);

  /*
    Prefer Upstox's stated change percentage when
    available. Otherwise calculate it.
  */
  const salesGrowthFromProvider =
    latestRevenue?.change !== undefined
      ? toNumber(
          String(latestRevenue.change)
            .replace("%", "")
      )
      : null;

  const profitGrowthFromProvider =
    latestNetProfit?.change !== undefined
      ? toNumber(
          String(latestNetProfit.change)
            .replace("%", "")
      )
      : null;

  return {
    latest_period: latestPeriod,

    previous_period:
      previousRevenue?.period ||
      previousNetProfit?.period ||
      null,

    revenue_latest: revenueLatest,

    revenue_previous: revenuePrevious,

    operating_profit_latest:
      operatingProfitLatest,

    net_profit_latest:
      netProfitLatest,

    net_profit_previous:
      netProfitPrevious,

    sales_growth:
      salesGrowthFromProvider ??
      calculateGrowth(
        revenueLatest,
        revenuePrevious
      ),

    profit_growth:
      profitGrowthFromProvider ??
      calculateGrowth(
        netProfitLatest,
        netProfitPrevious
      ),
  };
}

/*
  -----------------------------
  BALANCE SHEET
  -----------------------------
*/

function parseBalanceSheet(response) {
  const data = getResponseData(response);

  const history = Array.isArray(
    data?.history
  )
    ? data.history
    : [];

  const latest = latestHistoryValue(history);

  return {
    total_assets: firstNumber(
      latest?.total_asset,
      latest?.total_assets
    ),

    total_liabilities: firstNumber(
      latest?.total_liability,
      latest?.total_liabilities
    ),

    /*
      IMPORTANT:
      Do not calculate D/E from total liabilities.
      Total liabilities are not the same as debt.

      If Upstox eventually supplies a direct D/E
      field, we can use it.
    */
    debt_to_equity: firstNumber(
      latest?.debt_to_equity,
      latest?.debtEquity,
      latest?.debt_to_equity_ratio
    ),

    period: latest?.period || null,
  };
}

/*
  -----------------------------
  CASH FLOW
  -----------------------------
*/

function parseCashFlow(response) {
  const data = getResponseData(response);

  const categories = Array.isArray(
    data?.cash_flow
  )
    ? data.cash_flow
    : [];

  function findCategory(names) {
    return categories.find((row) =>
      names.some(
        (name) =>
          String(row?.category || "")
            .trim()
            .toLowerCase() === name
      )
    );
  }

  const operating = findCategory([
    "operating",
    "operating cash flow",
  ]);

  const investing = findCategory([
    "investing",
    "investing cash flow",
  ]);

  const financing = findCategory([
    "financing",
    "financing cash flow",
  ]);

  const operatingLatest =
    latestHistoryValue(
      operating?.history
    );

  const investingLatest =
    latestHistoryValue(
      investing?.history
    );

  const financingLatest =
    latestHistoryValue(
      financing?.history
    );

  /*
    Use operating CF period as the canonical cash-flow
    period. All categories should normally line up.
  */
  const period =
    operatingLatest?.period ||
    investingLatest?.period ||
    financingLatest?.period ||
    null;

  return {
    operating: toNumber(
      operatingLatest?.value
    ),

    investing: toNumber(
      investingLatest?.value
    ),

    financing: toNumber(
      financingLatest?.value
    ),

    period,
  };
}

/*
  -----------------------------
  SHAREHOLDING
  -----------------------------
*/

function parseShareholding(response) {
  const rows = Array.isArray(response?.data)
    ? response.data
    : [];

  function findCategory(names) {
    return rows.find((row) =>
      names.some(
        (name) =>
          String(row?.category || "")
            .trim()
            .toLowerCase() === name
      )
    );
  }

  function latestCategoryValue(names) {
    const row = findCategory(names);

    const latest = latestHistoryValue(
      row?.history
    );

    return {
      value: toNumber(latest?.value),
      period: latest?.period || null,
    };
  }

  const promoter = latestCategoryValue([
    "promoters",
    "promoter",
  ]);

  const fii = latestCategoryValue([
    "fii",
    "foreign_institutional_investors",
  ]);

  const otherDii = latestCategoryValue([
    "other_dii",
    "other dii",
  ]);

  const retail = latestCategoryValue([
    "retail_and_other",
    "retail and other",
    "public",
  ]);

  const mutualFunds = latestCategoryValue([
    "mutual_funds",
    "mutual funds",
  ]);

  /*
    Upstox may provide DII as an aggregate in some
    responses or only "other_dii" and mutual funds.

    We preserve a real DII value where supplied.
    Otherwise we use other_dii + mutual_funds as the
    compatibility value expected by our current model.
  */
  const directDii = latestCategoryValue([
    "dii",
    "domestic_institutional_investors",
  ]);

  let dii = directDii.value;

  if (
    dii === null &&
    (
      otherDii.value !== null ||
      mutualFunds.value !== null
    )
  ) {
    dii = Number(
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
    retail.period,
  ].filter(Boolean);

  periods.sort(
    (a, b) =>
      periodTimestamp(b) -
      periodTimestamp(a)
  );

  return {
    promoter: promoter.value,

    fii: fii.value,

    dii,

    direct_dii: directDii.value,

    other_dii: otherDii.value,

    mutual_funds: mutualFunds.value,

    public: retail.value,

    raw_period: periods[0] || null,
  };
}

/*
  -----------------------------
  DATABASE MERGE
  -----------------------------
*/

function mergeValue(newValue, existingValue) {
  /*
    Never replace a valid existing value with null.
  */
  return newValue !== null &&
    newValue !== undefined
    ? newValue
    : existingValue ?? null;
}

function calculateCompleteness(record) {
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

  const availableFields = fields.filter(
    (field) =>
      record?.[field] !== null &&
      record?.[field] !== undefined
  );

  return {
    availableFields,
    completeness: Number(
      (
        (availableFields.length /
          fields.length) *
        100
      ).toFixed(1)
    ),
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
      duration_ms:
        Date.now() - startedAt,

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
      duration_ms:
        Date.now() - startedAt,

      data: null,

      error:
        error?.message ||
        "Upstox request failed",
    };
  }
}

export async function GET(request) {
  try {
    const supabase = getSupabase();

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
          error: "Invalid ISIN",
        },
        { status: 400 }
      );
    }

    /*
      Locate instrument by ISIN stored in symbol.
    */
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

    /*
      Load all required Upstox endpoints.
    */
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
        status: keyRatios.status,
        error: keyRatios.error,
      },

      balance_sheet: {
        ok: balanceSheet.ok,
        status:
          balanceSheet.status,
        error: balanceSheet.error,
      },

      cash_flow: {
        ok: cashFlow.ok,
        status: cashFlow.status,
        error: cashFlow.error,
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

    /*
      Parse direct Upstox structures.
    */
    const ratios = parseKeyRatios(
      keyRatios.data
    );

    const income = parseIncomeStatement(
      incomeStatement.data
    );

    const balance = parseBalanceSheet(
      balanceSheet.data
    );

    const cash = parseCashFlow(
      cashFlow.data
    );

    const ownership = parseShareholding(
      shareHoldings.data
    );

    const profileData =
      getResponseData(profile.data);

    /*
      Fetch existing fundamentals so that
      unavailable Upstox values NEVER erase good data.
    */
    const {
      data: existingFundamentals,
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

    const existing =
      existingFundamentals || {};

    /*
      Build merged database record.
    */
    const merged = {
      instrument_id:
        instrument.id,

      sales_growth:
        mergeValue(
          income.sales_growth,
          existing.sales_growth
        ),

      profit_growth:
        mergeValue(
          income.profit_growth,
          existing.profit_growth
        ),

      roe:
        mergeValue(
          ratios.roe,
          existing.roe
        ),

      roce:
        mergeValue(
          ratios.roce,
          existing.roce
        ),

      debt_to_equity:
        mergeValue(
          balance.debt_to_equity,
          existing.debt_to_equity
        ),

      operating_cash_flow:
        mergeValue(
          cash.operating,
          existing.operating_cash_flow
        ),

      promoter_holding:
        mergeValue(
          ownership.promoter,
          existing.promoter_holding
        ),

      fii_holding:
        mergeValue(
          ownership.fii,
          existing.fii_holding
        ),

      dii_holding:
        mergeValue(
          ownership.dii,
          existing.dii_holding
        ),

      /*
        Upstox fundamentals does not reliably expose
        company market cap/EPS/BVPS/52-week data in
        this endpoint.

        Preserve existing values.
      */
      market_cap:
        existing.market_cap ?? null,

      pe_ratio:
        mergeValue(
          ratios.pe,
          existing.pe_ratio
        ),

      pb_ratio:
        mergeValue(
          ratios.pb,
          existing.pb_ratio
        ),

      book_value_per_share:
        existing.book_value_per_share ??
        null,

      eps:
        existing.eps ?? null,

      dividend_yield:
        existing.dividend_yield ??
        null,

      week_52_high:
        existing.week_52_high ??
        null,

      week_52_low:
        existing.week_52_low ??
        null,

      financial_year:
        income.latest_period ??
        existing.financial_year ??
        null,

      shareholding_date:
        parsePeriodToDate(
          ownership.raw_period
        ) ??
        existing.shareholding_date ??
        null,

      updated_at:
        new Date().toISOString(),
    };

    /*
      IMPORTANT:
      Do not overwrite the manually classified sector.
      Upstox profile sector is informational only.
    */
    const completeness =
      calculateCompleteness(
        merged
      );

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

    /*
      Financial-period consistency check.
    */
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

    const periodsAligned =
      Boolean(
        incomeDate &&
        balanceDate &&
        cashDate &&
        incomeDate === balanceDate &&
        incomeDate === cashDate
      );

    return Response.json({
      success: true,

      engine_version:
        ENGINE_VERSION,

      instrument: {
        id: instrument.id,
        symbol: instrument.symbol,
        company_name:
          instrument.company_name,
        sector: instrument.sector,
      },

      provider: "Upstox",

      endpoint_status:
        endpointStatus,

      profile: {
        sector:
          profileData?.sector ??
          null,
      },

      ratios: {
        pe: ratios.pe,
        pb: ratios.pb,
        roe: ratios.roe,
        roce: ratios.roce,
        roa: ratios.roa,
        ev_ebitda:
          ratios.ev_ebitda,
      },

      income_statement: income,

      balance_sheet: balance,

      cash_flow: cash,

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

        aligned:
          periodsAligned,
      },

      preservation: {
        existing_record_found:
          Boolean(
            existingFundamentals
          ),

        nulls_do_not_overwrite_existing:
          true,
      },

      sync: {
        completeness:
          completeness.completeness,

        available_fields:
          completeness.availableFields,

        saved_to:
          "fundamentals",

        record_id:
          saved?.id ?? null,
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
