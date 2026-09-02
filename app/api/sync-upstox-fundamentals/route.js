import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const UPSTOX_BASE_URL =
  "https://api.upstox.com/v2";

const ENGINE_VERSION =
  "upstox_fundamentals_v1";

/*
|--------------------------------------------------------------------------
| ENVIRONMENT
|--------------------------------------------------------------------------
*/

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const analyticsToken =
  process.env.UPSTOX_ANALYTICS_TOKEN;

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
  const n =
    numberOrNull(value);

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

function normalizeKey(
  value
) {
  return String(
    value || ""
  )
    .toLowerCase()
    .replace(
      /[^a-z0-9]/g,
      ""
    );
}

/*
|--------------------------------------------------------------------------
| PRESERVE EXISTING GOOD DATA
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

  return numberOrNull(
    existing
  );
}

/*
|--------------------------------------------------------------------------
| API REQUEST
|--------------------------------------------------------------------------
*/

async function upstoxFetch(
  path
) {
  if (!analyticsToken) {
    return {
      ok: false,
      status: 0,
      error:
        "UPSTOX_ANALYTICS_TOKEN is missing.",
      data: null,
    };
  }

  try {
    const response =
      await fetch(
        `${UPSTOX_BASE_URL}${path}`,
        {
          method: "GET",

          headers: {
            Accept:
              "application/json",

            Authorization:
              `Bearer ${analyticsToken}`,
          },

          cache: "no-store",
        }
      );

    const text =
      await response.text();

    let data;

    try {
      data =
        JSON.parse(text);
    } catch {
      data = {
        raw_text: text,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status:
          response.status,
        error:
          `Upstox ${response.status}: ${
            typeof data ===
            "string"
              ? data
              : JSON.stringify(data)
          }`,
        data,
      };
    }

    return {
      ok: true,
      status:
        response.status,
      error: null,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error:
        error?.message ||
        "Unknown Upstox request error.",
      data: null,
    };
  }
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
      `Existing fundamentals lookup failed: ${error.message}`
    );
  }

  return data || null;
}

/*
|--------------------------------------------------------------------------
| SAVE
|--------------------------------------------------------------------------
*/

