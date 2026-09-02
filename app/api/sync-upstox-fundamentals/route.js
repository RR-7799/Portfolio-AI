import { createClient } from "@supabase/supabase-js";

const ENGINE_VERSION = "upstox_fundamentals_v1_2";

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
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNumber(value);

    if (number !== null) {
      return number;
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

function parsePeriodToDate(period) {
  if (!period) {
    return null;
  }

  if (period instanceof Date) {
    return period.toISOString().slice(0, 10);
  }

  const value = String(period).trim();

  /*
    Already YYYY-MM-DD
  */
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }

  /*
    Mar 2026
    March 2026
  */
  const monthYear = value.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})$/i
  );

  if (monthYear) {
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

    const month = monthMap[monthYear[1].slice(0, 3).toLowerCase()];
    const year = monthYear[2];

    const lastDay = new Date(
      Number(year),
      Number(month),
      0
    ).getDate();

    return `${year}-${month}-${String(lastDay).padStart(2, "0")}`;
  }

  /*
    FY2025-26
    2025-26
  */
  const financialYear = value.match(
    /^(?:FY)?(\d{4})-(\d{2,4})$/i
  );

  if (financialYear) {
    const startYear = Number(financialYear[1]);

    return `${startYear + 1}-03-31`;
  }

  return null;
}

function periodSortValue(period) {
  if (!period) {
    return 0;
  }

  const parsed = parsePeriodToDate(period);

  if (!parsed) {
    return 0;
  }

  const timestamp = Date.parse(`${parsed}T00:00:00Z`);

  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getLatestPeriodFromArray(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const candidates = items
    .map((item) => {
      const period = firstValue(
        item?.period,
        item?.date,
        item?.financial_year,
        item?.financialYear,
        item?.fy,
        item?.year,
        item?.quarter,
        item?.label
      );

      return {
        item,
        period,
        sortValue: periodSortValue(period),
      };
    })
    .filter((item) => item.period);

  if (!candidates.length) {
    return items[0];
  }

  candidates.sort(
    (a, b) => b.sortValue - a.sortValue
  );

  return candidates[0].item;
}

function findArraysDeep(value, results = [], depth = 0) {
  if (depth > 8 || value === null || value === undefined) {
    return results;
  }

  if (Array.isArray(value)) {
    results.push(value);

    for (const item of value) {
      findArraysDeep(item, results, depth + 1);
    }

    return results;
  }

  if (typeof value === "object") {
    for (const child of Object.values(value)) {
      findArraysDeep(child, results, depth + 1);
    }
  }

  return results;
}

function findLatestRecordDeep(value) {
  const arrays = findArraysDeep(value);

  let best = null;

  for (const array of arrays) {
    const record = getLatestPeriodFromArray(array);

    if (!record || typeof record !== "object") {
      continue;
    }

    const period = firstValue(
      record?.period,
      record?.date,
      record?.financial_year,
      record?.financialYear,
      record?.fy,
      record?.year,
      record?.quarter,
      record?.label
    );

    const score = periodSortValue(period);

    if (!best || score > best.score) {
      best = {
        record,
        period,
        score,
      };
    }
  }

  return best;
}

function getDataObject(responseJson) {
  if (!responseJson) {
    return null;
  }

  if (
    responseJson?.data &&
    typeof responseJson.data === "object"
  ) {
    return responseJson.data;
  }

  return responseJson;
}

function getDataArray(responseJson) {
  if (!responseJson) {
    return [];
  }

  if (Array.isArray(responseJson?.data)) {
    return responseJson.data;
  }

  if (Array.isArray(responseJson)) {
    return responseJson;
  }

  return [];
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
      error: error?.message || "Upstox request failed",
    };
  }
}

function parseRatios(response) {
  const data = getDataObject(response);

  return {
    pe: firstNumber(
      data?.pe,
      data?.pe_ratio,
      data?.price_to_earnings
    ),

    pb: firstNumber(
      data?.pb,
      data?.pb_ratio,
      data?.price_to_book
    ),

    roe: firstNumber(
      data?.roe,
      data?.return_on_equity
    ),

    roce: firstNumber(
      data?.roce,
      data?.return_on_capital_employed
    ),

    roa: firstNumber(
      data?.roa,
      data?.return_on_assets
    ),

    ev_ebitda: firstNumber(
      data?.ev_ebitda,
      data?.evToEbitda,
      data?.enterprise_value_to_ebitda
    ),
  };
}

