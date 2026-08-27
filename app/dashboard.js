"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const money = (n) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(n || 0));

const number = (n, decimals = 2) =>
  Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

export default function Dashboard() {
  const [session, setSession] = useState(null);

  const [stocks, setStocks] = useState([]);
  const [mfs, setMfs] = useState([]);

  const [aiScores, setAiScores] = useState([]);

  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState("");
  const [aiError, setAiError] = useState("");

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;

      setSession(data.session);

      if (data.session) {
        loadPortfolio(data.session.user.id);
      } else {
        setLoading(false);
      }
    });

    const {
      data: listener,
    } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!mounted) return;

      setSession(s);

      if (s) {
        loadPortfolio(s.user.id);
      } else {
        setStocks([]);
        setMfs([]);
        setAiScores([]);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function loadPortfolio(userId) {
    setLoading(true);
    setError("");
    setAiError("");

    try {
      // ==================================================
      // 1. LOAD STOCK HOLDINGS
      // ==================================================

      const {
        data: stockData,
        error: stockError,
      } = await supabase
        .from("holdings")
        .select(
          "id, broker_account_id, instrument_id, quantity, average_price, invested_value, current_value, unrealized_pnl, pnl_percentage"
        )
        .eq("user_id", userId);

      if (stockError) {
        throw new Error(
          "Stock data error: " + stockError.message
        );
      }

      const rawStocks = stockData || [];

      // ==================================================
      // 2. GET INSTRUMENT IDS
      // ==================================================

      const instrumentIds = [
        ...new Set(
          rawStocks
            .map((x) => x.instrument_id)
            .filter(Boolean)
        ),
      ];

      // ==================================================
      // 3. LOAD INSTRUMENTS
      // ==================================================

      let instruments = [];

      if (instrumentIds.length > 0) {
        const {
          data,
          error,
        } = await supabase
          .from("instruments")
          .select("id, symbol, company_name")
          .in("id", instrumentIds);

        if (error) {
          throw new Error(
            "Instrument data error: " + error.message
          );
        }

        instruments = data || [];
      }

      // ==================================================
      // 4. GET BROKER IDS
      // ==================================================

      const brokerIds = [
        ...new Set(
          rawStocks
            .map((x) => x.broker_account_id)
            .filter(Boolean)
        ),
      ];

      // ==================================================
      // 5. LOAD BROKER ACCOUNTS
      // ==================================================

      let brokers = [];

      if (brokerIds.length > 0) {
        const {
          data,
          error,
        } = await supabase
          .from("broker_accounts")
          .select("id, broker_name")
          .in("id", brokerIds);

        if (error) {
          throw new Error(
            "Broker data error: " + error.message
          );
        }

        brokers = data || [];
      }

      // ==================================================
      // 6. CREATE LOOKUP MAPS
      // ==================================================

      const instrumentMap = new Map(
        instruments.map((x) => [x.id, x])
      );

      const brokerMap = new Map(
        brokers.map((x) => [x.id, x])
      );

      // ==================================================
      // 7. COMBINE STOCK DATA
      // ==================================================

      const combinedStocks = rawStocks.map((holding) => {
        const instrument =
          instrumentMap.get(holding.instrument_id);

        const broker =
          brokerMap.get(holding.broker_account_id);

        return {
          ...holding,

          symbol:
            instrument?.symbol || "—",

          company_name:
            instrument?.company_name || "Unknown Stock",

          broker_name:
            broker?.broker_name || "—",
        };
      });

      // ==================================================
      // 8. LOAD AI SCORES
      // ==================================================

      await loadAIScores(instrumentIds);

      // ==================================================
      // 9. LOAD MF HOLDINGS
      // ==================================================

      const {
        data: mfData,
        error: mfError,
      } = await supabase
        .from("mf_holdings")
        .select(
          "id, mutual_fund_id, units, average_nav, invested_value, current_nav, current_value, unrealized_pnl, pnl_percentage"
        )
        .eq("user_id", userId);

      if (mfError) {
        throw new Error(
          "MF data error: " + mfError.message
        );
      }

      const rawMFs = mfData || [];

      // ==================================================
      // 10. GET MUTUAL FUND IDS
      // ==================================================

      const mfIds = [
        ...new Set(
          rawMFs
            .map((x) => x.mutual_fund_id)
            .filter(Boolean)
        ),
      ];

      // ==================================================
      // 11. LOAD MUTUAL FUNDS
      // ==================================================

      let mutualFunds = [];

      if (mfIds.length > 0) {
        const {
          data,
          error,
        } = await supabase
          .from("mutual_funds")
          .select(
            "id, scheme_name, fund_house, category"
          )
          .in("id", mfIds);

        if (error) {
          throw new Error(
            "Mutual fund data error: " + error.message
          );
        }

        mutualFunds = data || [];
      }

      // ==================================================
      // 12. MUTUAL FUND LOOKUP
      // ==================================================

      const mutualFundMap = new Map(
        mutualFunds.map((x) => [x.id, x])
      );

      // ==================================================
      // 13. COMBINE MF DATA
      // ==================================================

      const combinedMFs = rawMFs.map((holding) => {
        const fund =
          mutualFundMap.get(holding.mutual_fund_id);

        return {
          ...holding,

          scheme_name:
            fund?.scheme_name ||
            "Unknown Mutual Fund",

          fund_house:
            fund?.fund_house || "—",

          category:
            fund?.category || "—",
        };
      });

      setStocks(combinedStocks);
      setMfs(combinedMFs);
    } catch (err) {
      console.error(err);

      setError(
        err.message ||
          "Unable to load portfolio."
      );

      setStocks([]);
      setMfs([]);
    }

    setLoading(false);
  }

  // ======================================================
  // LOAD SAVED AI SCORES
  // ======================================================

  async function loadAIScores(instrumentIds) {
    if (!instrumentIds.length) {
      setAiScores([]);
      return;
    }

    setAiLoading(true);
    setAiError("");

    try {
      const {
        data,
        error,
      } = await supabase
        .from("ai_scores")
        .select(
          `
          id,
          instrument_id,
          total_score,
          growth_score,
          profitability_score,
          debt_score,
          ownership_score,
          cashflow_score,
          valuation_score,
          risk_score,
          risk_level,
          rating,
          action,
          ai_summary,
          score_date,
          calculated_at
          `
        )
        .in("instrument_id", instrumentIds)
        .order("calculated_at", {
          ascending: false,
        });

      if (error) {
        console.error(
          "AI score query error:",
          error
        );

        setAiError(
          "AI scores could not be loaded."
        );

        setAiScores([]);
        return;
      }

      /*
       * There can be more than one score for a stock.
       * Because results are sorted newest first,
       * keep only the newest score for each instrument.
       */

      const latestScores = new Map();

      (data || []).forEach((score) => {
        if (
          !latestScores.has(
            score.instrument_id
          )
        ) {
          latestScores.set(
            score.instrument_id,
            score
          );
        }
      });

      setAiScores(
        Array.from(latestScores.values())
      );
    } catch (err) {
      console.error(
        "AI score loading error:",
        err
      );

      setAiError(
        "AI scores could not be loaded."
      );

      setAiScores([]);
    } finally {
      setAiLoading(false);
    }
  }

  // ======================================================
  // AI SCORE LOOKUP
  // ======================================================

  function getAIScore(instrumentId) {
    return aiScores.find(
      (x) =>
        x.instrument_id === instrumentId
    );
  }

  // ======================================================
  // PORTFOLIO CALCULATIONS
  // ======================================================

  const stockInvested = stocks.reduce(
    (sum, x) =>
      sum +
      Number(
        x.invested_value || 0
      ),
    0
  );

  const stockValue = stocks.reduce(
    (sum, x) =>
      sum +
      Number(
        x.current_value || 0
      ),
    0
  );

  const mfInvested = mfs.reduce(
    (sum, x) =>
      sum +
      Number(
        x.invested_value || 0
      ),
    0
  );

  const mfValue = mfs.reduce(
    (sum, x) =>
      sum +
      Number(
        x.current_value || 0
      ),
    0
  );

  const invested =
    stockInvested + mfInvested;

  const value =
    stockValue + mfValue;

  const pnl =
    value - invested;

  const pnlPct =
    invested
      ? (pnl / invested) * 100
      : 0;

  // ======================================================
  // AI PORTFOLIO SUMMARY
  // ======================================================

  const scoredStocks = stocks
    .map((stock) => ({
      stock,
      score: getAIScore(
        stock.instrument_id
      ),
    }))
    .filter((x) => x.score);

  const averageAIScore =
    scoredStocks.length > 0
      ? Math.round(
          scoredStocks.reduce(
            (sum, x) =>
              sum +
              Number(
                x.score.total_score || 0
              ),
            0
          ) / scoredStocks.length
        )
      : null;

  // ======================================================
  // LOGIN
  // ======================================================

  if (!session) {
    return <Login />;
  }

  // ======================================================
  // DASHBOARD
  // ======================================================

  return (
    <main className="shell">

      {/* ==================================================
          HEADER
      ================================================== */}

      <header className="topbar">

        <div>

          <div className="eyebrow">
            PORTFOLIO AI
          </div>

          <h1>
            Your Portfolio
          </h1>

          <p>
            Simple view. Deeper intelligence behind it.
          </p>

        </div>

        <button
          onClick={() =>
            supabase.auth.signOut()
          }
        >
          Sign out
        </button>

      </header>

      {/* ==================================================
          ERROR
      ================================================== */}

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {/* ==================================================
          TOTAL PORTFOLIO
      ================================================== */}

      <section className="hero card">

        <div>

          <span className="label">
            TOTAL PORTFOLIO
          </span>

          <div className="heroValue">
            {money(value)}
          </div>

          <div
            className={
              pnl >= 0
                ? "positive"
                : "negative"
            }
          >
            {money(pnl)}{" "}
            ({pnlPct.toFixed(2)}%)
          </div>

        </div>

        <div className="goal">

          <span className="label">
            ₹9 CRORE GOAL
          </span>

          <strong>
            {(
              (value / 90000000) *
              100
            ).toFixed(2)}
            %
          </strong>

          <div className="bar">

            <span
              style={{
                width: `${Math.min(
                  (value / 90000000) *
                    100,
                  100
                )}%`,
              }}
            />

          </div>

        </div>

      </section>

      {/* ==================================================
          STOCK + MF SUMMARY
      ================================================== */}

      <section className="grid two">

        <div className="card">

          <span className="label">
            STOCKS
          </span>

          <h2>
            {money(stockValue)}
          </h2>

          <p>
            Invested {money(stockInvested)}
          </p>

          <div
            className={
              stockValue -
                stockInvested >=
              0
                ? "positive"
                : "negative"
            }
          >
            P/L{" "}
            {money(
              stockValue -
                stockInvested
            )}
          </div>

        </div>

        <div className="card">

          <span className="label">
            MUTUAL FUNDS
          </span>

          <h2>
            {money(mfValue)}
          </h2>

          <p>
            Invested {money(mfInvested)}
          </p>

          <div
            className={
              mfValue -
                mfInvested >=
              0
                ? "positive"
                : "negative"
            }
          >
            P/L{" "}
            {money(
              mfValue -
                mfInvested
            )}
          </div>

        </div>

      </section>

      {/* ==================================================
          PORTFOLIO AI
      ================================================== */}

      <section
        className="card"
        style={{
          marginTop: "20px",
        }}
      >

        <div
          style={{
            display: "flex",
            justifyContent:
              "space-between",
            alignItems: "center",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >

          <div>

            <span className="label">
              PORTFOLIO AI
            </span>

            <h2
              style={{
                marginTop: "8px",
              }}
            >
              AI Investment Intelligence
            </h2>

            <p>
              Fundamental, valuation,
              ownership and risk analysis
              for your holdings.
            </p>

          </div>

          {averageAIScore !== null && (
            <div
              style={{
                minWidth: "180px",
                textAlign: "center",
                padding: "18px",
                border:
                  "1px solid #e2e8f0",
                borderRadius: "14px",
              }}
            >

              <div className="label">
                AVERAGE AI SCORE
              </div>

              <div
                style={{
                  fontSize: "38px",
                  fontWeight: "800",
                  marginTop: "5px",
                }}
              >
                {averageAIScore}
                <span
                  style={{
                    fontSize: "18px",
                    fontWeight: "500",
                  }}
                >
                  /100
                </span>
              </div>

              <div
                style={{
                  marginTop: "5px",
                  fontWeight: "600",
                }}
              >
                {averageAIScore >= 80
                  ? "STRONG"
                  : averageAIScore >= 70
                  ? "GOOD"
                  : averageAIScore >= 60
                  ? "AVERAGE"
                  : "WEAK"}
              </div>

            </div>
          )}

        </div>

        {aiLoading && (
          <p
            style={{
              marginTop: "20px",
            }}
          >
            Loading AI intelligence...
          </p>
        )}

        {!aiLoading &&
          scoredStocks.length === 0 && (
            <div
              style={{
                marginTop: "20px",
                padding: "20px",
                border:
                  "1px solid #e2e8f0",
                borderRadius: "12px",
              }}
            >
              <strong>
                No AI scores available yet.
              </strong>

              <p>
                Run the Portfolio AI scoring
                engine for your holdings to
                see scores here.
              </p>
            </div>
          )}

        {!aiLoading &&
          scoredStocks.length > 0 && (

            <div
              style={{
                marginTop: "20px",
                overflowX: "auto",
              }}
            >

              <table>

                <thead>

                  <tr>

                    <th>
                      Stock
                    </th>

                    <th>
                      AI Score
                    </th>

                    <th>
                      Rating
                    </th>

                    <th>
                      Risk
                    </th>

                    <th>
                      Action
                    </th>

                  </tr>

                </thead>

                <tbody>

                  {scoredStocks.map(
                    ({
                      stock,
                      score,
                    }) => (

                      <tr
                        key={
                          stock.id
                        }
                      >

                        <td>
                          <strong>
                            {
                              stock.company_name
                            }
                          </strong>

                          <div
                            style={{
                              fontSize:
                                "12px",
                              opacity:
                                0.65,
                              marginTop:
                                "3px",
                            }}
                          >
                            {
                              stock.symbol
                            }
                          </div>
                        </td>

                        <td>

                          <strong
                            style={{
                              fontSize:
                                "20px",
                            }}
                          >
                            {
                              score.total_score
                            }
                          </strong>

                          <span
                            style={{
                              opacity:
                                0.6,
                            }}
                          >
                            /100
                          </span>

                        </td>

                        <td>
                          <strong>
                            {
                              score.rating ||
                              "—"
                            }
                          </strong>
                        </td>

                        <td>
                          {
                            score.risk_level ||
                            "—"
                          }
                        </td>

                        <td>

                          <strong
                            className={
                              score.action ===
                              "BUY" ||
                              score.action ===
                              "ACCUMULATE"
                                ? "positive"
                                : score.action ===
                                  "SELL" ||
                                  score.action ===
                                  "EXIT"
                                ? "negative"
                                : ""
                            }
                          >
                            {
                              score.action ||
                              "—"
                            }
                          </strong>

                        </td>

                      </tr>

                    )
                  )}

                </tbody>

              </table>

            </div>

          )}

        {aiError && (
          <div
            style={{
              marginTop: "12px",
              fontSize: "13px",
              opacity: 0.7,
            }}
          >
            {aiError}
          </div>
        )}

      </section>

      {/* ==================================================
          STOCK HOLDINGS
      ================================================== */}

      <section className="card">

        <span className="label">
          STOCK HOLDINGS
        </span>

        <h2>
          {loading
            ? "Loading..."
            : `${stocks.length} positions`}
        </h2>

        {!loading && (

          <div
            style={{
              overflowX: "auto",
            }}
          >

            <table>

              <thead>

                <tr>

                  <th>
                    Company
                  </th>

                  <th>
                    Symbol
                  </th>

                  <th>
                    Broker
                  </th>

                  <th>
                    Qty
                  </th>

                  <th>
                    Invested
                  </th>

                  <th>
                    Value
                  </th>

                  <th>
                    P/L
                  </th>

                  <th>
                    AI
                  </th>

                </tr>

              </thead>

              <tbody>

                {stocks.map((x) => {

                  const ai =
                    getAIScore(
                      x.instrument_id
                    );

                  return (

                    <tr key={x.id}>

                      <td>
                        <strong>
                          {
                            x.company_name
                          }
                        </strong>
                      </td>

                      <td>
                        {x.symbol}
                      </td>

                      <td>
                        {x.broker_name}
                      </td>

                      <td>
                        {Number(
                          x.quantity || 0
                        ).toLocaleString(
                          "en-IN"
                        )}
                      </td>

                      <td>
                        {money(
                          x.invested_value
                        )}
                      </td>

                      <td>
                        {money(
                          x.current_value
                        )}
                      </td>

                      <td
                        className={
                          Number(
                            x.unrealized_pnl
                          ) >= 0
                            ? "positive"
                            : "negative"
                        }
                      >
                        {money(
                          x.unrealized_pnl
                        )}
                      </td>

                      <td>

                        {ai ? (

                          <div>

                            <strong
                              style={{
                                fontSize:
                                  "17px",
                              }}
                            >
                              {
                                ai.total_score
                              }
                            </strong>

                            <div
                              style={{
                                fontSize:
                                  "11px",
                                marginTop:
                                  "2px",
                              }}
                            >
                              {
                                ai.action ||
                                ai.rating ||
                                "AI"
                              }
                            </div>

                          </div>

                        ) : (

                          <span
                            style={{
                              opacity:
                                0.5,
                            }}
                          >
                            —
                          </span>

                        )}

                      </td>

                    </tr>

                  );
                })}

              </tbody>

            </table>

          </div>

        )}

      </section>

      {/* ==================================================
          MUTUAL FUNDS
      ================================================== */}

      <section className="card">

        <span className="label">
          MUTUAL FUNDS
        </span>

        <h2>
          {loading
            ? "Loading..."
            : `${mfs.length} positions`}
        </h2>

        {!loading && (

          <div
            style={{
              overflowX: "auto",
            }}
          >

            <table>

              <thead>

                <tr>

                  <th>
                    Fund
                  </th>

                  <th>
                    Fund House
                  </th>

                  <th>
                    Category
                  </th>

                  <th>
                    Units
                  </th>

                  <th>
                    Avg NAV
                  </th>

                  <th>
                    Current NAV
                  </th>

                  <th>
                    Invested
                  </th>

                  <th>
                    Value
                  </th>

                  <th>
                    P/L
                  </th>

                </tr>

              </thead>

              <tbody>

                {mfs.map((x) => (

                  <tr key={x.id}>

                    <td>
                      <strong>
                        {
                          x.scheme_name
                        }
                      </strong>
                    </td>

                    <td>
                      {
                        x.fund_house
                      }
                    </td>

                    <td>
                      {
                        x.category
                      }
                    </td>

                    <td>
                      {Number(
                        x.units || 0
                      ).toLocaleString(
                        "en-IN",
                        {
                          maximumFractionDigits:
                            3,
                        }
                      )}
                    </td>

                    <td>
                      ₹
                      {Number(
                        x.average_nav ||
                          0
                      ).toFixed(2)}
                    </td>

                    <td>
                      ₹
                      {Number(
                        x.current_nav ||
                          0
                      ).toFixed(2)}
                    </td>

                    <td>
                      {money(
                        x.invested_value
                      )}
                    </td>

                    <td>
                      {money(
                        x.current_value
                      )}
                    </td>

                    <td
                      className={
                        Number(
                          x.unrealized_pnl
                        ) >= 0
                          ? "positive"
                          : "negative"
                      }
                    >
                      {money(
                        x.unrealized_pnl
                      )}
                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        )}

      </section>

    </main>
  );
}


// ========================================================
// LOGIN
// ========================================================

function Login() {

  const [email, setEmail] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [error, setError] =
    useState("");

  async function login(e) {

    e.preventDefault();

    setError("");

    const {
      error,
    } =
      await supabase.auth.signInWithPassword(
        {
          email,
          password,
        }
      );

    if (error) {
      setError(
        error.message
      );
    }
  }

  return (

    <main className="login">

      <form
        className="card loginCard"
        onSubmit={login}
      >

        <div className="eyebrow">
          PORTFOLIO AI
        </div>

        <h1>
          Your money. One screen.
        </h1>

        <p>
          Sign in to view your
          consolidated portfolio.
        </p>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) =>
            setEmail(
              e.target.value
            )
          }
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) =>
            setPassword(
              e.target.value
            )
          }
          required
        />

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        <button
          className="primary"
          type="submit"
        >
          Sign in
        </button>

      </form>

    </main>
  );
}
