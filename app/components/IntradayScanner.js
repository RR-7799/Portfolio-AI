"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import IntradayPaperTradeHistory from "./IntradayPaperTradeHistory";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const money = (n) => Number.isFinite(Number(n)) ? `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
const pct = (n) => Number.isFinite(Number(n)) ? `${Number(n).toFixed(1)}%` : "—";

function SignalCard({ signal }) {
  const long = signal.direction === "LONG";
  return (
    <div className="card" style={{ minWidth: 280 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <strong style={{ fontSize: 18 }}>{signal.trading_symbol}</strong>
          <div style={{ opacity: 0.7, marginTop: 4 }}>{signal.company_name || "—"}</div>
        </div>
        <strong className={long ? "positive" : "negative"}>{signal.direction}</strong>
      </div>
      <div style={{ marginTop: 16, fontWeight: 600 }}>{signal.setup}</div>
      <div className="grid two" style={{ marginTop: 14, gap: 10 }}>
        <div><span className="label">ENTRY</span><div>{money(signal.entry_price)}</div></div>
        <div><span className="label">STOP LOSS</span><div>{money(signal.stop_loss)}</div></div>
        <div><span className="label">TARGET 1</span><div>{money(signal.target_1)} <small>+2R</small></div></div>
        <div><span className="label">TARGET 2</span><div>{money(signal.target_2)} <small>+3R</small></div></div>
      </div>
      <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: "rgba(127,127,127,.08)" }}>
        <span className="label">EXPECTED TRADE WINDOW</span>
        <div style={{ marginTop: 5, fontWeight: 600 }}>10–30 min</div>
      </div>
    </div>
  );
}

function TrackRecord({ analytics }) {
  if (!analytics) return null;
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="label">TRACK RECORD</div>
      <div className="grid two" style={{ marginTop: 12, gap: 10 }}>
        <div><span className="label">CLOSED</span><div>{analytics.closed_trades}</div></div>
        <div><span className="label">WIN RATE</span><div>{pct(analytics.win_rate)}</div></div>
        <div><span className="label">AVG R</span><div>{Number(analytics.avg_r || 0).toFixed(2)}R</div></div>
      </div>
    </div>
  );
}

export default function IntradayScanner() {
  const [signals, setSignals] = useState([]);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [meta, setMeta] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error("Authentication required.");
    return data.session.access_token;
  }, []);

  const loadAnalytics = useCallback(async (token) => {
    try {
      const response = await fetch("/api/intraday-analytics", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json();
      if (response.ok && body.success) setAnalytics(body);
    } catch {}
  }, []);

  const evaluateOutcomes = useCallback(async (token) => {
    try {
      const response = await fetch("/api/intraday-signal-outcomes/evaluate", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json();
      if (response.ok && body.success) {
        await loadAnalytics(token);
        setHistoryRefreshKey(key => key + 1);
      }
    } catch {}
  }, [loadAnalytics]);

  const scan = useCallback(async () => {
    setStatus("loading");
    setMessage("");
    try {
      const token = await getToken();
      const response = await fetch("/api/intraday-scanner", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Intraday scan failed.");
      setSignals(body.signals || []);
      setMeta(body);
      setStatus("ready");
      await evaluateOutcomes(token);
      setHistoryRefreshKey(key => key + 1);
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "Intraday scan failed.");
    }
  }, [getToken, evaluateOutcomes]);

  useEffect(() => { scan(); }, [scan]);

  useEffect(() => {
    let timer;
    const refreshOutcomes = async () => {
      try {
        const token = await getToken();
        await evaluateOutcomes(token);
      } catch {}
    };
    refreshOutcomes();
    timer = window.setInterval(refreshOutcomes, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [getToken, evaluateOutcomes]);

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="label">INTRADAY AI / LIVE</span>
          <h2 style={{ marginTop: 8 }}>Nifty 500 Scanner</h2>
          <p>Only the strongest intraday opportunities are shown. No trade is forced.</p>
        </div>
        <button className="primary" onClick={scan} disabled={status === "loading"}>
          {status === "loading" ? "Scanning…" : "Scan now"}
        </button>
      </div>

      {status === "loading" && <p style={{ marginTop: 18 }}>Finding the best opportunities…</p>}
      {status === "error" && <div className="error" style={{ marginTop: 18 }}>{message}</div>}
      {status === "ready" && meta && (
        <div style={{ marginTop: 18, fontWeight: 600 }}>
          {meta.signal_count > 0 ? `${meta.signal_count} trade${meta.signal_count === 1 ? "" : "s"} found` : "No trade recommended right now"}
        </div>
      )}

      <TrackRecord analytics={analytics} />
      <IntradayPaperTradeHistory getToken={getToken} refreshKey={historyRefreshKey} />

      {status === "ready" && signals.length === 0 && (
        <p style={{ marginTop: 18 }}>Market conditions do not currently meet the quality required for a trade.</p>
      )}

      {signals.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 20 }}>
          {signals.map((signal) => <SignalCard key={`${signal.instrument_key}-${signal.direction}-${signal.setup}`} signal={signal} />)}
        </div>
      )}

      <p style={{ marginTop: 18, fontSize: 12, opacity: 0.6 }}>Paper trading / research only. Model-generated levels are not guaranteed execution prices or investment advice.</p>
    </section>
  );
}