async function saveFundamentals(
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
| EXTRACT API DATA
|--------------------------------------------------------------------------
*/

function getDataObject(
  response
) {
  if (
    response?.data &&
    typeof response.data ===
      "object" &&
    !Array.isArray(
      response.data
    )
  ) {
    return response.data;
  }

  return {};
}

/*
|--------------------------------------------------------------------------
| KEY RATIOS
|--------------------------------------------------------------------------
*/

function parseKeyRatios(
  response
) {
  const data =
    getDataObject(
      response
    );

  const rows =
    Array.isArray(data)
      ? data
      : Array.isArray(
          response?.data
        )
        ? response.data
        : [];

  const result = {
    pe: null,
    pb: null,
    roe: null,
    roce: null,
    roa: null,
    ev_ebitda: null,
  };

  for (
    const row of rows
  ) {
    const name =
      String(
        row?.name || ""
      )
        .trim()
        .toUpperCase();

    const companyValue =
      row?.company_value;

    if (
      name === "P/E"
    ) {
      result.pe =
        numberOrNull(
          companyValue
        );
    }

    if (
      name === "P/B"
    ) {
      result.pb =
        numberOrNull(
          companyValue
        );
    }

    if (
      name === "ROE"
    ) {
      result.roe =
        numberOrNull(
          String(
            companyValue || ""
          ).replace(
            "%",
            ""
          )
        );
    }

    if (
      name === "ROCE"
    ) {
      result.roce =
        numberOrNull(
          String(
            companyValue || ""
          ).replace(
            "%",
            ""
          )
        );
    }

    if (
      name === "ROA"
    ) {
      result.roa =
        numberOrNull(
          String(
            companyValue || ""
          ).replace(
            "%",
            ""
          )
        );
    }

    if (
      name ===
      "EV/EBITDA"
    ) {
      result.ev_ebitda =
        numberOrNull(
          companyValue
        );
    }
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| HISTORY HELPERS
|--------------------------------------------------------------------------
*/

function getHistory(
  data,
  key
) {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return [];
  }

  const value =
    data[key];

  return Array.isArray(value)
    ? value
    : [];
}

function latestHistoryValue(
  data,
  key
) {
  const history =
    getHistory(
      data,
      key
    );

  if (!history.length) {
    return null;
  }

  return numberOrNull(
    history[0]?.value
  );
}

function previousHistoryValue(
  data,
  key
) {
  const history =
    getHistory(
      data,
      key
    );

  if (
    history.length < 2
  ) {
    return null;
  }

  return numberOrNull(
    history[1]?.value
  );
}

/*
|--------------------------------------------------------------------------
| FINANCIAL STATEMENT PARSER
|--------------------------------------------------------------------------
*/

function parseIncomeStatement(
  response
) {
  const data =
    getDataObject(
      response
    );

  const rows =
    Array.isArray(
      data?.income_statement
    )
      ? data.income_statement
      : [];

  const result = {
    revenue: {
      latest: null,
      previous: null,
    },

    operating_profit: {
      latest: null,
      previous: null,
    },

    net_profit: {
      latest: null,
      previous: null,
    },

    latest_period:
      null,

    previous_period:
      null,
  };

  for (
    const row of rows
  ) {
    const category =
      String(
        row?.category || ""
      )
        .trim()
        .toLowerCase();

    const history =
      Array.isArray(
        row?.history
      )
        ? row.history
        : [];

    if (
      category ===
      "revenue"
    ) {
      result.revenue.latest =
        numberOrNull(
          history[0]?.value
        );

      result.revenue.previous =
        numberOrNull(
          history[1]?.value
        );

      result.latest_period =
        history[0]?.period ??
        result.latest_period;

      result.previous_period =
        history[1]?.period ??
        result.previous_period;
    }

    if (
      category ===
      "operating_profit"
    ) {
      result.operating_profit.latest =
        numberOrNull(
          history[0]?.value
        );

      result.operating_profit.previous =
        numberOrNull(
          history[1]?.value
        );
    }

    if (
      category ===
      "net_profit"
    ) {
      result.net_profit.latest =
        numberOrNull(
          history[0]?.value
        );

      result.net_profit.previous =
        numberOrNull(
          history[1]?.value
        );
    }
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| CASH FLOW PARSER
|--------------------------------------------------------------------------
*/

function parseCashFlow(
  response
) {
  const data =
    getDataObject(
      response
    );

  const rows =
    Array.isArray(
      data?.cash_flow
    )
      ? data.cash_flow
      : [];

  const result = {
    operating: null,
    investing: null,
    financing: null,
    period: null,
  };

  for (
    const row of rows
  ) {
    const category =
      String(
        row?.category || ""
      )
        .trim()
        .toLowerCase();

    const history =
      Array.isArray(
        row?.history
      )
        ? row.history
        : [];

    const latest =
      history[0] || null;

    if (
      category ===
      "operating"
    ) {
      result.operating =
        numberOrNull(
          latest?.value
        );

      result.period =
        latest?.period ??
        result.period;
    }

    if (
      category ===
      "investing"
    ) {
      result.investing =
        numberOrNull(
          latest?.value
        );
    }

    if (
      category ===
      "financing"
    ) {
      result.financing =
        numberOrNull(
          latest?.value
        );
    }
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| BALANCE SHEET PARSER
|--------------------------------------------------------------------------
*/

function parseBalanceSheet(
  response
) {
  const data =
    getDataObject(
      response
    );

  const history =
    Array.isArray(
      data?.history
    )
      ? data.history
      : [];

  const latest =
    history[0] ||
    null;

  const result = {
    total_assets:
      numberOrNull(
        latest?.total_asset
      ),

    total_liabilities:
      numberOrNull(
        latest?.total_liability
      ),

    period:
      latest?.period ??
      null,

    full_statement:
      data?.full_statement ??
      null,
  };

  /*
  |--------------------------------------------------------------------------
  | Try to extract detailed debt/equity from full statement.
  |--------------------------------------------------------------------------
  */

  result.debt = findFinancialNumber(
    result.full_statement,
    [
      "total debt",
      "total borrowings",
      "total borrowings",
      "borrowings",
      "debt",
      "borrowings and other liabilities",
    ]
  );

  result.equity =
    findFinancialNumber(
      result.full_statement,
      [
        "total equity",
        "shareholders equity",
        "shareholders equity",
        "equity",
      ]
    );

  return result;
}

/*
|--------------------------------------------------------------------------
| RECURSIVE FINANCIAL VALUE SEARCH
|--------------------------------------------------------------------------
|
| Upstox exposes fs=true detailed statements.
| The exact nested line-item shape can vary.
|
| We search safely for known financial labels.
|
*/

function findFinancialNumber(
  node,
  targetLabels
) {
  if (
    node === null ||
    node === undefined
  ) {
    return null;
  }

  const normalizedTargets =
    targetLabels.map(
      (label) =>
        normalizeKey(label)
    );

  if (
    typeof node === "object"
  ) {
    if (
      "name" in node &&
      "value" in node
    ) {
      const normalizedName =
        normalizeKey(
          node.name
        );

      if (
        normalizedTargets.includes(
          normalizedName
        )
      ) {
        const value =
          numberOrNull(
            node.value
          );

        if (
          value !== null
        ) {
          return value;
        }
      }
    }

    if (
      "label" in node &&
      "value" in node
    ) {
      const normalizedLabel =
        normalizeKey(
          node.label
        );

      if (
        normalizedTargets.includes(
          normalizedLabel
        )
      ) {
        const value =
          numberOrNull(
            node.value
          );

        if (
          value !== null
        ) {
          return value;
        }
      }
    }

    for (
      const key of Object.keys(
        node
      )
    ) {
      const value =
        findFinancialNumber(
          node[key],
          targetLabels
        );

      if (
        value !== null
      ) {
        return value;
      }
    }
  }

  if (
    Array.isArray(node)
  ) {
    for (
      const item of node
    ) {
      const value =
        findFinancialNumber(
          item,
          targetLabels
        );

      if (
        value !== null
      ) {
        return value;
      }
    }
  }

  return null;
}

/*
|--------------------------------------------------------------------------
| CALCULATIONS
|--------------------------------------------------------------------------
*/

function calculateGrowth(
  current,
  previous
) {
  const currentValue =
    numberOrNull(
      current
    );

  const previousValue =
    numberOrNull(
      previous
    );

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
      Math.abs(
        previousValue
      )
    ) * 100,
    2
  );
}

/*
|--------------------------------------------------------------------------
| SHAREHOLDING
|--------------------------------------------------------------------------
*/

function parseShareholding(
  response
) {
  const data =
    getDataObject(
      response
    );

  const rows =
    Array.isArray(data)
      ? data
      : Array.isArray(
          response?.data
        )
        ? response.data
        : [];

  const result = {
    promoter: null,
    fii: null,
    dii: null,
    mutual_funds: null,
    public: null,
    as_on_date:
      null,
  };

  for (
    const row of rows
  ) {
    const category =
      String(
        row?.category || ""
      )
        .trim()
        .toLowerCase();

    const history =
      Array.isArray(
        row?.history
      )
        ? row.history
        : [];

    const latest =
      history[0] || null;

    if (
      latest?.period &&
      !result.as_on_date
    ) {
      result.as_on_date =
        latest.period;
    }

    if (
      category ===
      "promoters"
    ) {
      result.promoter =
        numberOrNull(
          latest?.value
        );
    }

    if (
      category ===
      "fii"
    ) {
      result.fii =
        numberOrNull(
          latest?.value
        );
    }

    if (
      category ===
      "mutual_funds"
    ) {
      result.mutual_funds =
        numberOrNull(
          latest?.value
        );
    }

    if (
      category ===
      "other_dii"
    ) {
      /*
       * Upstox separates DII and mutual funds.
       * We keep other_dii here and combine it with
       * mutual funds below for the existing DII field.
       */
      const otherDii =
        numberOrNull(
          latest?.value
        );

      result.dii =
        (
          otherDii || 0
        ) +
        (
          result.mutual_funds ||
          0
        );
    }

    if (
      category ===
      "retail_and_other"
    ) {
      result.public =
        numberOrNull(
          latest?.value
        );
    }
  }

  return result;
}

/*
|--------------------------------------------------------------------------
| SYNC SINGLE INSTRUMENT
|--------------------------------------------------------------------------
*/

async function syncInstrument(
  instrument
) {
  const isin =
    String(
      instrument.symbol ||
        ""
    )
      .trim()
      .toUpperCase();

  const existing =
    await getExisting(
      instrument.id
    );

  /*
  |--------------------------------------------------------------------------
  | CALL FUNDAMENTAL ENDPOINTS
  |--------------------------------------------------------------------------
  */

  const profile =
    await upstoxFetch(
      `/fundamentals/${encodeURIComponent(
        isin
      )}/profile`
    );

  const ratios =
    await upstoxFetch(
      `/fundamentals/${encodeURIComponent(
        isin
      )}/key-ratios`
    );

  const balanceSheet =
    await upstoxFetch(
      `/fundamentals/${encodeURIComponent(
        isin
      )}/balance-sheet?type=consolidated&fs=true`
    );

  const cashFlow =
    await upstoxFetch(
      `/fundamentals/${encodeURIComponent(
        isin
      )}/cash-flow?type=consolidated&fs=true`
    );

  const incomeStatement =
    await upstoxFetch(
      `/fundamentals/${encodeURIComponent(
        isin
      )}/income-statement?type=consolidated&time_period=yearly&fs=true`
    );

  const shareHoldings =
    await upstoxFetch(
      `/fundamentals/${encodeURIComponent(
        isin
      )}/share-holdings`
    );

  /*
  |--------------------------------------------------------------------------
  | PARSE
  |--------------------------------------------------------------------------
  */

  const ratioData =
    ratios.ok
      ? parseKeyRatios(
          ratios.data
        )
      : {
          pe: null,
          pb: null,
          roe: null,
          roce: null,
          roa: null,
          ev_ebitda: null,
        };

  const incomeData =
    incomeStatement.ok
      ? parseIncomeStatement(
          incomeStatement.data
        )
      : {
          revenue: {
            latest: null,
            previous: null,
          },
          operating_profit: {
            latest: null,
            previous: null,
          },
          net_profit: {
            latest: null,
            previous: null,
          },
          latest_period: null,
          previous_period: null,
        };

  const cashData =
    cashFlow.ok
      ? parseCashFlow(
          cashFlow.data
        )
      : {
          operating: null,
          investing: null,
          financing: null,
          period: null,
        };

  const balanceData =
    balanceSheet.ok
      ? parseBalanceSheet(
          balanceSheet.data
        )
      : {
          total_assets: null,
          total_liabilities:
            null,
          period: null,
          debt: null,
          equity: null,
          full_statement:
            null,
        };

  const ownershipData =
    shareHoldings.ok
      ? parseShareholding(
          shareHoldings.data
        )
      : {
          promoter: null,
          fii: null,
          dii: null,
          mutual_funds: null,
          public: null,
          as_on_date:
            null,
        };

  /*
  |--------------------------------------------------------------------------
  | GROWTH
  |--------------------------------------------------------------------------
  */

  const salesGrowth =
    calculateGrowth(
      incomeData.revenue
        .latest,
      incomeData.revenue
        .previous
    );

  const profitGrowth =
    calculateGrowth(
      incomeData.net_profit
        .latest,
      incomeData.net_profit
        .previous
    );

  /*
  |--------------------------------------------------------------------------
  | DEBT / EQUITY
  |--------------------------------------------------------------------------
  */

  let debtToEquity =
    null;

  if (
    balanceData.debt !==
      null &&
    balanceData.equity !==
      null &&
    balanceData.equity > 0
  ) {
    debtToEquity =
      round(
        balanceData.debt /
          balanceData.equity,
        3
      );
  }

  /*
  |--------------------------------------------------------------------------
  | FALLBACK EQUITY CALCULATION
  |--------------------------------------------------------------------------
  |
  | Assets - liabilities = equity.
  |
  */

  if (
    debtToEquity === null &&
    balanceData.total_assets !==
      null &&
    balanceData.total_liabilities !==
      null
  ) {
    const estimatedEquity =
      balanceData.total_assets -
      balanceData.total_liabilities;

    /*
     * We deliberately do NOT assume total liabilities = debt.
     * Therefore we do not calculate a D/E ratio from total liabilities.
     *
     * We only use this value for diagnostics.
     */
  }

  /*
  |--------------------------------------------------------------------------
  | COMPANY PROFILE
  |--------------------------------------------------------------------------
  */

  const profileData =
    profile.ok
      ? getDataObject(
          profile.data
        )
      : {};

  /*
  |--------------------------------------------------------------------------
  | CRITICAL:
  |--------------------------------------------------------------------------
  |
  | profile.sector_market_cap_inr is SECTOR market cap.
  | Do NOT save it as company market cap.
  |
  */

  const existingMarketCap =
    existing?.market_cap ??
    null;

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
    | Fundamental metrics
    |--------------------------------------------------------------------------
    */

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
        ratioData.roe,
        existing?.roe
      ),

    roce:
      preserveValue(
        ratioData.roce,
        existing?.roce
      ),

    debt_to_equity:
      preserveValue(
        debtToEquity,
        existing?.debt_to_equity
      ),

    operating_cash_flow:
      preserveValue(
        cashData.operating,
        existing?.operating_cash_flow
      ),

    /*
    |--------------------------------------------------------------------------
    | Shareholding
    |--------------------------------------------------------------------------
    */

    promoter_holding:
      preserveValue(
        ownershipData.promoter,
        existing?.promoter_holding
      ),

    promoter_pledge:
      existing?.promoter_pledge ??
      null,

    fii_holding:
      preserveValue(
        ownershipData.fii,
        existing?.fii_holding
      ),

    dii_holding:
      preserveValue(
        ownershipData.dii,
        existing?.dii_holding
      ),

    shareholding_date:
      ownershipData.as_on_date ??
      existing?.shareholding_date ??
      null,

    /*
    |--------------------------------------------------------------------------
    | Financial periods
    |--------------------------------------------------------------------------
    */

    financial_year:
      incomeData.latest_period ??
      existing?.financial_year ??
      null,

    quarter:
      existing?.quarter ??
      null,

    /*
    |--------------------------------------------------------------------------
    | Valuation
    |--------------------------------------------------------------------------
    */

    /*
     * Important:
     * We intentionally preserve existing company market cap because
     * Upstox profile only gives sector market capitalisation.
     */
    market_cap:
      existingMarketCap,

    pe_ratio:
      preserveValue(
        ratioData.pe,
        existing?.pe_ratio
      ),

    pb_ratio:
      preserveValue(
        ratioData.pb,
        existing?.pb_ratio
      ),

    /*
    * Upstox key ratios does not expose EPS/BVPS directly.
    * Do not fabricate them.
    */
    eps:
      existing?.eps ??
      null,

    book_value_per_share:
      existing?.book_value_per_share ??
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

    free_cash_flow:
      existing?.free_cash_flow ??
      null,

    source:
      "Upstox",

    updated_at:
      new Date().toISOString(),
  };

  /*
  |--------------------------------------------------------------------------
  | SAVE
  |--------------------------------------------------------------------------
  */

  const saved =
    await saveFundamentals(
      record
    );

  /*
  |--------------------------------------------------------------------------
  | COMPLETENESS
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

  const availableFields =
    trackedFields.filter(
      (field) =>
        record[field] !==
          null &&
        record[field] !==
          undefined
    );

  const completeness =
    round(
      (
        availableFields.length /
        trackedFields.length
      ) * 100,
      1
    );

  /*
  |--------------------------------------------------------------------------
  | RESPONSE
  |--------------------------------------------------------------------------
  */

  return {
    success: true,

    instrument: {
      id: instrument.id,
      symbol: instrument.symbol,
      company_name:
        instrument.company_name,
      sector:
        instrument.sector ??
        null,
    },

    source:
      "Upstox",

    engine_version:
      ENGINE_VERSION,

    endpoint_status: {
      profile: {
        ok: profile.ok,
        status: profile.status,
        error:
          profile.error ??
          null,
      },

      key_ratios: {
        ok: ratios.ok,
        status: ratios.status,
        error:
          ratios.error ??
          null,
      },

      balance_sheet: {
        ok:
          balanceSheet.ok,
        status:
          balanceSheet.status,
        error:
          balanceSheet.error ??
          null,
      },

      cash_flow: {
        ok:
          cashFlow.ok,
        status:
          cashFlow.status,
        error:
          cashFlow.error ??
          null,
      },

      income_statement: {
        ok:
          incomeStatement.ok,
        status:
          incomeStatement.status,
        error:
          incomeStatement.error ??
          null,
      },

      share_holdings: {
        ok:
          shareHoldings.ok,
        status:
          shareHoldings.status,
        error:
          shareHoldings.error ??
          null,
      },
    },

    profile: {
      sector:
        profileData.sector ??
        null,
      company_profile:
        profileData.company_profile ??
        null,
    },

    ratios: {
      pe:
        record.pe_ratio,
      pb:
        record.pb_ratio,
      roe:
        record.roe,
      roce:
        record.roce,
      roa:
        ratioData.roa,
      ev_ebitda:
        ratioData.ev_ebitda,
    },

    income_statement: {
      latest_period:
        incomeData.latest_period,
      previous_period:
        incomeData.previous_period,
      revenue_latest:
        incomeData.revenue.latest,
      revenue_previous:
        incomeData.revenue.previous,
      operating_profit_latest:
        incomeData.operating_profit.latest,
      net_profit_latest:
        incomeData.net_profit.latest,
      net_profit_previous:
        incomeData.net_profit.previous,
      sales_growth:
        record.sales_growth,
      profit_growth:
        record.profit_growth,
    },

    balance_sheet: {
      total_assets:
        balanceData.total_assets,
      total_liabilities:
        balanceData.total_liabilities,
      debt_to_equity:
        record.debt_to_equity,
      period:
        balanceData.period,
    },

    cash_flow: {
      operating:
        record.operating_cash_flow,
      investing:
        cashData.investing,
      financing:
        cashData.financing,
      period:
        cashData.period,
    },

    ownership: {
      promoter:
        record.promoter_holding,
      fii:
        record.fii_holding,
      dii:
        record.dii_holding,
      mutual_funds:
        ownershipData.mutual_funds,
      public:
        ownershipData.public,
      as_on_date:
        record.shareholding_date,
    },

    valuation: {
      pe:
        record.pe_ratio,
      pb:
        record.pb_ratio,

      eps:
        record.eps,

      book_value_per_share:
        record.book_value_per_share,

      market_cap:
        record.market_cap,

      dividend_yield:
        record.dividend_yield,

      week_52_high:
        record.week_52_high,

      week_52_low:
        record.week_52_low,

      note:
        "Upstox key-ratios currently tested for PE/PB/ROE/ROCE/ROA/EV-EBITDA. EPS/BVPS/dividend yield/52W range are preserved from existing data when available and are not fabricated.",
    },

    sync: {
      completeness,
      saved_to:
        "fundamentals",
      record_id:
        saved?.id ??
        null,
    },
  };
}

/*
|--------------------------------------------------------------------------
| GET
|--------------------------------------------------------------------------
|
| Example:
|
| /api/sync-upstox-fundamentals?isin=INE263A01024
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
          error:
            "Supabase is not configured. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
        },
        {
          status: 500,
        }
      );
    }

    if (!analyticsToken) {
      return NextResponse.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          error:
            "UPSTOX_ANALYTICS_TOKEN is missing.",
        },
        {
          status: 500,
        }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | ISIN
    |--------------------------------------------------------------------------
    */

    const { searchParams } =
      new URL(
        request.url
      );

    const requestedIsin =
      (
        searchParams.get(
          "isin"
        ) ||
        ""
      )
        .trim()
        .toUpperCase();

    if (!requestedIsin) {
      return NextResponse.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          error:
            "Missing ?isin= parameter.",
          example:
            "/api/sync-upstox-fundamentals?isin=INE263A01024",
        },
        {
          status: 400,
        }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | FIND INSTRUMENT
    |--------------------------------------------------------------------------
    */

    const {
      data: instruments,
      error,
    } = await supabase
      .from("instruments")
      .select(
        "id, symbol, company_name, sector"
      )
      .eq(
        "symbol",
        requestedIsin
      )
      .limit(1);

    if (error) {
      return NextResponse.json(
        {
          success: false,
          engine_version:
            ENGINE_VERSION,
          step:
            "find_instrument",
          error:
            error.message,
        },
        {
          status: 500,
        }
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
          step:
            "find_instrument",
          error:
            `No instrument found for ISIN ${requestedIsin}.`,
        },
        {
          status: 404,
        }
      );
    }

    /*
    |--------------------------------------------------------------------------
    | SYNC
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
      "Upstox fundamentals sync failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        engine_version:
          ENGINE_VERSION,
        step:
          "unexpected",
        error:
          error?.message ||
          "Unknown Upstox fundamentals sync error.",
      },
      {
        status: 500,
      }
    );
  }
}