function parseIncomeStatement(response) {
  const data = getDataObject(response);

  const latest = findLatestRecordDeep(data);

  let latestRecord = latest?.record || null;
  let latestPeriod = latest?.period || null;

  /*
    Fallback for common Upstox structure.
  */
  if (!latestRecord) {
    const arrays = findArraysDeep(data);

    for (const array of arrays) {
      if (!array.length) continue;

      const candidate = getLatestPeriodFromArray(array);

      if (candidate && typeof candidate === "object") {
        latestRecord = candidate;

        latestPeriod = firstValue(
          candidate?.period,
          candidate?.date,
          candidate?.financial_year,
          candidate?.financialYear,
          candidate?.fy,
          candidate?.year,
          candidate?.label
        );

        break;
      }
    }
  }

  const allRecords = findArraysDeep(data)
    .flat()
    .filter(
      (item) =>
        item &&
        typeof item === "object" &&
        (
          item?.period ||
          item?.date ||
          item?.financial_year ||
          item?.financialYear ||
          item?.fy ||
          item?.year
        )
    );

  const uniqueRecords = Array.from(
    new Map(
      allRecords.map((item) => [
        JSON.stringify(item),
        item,
      ])
    ).values()
  );

  uniqueRecords.sort(
    (a, b) =>
      periodSortValue(
        firstValue(
          b?.period,
          b?.date,
          b?.financial_year,
          b?.financialYear,
          b?.fy,
          b?.year,
          b?.label
        )
      ) -
      periodSortValue(
        firstValue(
          a?.period,
          a?.date,
          a?.financial_year,
          a?.financialYear,
          a?.fy,
          a?.year,
          a?.label
        )
      )
  );

  const current = latestRecord;
  const latestIndex = uniqueRecords.findIndex(
    (item) => JSON.stringify(item) === JSON.stringify(current)
  );

  const previous =
    uniqueRecords.find(
      (_, index) =>
        index > latestIndex &&
        JSON.stringify(_) !== JSON.stringify(current)
    ) || uniqueRecords[1] || null;

  const revenueLatest = firstNumber(
    current?.revenue,
    current?.revenue_from_operations,
    current?.total_revenue,
    current?.sales,
    current?.net_sales
  );

  const revenuePrevious = firstNumber(
    previous?.revenue,
    previous?.revenue_from_operations,
    previous?.total_revenue,
    previous?.sales,
    previous?.net_sales
  );

  const operatingProfitLatest = firstNumber(
    current?.operating_profit,
    current?.operatingProfit,
    current?.profit_from_operations
  );

  const netProfitLatest = firstNumber(
    current?.net_profit,
    current?.netProfit,
    current?.profit_after_tax,
    current?.profit_after_tax_pat
  );

  const netProfitPrevious = firstNumber(
    previous?.net_profit,
    previous?.netProfit,
    previous?.profit_after_tax,
    previous?.profit_after_tax_pat
  );

  return {
    latest_period: firstValue(
      current?.period,
      current?.date,
      current?.financial_year,
      current?.financialYear,
      current?.fy,
      current?.year,
      current?.label,
      latestPeriod
    ),

    previous_period: firstValue(
      previous?.period,
      previous?.date,
      previous?.financial_year,
      previous?.financialYear,
      previous?.fy,
      previous?.year,
      previous?.label
    ),

    revenue_latest: revenueLatest,
    revenue_previous: revenuePrevious,

    operating_profit_latest: operatingProfitLatest,

    net_profit_latest: netProfitLatest,
    net_profit_previous: netProfitPrevious,

    sales_growth: calculateGrowth(
      revenueLatest,
      revenuePrevious
    ),

    profit_growth: calculateGrowth(
      netProfitLatest,
      netProfitPrevious
    ),
  };
}

function parseBalanceSheet(response) {
  const data = getDataObject(response);

  const latest = findLatestRecordDeep(data);

  const current = latest?.record || {};

  const totalAssets = firstNumber(
    current?.total_assets,
    current?.totalAssets,
    current?.assets
  );

  const totalLiabilities = firstNumber(
    current?.total_liabilities,
    current?.totalLiabilities,
    current?.liabilities
  );

  const explicitDebtToEquity = firstNumber(
    current?.debt_to_equity,
    current?.debtEquity,
    current?.debt_to_equity_ratio
  );

  return {
    total_assets: totalAssets,
    total_liabilities: totalLiabilities,

    /*
      Never manufacture D/E from total liabilities.

      If Upstox gives D/E directly, use it.
      Otherwise retain null and let the DB/scorer decide.
    */
    debt_to_equity: explicitDebtToEquity,

    period: firstValue(
      current?.period,
      current?.date,
      current?.financial_year,
      current?.financialYear,
      current?.fy,
      current?.year,
      current?.label,
      latest?.period
    ),
  };
}

