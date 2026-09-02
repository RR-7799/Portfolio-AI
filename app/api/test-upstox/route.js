import { NextResponse } from "next/server";

/*
|--------------------------------------------------------------------------
| CONFIG
|--------------------------------------------------------------------------
*/

const UPSTOX_BASE_URL =
  "https://api.upstox.com/v2";

const DEFAULT_ISIN =
  "INE263A01024"; // Bharat Electronics Ltd

const API_VERSION =
  "upstox_test_v1";

/*
|--------------------------------------------------------------------------
| ENV
|--------------------------------------------------------------------------
*/

const analyticsToken =
  process.env.UPSTOX_ANALYTICS_TOKEN;

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

function cleanText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  return String(value).trim();
}

function findDataArray(response) {
  if (
    Array.isArray(
      response?.data
    )
  ) {
    return response.data;
  }

  return [];
}

function findDataObject(response) {
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
| UPSTOX REQUEST
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
| KEY RATIO PARSER
|--------------------------------------------------------------------------
*/

function parseRatios(
  response
) {
  const rows =
    findDataArray(
      response
    );

  const result = {
    pe_ratio: null,
    pb_ratio: null,
    roa: null,
    roe: null,
    roce: null,
    ev_ebitda: null,

    sector_pe: null,
    sector_pb: null,
    sector_roa: null,
    sector_roe: null,
    sector_roce: null,
    sector_ev_ebitda: null,
  };

  for (
    const row of rows
  ) {
    const name =
      cleanText(
        row?.name
      )?.toUpperCase();

    const companyValue =
      row?.company_value;

    const sectorValue =
      row?.sector_value;

    if (
      name === "P/E"
    ) {
      result.pe_ratio =
        numberOrNull(
          companyValue
        );

      result.sector_pe =
        numberOrNull(
          sectorValue
        );
    }

    if (
      name === "P/B"
    ) {
      result.pb_ratio =
        numberOrNull(
          companyValue
        );

      result.sector_pb =
        numberOrNull(
          sectorValue
        );
    }

    if (
      name === "ROA"
    ) {
      result.roa =
        numberOrNull(
          String(
            companyValue ||
              ""
          ).replace(
            "%",
            ""
          )
        );

      result.sector_roa =
        numberOrNull(
          String(
            sectorValue ||
              ""
          ).replace(
            "%",
            ""
          )
        );
    }

    if (
      name === "ROE"
    ) {
      result.roe =
        numberOrNull(
          String(
            companyValue ||
              ""
          ).replace(
            "%",
            ""
          )
        );

      result.sector_roe =
        numberOrNull(
          String(
            sectorValue ||
              ""
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
            companyValue ||
              ""
          ).replace(
            "%",
            ""
          )
        );

      result.sector_roce =
        numberOrNull(
          String(
            sectorValue ||
              ""
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

      result.sector_ev_ebitda =
        numberOrNull(
          sectorValue
        );
    }
  }

  return {
    rows,
    parsed: result,
  };
}

/*
|--------------------------------------------------------------------------
| GENERIC ARRAY SUMMARY
|--------------------------------------------------------------------------
*/

function summarizeArray(
  response
) {
  const rows =
    findDataArray(
      response
    );

  return {
    count: rows.length,
    sample:
      rows.slice(0, 3),
  };
}

/*
|--------------------------------------------------------------------------
| GENERIC OBJECT SUMMARY
|--------------------------------------------------------------------------
*/

function summarizeObject(
  response
) {
  const data =
    findDataObject(
      response
    );

  return {
    keys:
      Object.keys(data),
    data,
  };
}

/*
|--------------------------------------------------------------------------
| MAIN TEST
|--------------------------------------------------------------------------
*/

export async function GET(
  request
) {
  try {
    /*
    |--------------------------------------------------------------------------
    | TOKEN CHECK
    |--------------------------------------------------------------------------
    */

    if (!analyticsToken) {
      return NextResponse.json(
        {
          success: false,
          engine_version:
            API_VERSION,
          error:
            "UPSTOX_ANALYTICS_TOKEN is missing in Vercel environment variables.",
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

    const isin =
      (
        searchParams.get(
          "isin"
        ) ||
        DEFAULT_ISIN
      )
        .trim()
        .toUpperCase();

    /*
    |--------------------------------------------------------------------------
    | ENDPOINTS
    |--------------------------------------------------------------------------
    */

    const endpoints = {
      profile:
        `/fundamentals/${encodeURIComponent(
          isin
        )}/profile`,

      key_ratios:
        `/fundamentals/${encodeURIComponent(
          isin
        )}/key-ratios`,

      balance_sheet:
        `/fundamentals/${encodeURIComponent(
          isin
        )}/balance-sheet`,

      cash_flow:
        `/fundamentals/${encodeURIComponent(
          isin
        )}/cash-flow`,

      income_statement:
        `/fundamentals/${encodeURIComponent(
          isin
        )}/income-statement?type=consolidated&time_period=yearly`,

      share_holdings:
        `/fundamentals/${encodeURIComponent(
          isin
        )}/share-holdings`,

      corporate_actions:
        `/fundamentals/${encodeURIComponent(
          isin
        )}/corporate-actions`,
    };

    /*
    |--------------------------------------------------------------------------
    | CALL ONE BY ONE
    |--------------------------------------------------------------------------
    |
    | We intentionally do this sequentially so that:
    | - errors are easy to identify
    | - response mapping is clear
    | - no unnecessary concurrent load
    |
    */

    const profile =
      await upstoxFetch(
        endpoints.profile
      );

    const keyRatios =
      await upstoxFetch(
        endpoints.key_ratios
      );

    const balanceSheet =
      await upstoxFetch(
        endpoints.balance_sheet
      );

    const cashFlow =
      await upstoxFetch(
        endpoints.cash_flow
      );

    const incomeStatement =
      await upstoxFetch(
        endpoints.income_statement
      );

    const shareHoldings =
      await upstoxFetch(
        endpoints.share_holdings
      );

    const corporateActions =
      await upstoxFetch(
        endpoints.corporate_actions
      );

    /*
    |--------------------------------------------------------------------------
    | PARSE RATIOS
    |--------------------------------------------------------------------------
    */

    const ratioResult =
      keyRatios.ok
        ? parseRatios(
            keyRatios.data
          )
        : {
            rows: [],
            parsed: {
              pe_ratio: null,
              pb_ratio: null,
              roa: null,
              roe: null,
              roce: null,
              ev_ebitda: null,

              sector_pe: null,
              sector_pb: null,
              sector_roa: null,
              sector_roe: null,
              sector_roce: null,
              sector_ev_ebitda:
                null,
            },
          };

    /*
    |--------------------------------------------------------------------------
    | PROFILE
    |--------------------------------------------------------------------------
    */

    const profileData =
      profile.ok
        ? findDataObject(
            profile.data
          )
        : {};

    /*
    |--------------------------------------------------------------------------
    | FINAL RESPONSE
    |--------------------------------------------------------------------------
    */

    return NextResponse.json(
      {
        success: true,

        engine_version:
          API_VERSION,

        provider:
          "Upstox",

        instrument: {
          isin,
        },

        endpoint_status: {
          profile: {
            ok: profile.ok,
            status:
              profile.status,
            error:
              profile.error ||
              null,
          },

          key_ratios: {
            ok:
              keyRatios.ok,
            status:
              keyRatios.status,
            error:
              keyRatios.error ||
              null,
          },

          balance_sheet: {
            ok:
              balanceSheet.ok,
            status:
              balanceSheet.status,
            error:
              balanceSheet.error ||
              null,
          },

          cash_flow: {
            ok:
              cashFlow.ok,
            status:
              cashFlow.status,
            error:
              cashFlow.error ||
              null,
          },

          income_statement: {
            ok:
              incomeStatement.ok,
            status:
              incomeStatement.status,
            error:
              incomeStatement.error ||
              null,
          },

          share_holdings: {
            ok:
              shareHoldings.ok,
            status:
              shareHoldings.status,
            error:
              shareHoldings.error ||
              null,
          },

          corporate_actions: {
            ok:
              corporateActions.ok,
            status:
              corporateActions.status,
            error:
              corporateActions.error ||
              null,
          },
        },

        /*
        |--------------------------------------------------------------------------
        | PROFILE
        |--------------------------------------------------------------------------
        */

        profile: {
          company_profile:
            profileData.company_profile ??
            null,

          sector:
            profileData.sector ??
            null,

          sector_market_cap_inr:
            profileData.sector_market_cap_inr ??
            null,

          sector_market_cap_usd:
            profileData.sector_market_cap_usd ??
            null,
        },

        /*
        |--------------------------------------------------------------------------
        | KEY RATIOS
        |--------------------------------------------------------------------------
        */

        key_ratios: {
          available:
            keyRatios.ok,

          parsed:
            ratioResult.parsed,

          raw_rows:
            ratioResult.rows,
        },

        /*
        |--------------------------------------------------------------------------
        | BALANCE SHEET
        |--------------------------------------------------------------------------
        */

        balance_sheet:
          balanceSheet.ok
            ? summarizeArray(
                balanceSheet.data
              )
            : null,

        /*
        |--------------------------------------------------------------------------
        | CASH FLOW
        |--------------------------------------------------------------------------
        */

        cash_flow:
          cashFlow.ok
            ? summarizeArray(
                cashFlow.data
              )
            : null,

        /*
        |--------------------------------------------------------------------------
        | INCOME STATEMENT
        |--------------------------------------------------------------------------
        */

        income_statement:
          incomeStatement.ok
            ? summarizeArray(
                incomeStatement.data
              )
            : null,

        /*
        |--------------------------------------------------------------------------
        | SHAREHOLDING
        |--------------------------------------------------------------------------
        */

        share_holdings:
          shareHoldings.ok
            ? summarizeArray(
                shareHoldings.data
              )
            : null,

        /*
        |--------------------------------------------------------------------------
        | CORPORATE ACTIONS
        |--------------------------------------------------------------------------
        */

        corporate_actions:
          corporateActions.ok
            ? summarizeArray(
                corporateActions.data
              )
            : null,

        /*
        |--------------------------------------------------------------------------
        | SCORER FIELD CHECK
        |--------------------------------------------------------------------------
        */

        scorer_field_check: {
          pe_ratio:
            ratioResult.parsed
              .pe_ratio,

          pb_ratio:
            ratioResult.parsed
              .pb_ratio,

          roe:
            ratioResult.parsed
              .roe,

          roce:
            ratioResult.parsed
              .roce,

          roa:
            ratioResult.parsed
              .roa,

          ev_ebitda:
            ratioResult.parsed
              .ev_ebitda,

          income_statement:
            incomeStatement.ok,

          balance_sheet:
            balanceSheet.ok,

          cash_flow:
            cashFlow.ok,

          share_holdings:
            shareHoldings.ok,

          corporate_actions:
            corporateActions.ok,
        },

        /*
        |--------------------------------------------------------------------------
        | IMPORTANT
        |--------------------------------------------------------------------------
        |
        | We intentionally return raw samples rather than attempting to
        | convert every Upstox financial field yet.
        |
        */

        raw_debug: {
          profile:
            profile.ok
              ? profile.data
              : null,

          key_ratios:
            keyRatios.ok
              ? keyRatios.data
              : null,

          balance_sheet:
            balanceSheet.ok
              ? balanceSheet.data
              : null,

          cash_flow:
            cashFlow.ok
              ? cashFlow.data
              : null,

          income_statement:
            incomeStatement.ok
              ? incomeStatement.data
              : null,

          share_holdings:
            shareHoldings.ok
              ? shareHoldings.data
              : null,

          corporate_actions:
            corporateActions.ok
              ? corporateActions.data
              : null,
        },
      },
      {
        status: 200,
      }
    );
  } catch (error) {
    console.error(
      "Upstox test error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        engine_version:
          API_VERSION,
        provider:
          "Upstox",
        error:
          error?.message ||
          "Unknown Upstox test error.",
      },
      {
        status: 500,
      }
    );
  }
}
