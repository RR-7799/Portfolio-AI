"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import V55DecisionTable from "./V55DecisionTable";

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

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function login(e) {
    e.preventDefault();
    setError("");
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (loginError) setError(loginError.message);
  }

  return (
    <main className="login">
      <form className="card loginCard" onSubmit={login}>
        <div className="eyebrow">PORTFOLIO AI</div>
        <h1>Your money. One screen.</h1>
        <p>Sign in to view your consolidated portfolio.</p>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="error">{error}</div>}
        <button className="primary" type="submit">Sign in</button>
      </form>
    </main>
  );
}

export default function DashboardV55() {
  const [session, setSession] = useState(null);
  const [stocks, setStocks] = useState([]);
  const [mfs, setMfs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function init() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      if (data.session) await loadPortfolio(data.session.user.id);
      else setLoading(false);
    }

    init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      if (nextSession) loadPortfolio(nextSession.user.id);
      else {
        setStocks([]);
        setMfs([]);
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
    try {
      const { data: holdings, error: holdingError } = await supabase
        .from("holdings")
        .select("id, broker_account_id, instrument_id, quantity, average_price, invested_value, current_value, unrealized_pnl, pnl_percentage")
        .eq("user_id", userId);
      if (holdingError) throw new Error("Stock data error: " + holdingError.message);

      const rawStocks = holdings || [];
      const instrumentIds = [...new Set(rawStocks.map((x) => x.instrument_id).filter(Boolean))];
      const brokerIds = [...new Set(rawStocks.map((x) => x.broker_account_id).filter(Boolean))];

      const [{ data: instruments, error: instrumentError }, { data: brokers, error: brokerError }, { data: mfData, error: mfError }] = await Promise.all([
        instrumentIds.length
          ? supabase.from("instruments").select("id, symbol, company_name, sector").in("id", instrumentIds)
          : Promise.resolve({ data: [], error: null }),
        brokerIds.length
          ? supabase.from("broker_accounts").select("id, broker_name").in("id", brokerIds)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("mf_holdings").select("id, mutual_fund_id, units, average_nav, invested_value, current_nav, current_value, unrealized_pnl, pnl_percentage").eq("user_id", userId),
      ]);

      if (instrumentError) throw new Error("Instrument data error: " + instrumentError.message);
      if (brokerError) throw new Error("Broker data error: " + brokerError.message);
      if (mfError) throw new Error("MF data error: " + mfError.message);

      const instrumentMap = new Map((instruments || []).map((x) => [x.id, x]));
      const brokerMap = new Map((brokers || []).map((x) => [x.id, x]));
      setStocks(rawStocks.map((x) => ({
        ...x,
        symbol: instrumentMap.get(x.instrument_id)?.symbol || "—",
        company_name: instrumentMap.get(x.instrument_id)?.company_name || "Unknown Stock",
        sector: instrumentMap.get(x.instrument_id)?.sector || "—",
        broker_name: brokerMap.get(x.broker_account_id)?.broker_name || "—",
      })));

      const rawMFs = mfData || [];
      const mfIds = [...new Set(rawMFs.map((x) => x.mutual_fund_id).filter(Boolean))];
      let mutualFunds = [];
      if (mfIds.length) {
        const { data, error: fundError } = await supabase.from("mutual_funds").select("id, scheme_name, fund_house, category").in("id", mfIds);
        if (fundError) throw new Error("Mutual fund data error: " + fundError.message);
        mutualFunds = data || [];
      }
      const fundMap = new Map(mutualFunds.map((x) => [x.id, x]));
      setMfs(rawMFs.map((x) => ({
        ...x,
        scheme_name: fundMap.get(x.mutual_fund_id)?.scheme_name || "Unknown Mutual Fund",
        fund_house: fundMap.get(x.mutual_fund_id)?.fund_house || "—",
        category: fundMap.get(x.mutual_fund_id)?.category || "—",
      })));
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to load portfolio.");
      setStocks([]);
      setMfs([]);
    } finally {
      setLoading(false);
    }
  }

  if (!session) return <Login />;

  const stockInvested = stocks.reduce((s, x) => s + Number(x.invested_value || 0), 0);
  const stockValue = stocks.reduce((s, x) => s + Number(x.current_value || 0), 0);
  const mfInvested = mfs.reduce((s, x) => s + Number(x.invested_value || 0), 0);
  const mfValue = mfs.reduce((s, x) => s + Number(x.current_value || 0), 0);
  const invested = stockInvested + mfInvested;
  const value = stockValue + mfValue;
  const pnl = value - invested;
  const pnlPct = invested ? (pnl / invested) * 100 : 0;
  const instrumentIds = [...new Set(stocks.map((x) => x.instrument_id).filter(Boolean))];
  const goalPct = (value / 90000000) * 100;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">PORTFOLIO AI</div>
          <h1>Your Portfolio</h1>
          <p>Simple view. Deeper intelligence behind it.</p>
        </div>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </header>

      {error && <div className="error">{error}</div>}

      <section className="hero card">
        <div>
          <span className="label">TOTAL PORTFOLIO</span>
          <div className="heroValue">{money(value)}</div>
          <div className={pnl >= 0 ? "positive" : "negative"}>{money(pnl)} ({pnlPct.toFixed(2)}%)</div>
        </div>
        <div className="goal">
          <span className="label">₹9 CRORE GOAL</span>
          <strong>{goalPct.toFixed(2)}%</strong>
          <div className="bar"><span style={{ width: `${Math.min(goalPct, 100)}%` }} /></div>
        </div>
      </section>

      <section className="grid two">
        <div className="card">
          <span className="label">STOCKS</span>
          <h2>{money(stockValue)}</h2>
          <p>Invested {money(stockInvested)}</p>
          <div className={stockValue - stockInvested >= 0 ? "positive" : "negative"}>P/L {money(stockValue - stockInvested)}</div>
        </div>
        <div className="card">
          <span className="label">MUTUAL FUNDS</span>
          <h2>{money(mfValue)}</h2>
          <p>Invested {money(mfInvested)}</p>
          <div className={mfValue - mfInvested >= 0 ? "positive" : "negative"}>P/L {money(mfValue - mfInvested)}</div>
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <div>
          <span className="label">PORTFOLIO AI / V5.5</span>
          <h2 style={{ marginTop: 8 }}>AI Investment Intelligence</h2>
          <p>Long-term thesis drives the portfolio action. Short-term timing, valuation and risk remain separate diagnostics; severe risk is a safety override.</p>
        </div>
        {loading ? <p style={{ marginTop: 20 }}>Loading portfolio intelligence...</p> : <V55DecisionTable instrumentIds={instrumentIds} />}
      </section>

      <section className="card">
        <span className="label">STOCK HOLDINGS</span>
        <h2>{loading ? "Loading..." : `${stocks.length} positions`}</h2>
        {!loading && <div style={{ overflowX: "auto" }}><table><thead><tr><th>Company</th><th>Symbol</th><th>Broker</th><th>Qty</th><th>Invested</th><th>Value</th><th>P/L</th></tr></thead><tbody>{stocks.map((x) => <tr key={x.id}><td><strong>{x.company_name}</strong></td><td>{x.symbol}</td><td>{x.broker_name}</td><td>{Number(x.quantity || 0).toLocaleString("en-IN")}</td><td>{money(x.invested_value)}</td><td>{money(x.current_value)}</td><td className={Number(x.unrealized_pnl) >= 0 ? "positive" : "negative"}>{money(x.unrealized_pnl)}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="card">
        <span className="label">MUTUAL FUNDS</span>
        <h2>{loading ? "Loading..." : `${mfs.length} positions`}</h2>
        {!loading && <div style={{ overflowX: "auto" }}><table><thead><tr><th>Fund</th><th>Fund House</th><th>Category</th><th>Units</th><th>Avg NAV</th><th>Current NAV</th><th>Invested</th><th>Value</th><th>P/L</th></tr></thead><tbody>{mfs.map((x) => <tr key={x.id}><td><strong>{x.scheme_name}</strong></td><td>{x.fund_house}</td><td>{x.category}</td><td>{Number(x.units || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })}</td><td>₹{Number(x.average_nav || 0).toFixed(2)}</td><td>₹{Number(x.current_nav || 0).toFixed(2)}</td><td>{money(x.invested_value)}</td><td>{money(x.current_value)}</td><td className={Number(x.unrealized_pnl) >= 0 ? "positive" : "negative"}>{money(x.unrealized_pnl)}</td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