function parseCashFlow(response) {
  const data = getDataObject(response);

  const latest = findLatestRecordDeep(data);

  const current = latest?.record || {};

  return {
    operating: firstNumber(
      current?.operating_cash_flow,
      current?.operatingCashFlow,
      current?.cash_flow_from_operating_activities,
      current?.operating_activities
    ),

    investing: firstNumber(
      current?.investing_cash_flow,
      current?.investingCashFlow,
      current?.cash_flow_from_investing_activities,
      current?.investing_activities
    ),

    financing: firstNumber(
      current?.financing_cash_flow,
      current?.financingCashFlow,
      current?.cash_flow_from_financing_activities,
      current?.financing_activities
    ),

    period: firstValue(
      current?.period,
      current?.date,
      current?.financial_year,
      current?.financialYear,
      current?.fy,
      current?.year,
      current?.label,
      latest?.period
    ),
  };
}

function parseShareholding(response) {
  const rows = getDataArray(response);

  const latest = getLatestPeriodFromArray(rows);

  const current = latest || rows[0] || {};

  return {
    promoter: firstNumber(
      current?.promoter,
      current?.promoter_holding,
      current?.promoters
    ),

    fii: firstNumber(
      current?.fii,
      current?.fii_holding,
      current?.foreign_institutional_investors
    ),

    dii: firstNumber(
      current?.dii,
      current?.dii_holding,
      current?.domestic_institutional_investors
    ),

    other_dii: firstNumber(
      current?.other_dii,
      current?.otherDii
    ),

    mutual_funds: firstNumber(
      current?.mutual_funds,
      current?.mutualFunds
    ),

    public: firstNumber(
      current?.public,
      current?.public_holding,
      current?.retail_and_other
    ),

    raw_period: firstValue(
      current?.period,
      current?.date,
      current?.quarter,
      current?.financial_year,
      current?.financialYear,
      current?.label
    ),
  };
}

function countFields(record) {
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

  const available = fields.filter(
    (field) =>
      record?.[field] !== null &&
      record?.[field] !== undefined
  );

  return {
    available,
    completeness: Number(
      ((available.length / fields.length) * 100).toFixed(1)
    ),
  };
}

