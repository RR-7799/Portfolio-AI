'use client';

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

export default function Dashboard() {
  const [session, setSession] = useState(null);
  const [stocks, setStocks] = useState([]);
  const [mfs, setMfs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);

      if (data.session) {
        loadPortfolio(data.session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        setSession(s);

        if (s) {
          loadPortfolio(s.user.id);
        }
      }
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  async function loadPortfolio(userId) {
    setLoading(true);
    setError("");

    const [stockRes, mfRes] = await Promise.all([
      supabase
        .from("holdings")
        .select(
          "id, quantity, average_price, invested_value, current_value, unrealized_pnl, pnl_percentage"
        )
        .eq("user_id", userId),

      supabase
        .from("mf_holdings")
        .select(
          "id, units, average_nav, invested_value, current_nav, current_value, unrealized_pnl, pnl_percentage"
        )
        .eq("user_id", userId),
    ]);

    if (stockRes.error) {
      setError("Stock data error: " + stockRes.error.message);
      setStocks([]);
    } else {
      setStocks(stockRes.data || []);
    }

    if (mfRes.error) {
      setError((old) => old || "MF data error: " + mfRes.error.message);
      setMfs([]);
    } else {
      setMfs(mfRes.data || []);
    }

    setLoading(false);
  }

  const stockInvested = stocks.reduce(
    (s, x) => s + Number(x.invested_value || 0),
    0
  );

  const stockValue = stocks.reduce(
    (s, x) => s + Number(x.current_value || 0),
    0
  );

  const mfInvested = mfs.reduce(
    (s, x) => s + Number(x.invested_value || 0),
    0
  );

  const mfValue = mfs.reduce(
    (s, x) => s + Number(x.current_value || 0),
    0
  );

  const invested = stockInvested + mfInvested;
  const value = stockValue + mfValue;
  const pnl = value - invested;
  const pnlPct = invested ? (pnl / invested) * 100 : 0;

  if (!session) {
    return <Login />;
  }

  return (
    <main className="shell">

      <header className="topbar">
        <div>
          <div className="eyebrow">PORTFOLIO AI</div>

          <h1>Your Portfolio</h1>

          <p>
            Simple view. Deeper intelligence behind it.
          </p>
        </div>

        <button onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </header>

      {error && (
        <div className="error">
          {error}
        </div>
      )}

      <section className="hero card">

        <div>
          <span className="label">
            TOTAL PORTFOLIO
          </span>

          <div className="heroValue">
            {money(value)}
          </div>

          <div className={pnl >= 0 ? "positive" : "negative"}>
            {money(pnl)} ({pnlPct.toFixed(2)}%)
          </div>
        </div>

        <div className="goal">

          <span className="label">
            ₹9 CRORE GOAL
          </span>

          <strong>
            {((value / 90000000) * 100).toFixed(2)}%
          </strong>

          <div className="bar">
            <span
              style={{
                width: `${Math.min(
                  (value / 90000000) * 100,
                  100
                )}%`,
              }}
            />
          </div>

        </div>

      </section>


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
              stockValue - stockInvested >= 0
                ? "positive"
                : "negative"
            }
          >
            P/L {money(stockValue - stockInvested)}
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
              mfValue - mfInvested >= 0
                ? "positive"
                : "negative"
            }
          >
            P/L {money(mfValue - mfInvested)}
          </div>

        </div>

      </section>


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

          <table>

            <thead>

              <tr>
                <th>Holding</th>
                <th>Qty</th>
                <th>Invested</th>
                <th>Value</th>
                <th>P/L</th>
              </tr>

            </thead>

            <tbody>

              {stocks.map((x) => (

                <tr key={x.id}>

                  <td>
                    Stock
                  </td>

                  <td>
                    {Number(x.quantity).toLocaleString(
                      "en-IN"
                    )}
                  </td>

                  <td>
                    {money(x.invested_value)}
                  </td>

                  <td>
                    {money(x.current_value)}
                  </td>

                  <td
                    className={
                      Number(x.unrealized_pnl) >= 0
                        ? "positive"
                        : "negative"
                    }
                  >
                    {money(x.unrealized_pnl)}
                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        )}

      </section>


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

          <table>

            <thead>

              <tr>
                <th>Holding</th>
                <th>Units</th>
                <th>Invested</th>
                <th>Value</th>
                <th>P/L</th>
              </tr>

            </thead>

            <tbody>

              {mfs.map((x) => (

                <tr key={x.id}>

                  <td>
                    Mutual Fund
                  </td>

                  <td>
                    {Number(x.units).toLocaleString(
                      "en-IN",
                      {
                        maximumFractionDigits: 3,
                      }
                    )}
                  </td>

                  <td>
                    {money(x.invested_value)}
                  </td>

                  <td>
                    {money(x.current_value)}
                  </td>

                  <td
                    className={
                      Number(x.unrealized_pnl) >= 0
                        ? "positive"
                        : "negative"
                    }
                  >
                    {money(x.unrealized_pnl)}
                  </td>

                </tr>

              ))}

            </tbody>

          </table>

        )}

      </section>

    </main>
  );
}


function Login() {

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function login(e) {

    e.preventDefault();

    setError("");

    const { error } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      });

    if (error) {
      setError(error.message);
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
          Sign in to view your consolidated portfolio.
        </p>

        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) =>
            setEmail(e.target.value)
          }
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) =>
            setPassword(e.target.value)
          }
          required
        />

        {error && (
          <div className="error">
            {error}
          </div>
        )}

        <button className="primary">
          Sign in
        </button>

      </form>

    </main>

  );
}