export async function GET(request) {
  try {
    const supabase = getSupabase();

    const { searchParams } = new URL(request.url);

    const requestedIsin =
      searchParams.get("isin")?.trim().toUpperCase();

    if (!requestedIsin) {
      return Response.json(
        {
          success: false,
          engine_version: ENGINE_VERSION,
          error: "Missing isin parameter",
        },
        { status: 400 }
      );
    }

    const isIsin =
      /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(requestedIsin);

    if (!isIsin) {
      return Response.json(
        {
          success: false,
          engine_version: ENGINE_VERSION,
          error: "Invalid ISIN",
        },
        { status: 400 }
      );
    }

    const { data: instrument, error: instrumentError } =
      await supabase
        .from("instruments")
        .select(
          "id,symbol,company_name,sector"
        )
        .eq("symbol", requestedIsin)
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
          engine_version: ENGINE_VERSION,
          error: `Instrument not found for ISIN ${requestedIsin}`,
        },
        { status: 404 }
      );
    }

    const endpoints = {};

    endpoints.profile = await upstoxGet(
      `/fundamentals/${requestedIsin}/profile`
    );

    endpoints.key_ratios = await upstoxGet(
      `/fundamentals/${requestedIsin}/key-ratios`
    );

    endpoints.balance_sheet = await upstoxGet(
      `/fundamentals/${requestedIsin}/balance-sheet?type=consolidated&fs=true`
    );

    endpoints.cash_flow = await upstoxGet(
      `/fundamentals/${requestedIsin}/cash-flow?type=consolidated&fs=true`
    );

    endpoints.income_statement = await upstoxGet(
      `/fundamentals/${requestedIsin}/income-statement?type=consolidated&time_period=yearly&fs=true`
    );

    endpoints.share_holdings = await upstoxGet(
      `/fundamentals/${requestedIsin}/share-holdings`
    );

    const endpointStatus = {};

    for (const [name, endpoint] of Object.entries(
      endpoints
    )) {
      endpointStatus[name] = {
        ok: endpoint.ok,
        status: endpoint.status,
        error: endpoint.error,
      };
    }

    const ratios = parseRatios(
      endpoints.key_ratios.data
    );

    const incomeStatement = parseIncomeStatement(
      endpoints.income_statement.data
    );

    const balanceSheet = parseBalanceSheet(
      endpoints.balance_sheet.data
    );

    const cashFlow = parseCashFlow(
      endpoints.cash_flow.data
    );

    const ownership = parseShareholding(
      endpoints.share_holdings.data
    );

    /*
      Preserve the company's existing market cap and
      other good fields in Supabase when Upstox does not
      provide them on the fundamentals response.

      This prevents a successful sync from degrading an
      already populated record.
    */
    const { data: existingFundamentals } =
      await supabase
        .from("fundamentals")
        .select("*")
        .eq("instrument_id", instrument.id)
        .maybeSingle();

    const profileData =
      getDataObject(endpoints.profile.data);

    const existing = existingFundamentals || {};

    const merged = {
      instrument_id: instrument.id,

      sales_growth:
        incomeStatement.sales_growth ??
        existing.sales_growth ??
        null,

      profit_growth:
        incomeStatement.profit_growth ??
        existing.profit_growth ??
        null,

      roe:
        ratios.roe ??
        existing.roe ??
        null,

      roce:
        ratios.roce ??
        existing.roce ??
        null,

      debt_to_equity:
        balanceSheet.debt_to_equity ??
        existing.debt_to_equity ??
        null,

      operating_cash_flow:
        cashFlow.operating ??
        existing.operating_cash_flow ??
        null,

      promoter_holding:
        ownership.promoter ??
        existing.promoter_holding ??
        null,

      fii_holding:
        ownership.fii ??
        existing.fii_holding ??
        null,

      /*
        Compatibility mapping used by our existing scorer.
      */
      dii_holding:
        ownership.dii !== null &&
        ownership.dii !== undefined
          ? ownership.dii
          : existing.dii_holding ?? null,

      market_cap:
        existing.market_cap ??
        null,

      pe_ratio:
        ratios.pe ??
        existing.pe_ratio ??
        null,

      pb_ratio:
        ratios.pb ??
        existing.pb_ratio ??
        null,

      book_value_per_share:
        existing.book_value_per_share ??
        null,

      eps:
        existing.eps ??
        null,

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
        incomeStatement.latest_period ??
        existing.financial_year ??
        null,

      shareholding_date:
        parsePeriodToDate(
          ownership.raw_period
        ) ??
        existing.shareholding_date ??
        null,

      updated_at: new Date().toISOString(),
    };

    const completeness = countFields(merged);

    const { data: savedFundamentals, error: saveError } =
      await supabase
        .from("fundamentals")
        .upsert(
          merged,
          {
            onConflict: "instrument_id",
          }
        )
        .select()
        .single();

    if (saveError) {
      throw new Error(
        `Failed to save fundamentals: ${saveError.message}`
      );
    }

    return Response.json({
      success: true,
      engine_version: ENGINE_VERSION,

      instrument: {
        id: instrument.id,
        symbol: instrument.symbol,
        company_name: instrument.company_name,
        sector: instrument.sector,
      },

      provider: "Upstox",

      endpoint_status: endpointStatus,

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
        ev_ebitda: ratios.ev_ebitda,
      },

      income_statement: incomeStatement,

      balance_sheet: balanceSheet,

      cash_flow: cashFlow,

      ownership: {
        promoter: ownership.promoter,
        fii: ownership.fii,
        dii: ownership.dii,
        other_dii: ownership.other_dii,
        mutual_funds: ownership.mutual_funds,
        public: ownership.public,
        raw_period: ownership.raw_period,
        database_date:
          parsePeriodToDate(
            ownership.raw_period
          ),
      },

      valuation: {
        market_cap: merged.market_cap,
        pe: merged.pe_ratio,
        pb: merged.pb_ratio,
        eps: merged.eps,
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
          incomeStatement.latest_period,

        balance_sheet:
          balanceSheet.period,

        cash_flow:
          cashFlow.period,

        aligned:
          parsePeriodToDate(
            incomeStatement.latest_period
          ) ===
            parsePeriodToDate(
              balanceSheet.period
            ) &&
          parsePeriodToDate(
            incomeStatement.latest_period
          ) ===
            parsePeriodToDate(
              cashFlow.period
            ),
      },

      sync: {
        completeness:
          completeness.completeness,

        available_fields:
          completeness.available,

        saved_to: "fundamentals",

        record_id:
          savedFundamentals?.id ??
          null,
      },
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        engine_version: ENGINE_VERSION,
        step: "unexpected",
        error:
          error?.message ||
          "Unknown error",
      },
      { status: 500 }
    );
  }
}
