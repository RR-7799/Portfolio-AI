"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const money = (n) => Number.isFinite(Number(n)) ? `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
const pct = (n) => Number.isFinite(Number(n)) ? `${Number(n).toFixed(2)}%` : "—";

function SignalCard({ signal }) {
  const long = signal.direction === "LONG";
  return (
    <div className="card" style={{ minWidth: 280 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div><strong style={{ fontSize: 18 }}>{signal.trading_symbol}</strong><div style={{ opacity: 0.7, marginTop: 4 }}>{signal.company_name || "—"}</div></div>
        <strong className={long ? "positive" : "negative"}>{signal.direction}</strong>
      </div>
      <div style={{ marginTop: 16, fontWeight: 600 }}>{signal.setup}</div>
      <div className="grid two" style={{ marginTop: 14, gap: 10 }}>
        <div><span className="label">ENTRY</span><div>{money(signal.entry_price)}</div></div>
        <div><span className="label">SETUP SCORE</span><div>{Number(signal.setup_score || 0).toFixed(1)}</div></div>
        <div><span className="label">STOP / RISK</span><div>{money(signal.stop_loss)} · {pct(signal.risk_pct)}</div></div>
        <div><span className="label">TARGET 1</span><div>{money(signal.target_1)} <small>+2R</small></div></div>
        <div><span className="label">TARGET 2</span><div>{money(signal.target_2)} <small>+3R</small></div></div>
        <div><span className="label">R:R</span><div>1:2 / 1:3</div></div>
      </div>
      <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 12, opacity: 0.8, fontSize: 13 }}>
        <span>Change {pct(signal.change_pct)}</span><span>RV {Number(signal.relative_volume || 0).toFixed(2)}x</span><span>VWAP {money(signal.vwap)}</span>
      </div>
    </div>
  );
}

function TrackRecord({ analytics }) {
  if (!analytics) return null;
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="label">LIVE TRACK RECORD</div>
      <div className="grid two" style={{ marginTop: 12, gap: 10 }}>
        <div><span className="label">CLOSED</span><div>{analytics.closed_trades}</div></div>
        <div><span className="label">WIN RATE</span><div>{pct(analytics.win_rate)}</div></div>
        <div><span className="label">AVG R</span><div>{Number(analytics.avg_r || 0).toFixed(2)}R</div></div>
        <div><span className="label">PROFIT FACTOR</span><div>{analytics.profit_factor == null ? "—" : Number(analytics.profit_factor).toFixed(2)}</div></div>
      </div>
      <div style={{ marginTop: 12, opacity: 0.65, fontSize: 12 }}>Only closed signals count. No performance claim is made until a meaningful sample exists.</div>
    </div>
  );
}

export default function IntradayScanner() {
  const [signals, setSignals] = useState([]);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [meta, setMeta] = useState(null);
  const [analytics, setAnalytics] = useState(null);

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

  const scan = useCallback(async () => {
    setStatus("loading"); setMessage("");
    try {
      const token = await getToken();
      const response = await fetch("/api/intraday-scanner", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Intraday scan failed.");
      setSignals(body.signals || []); setMeta(body); setStatus("ready");
      await loadAnalytics(token);
    } catch (error) { setStatus("error"); setMessage(error.message || "Intraday scan failed."); }
  }, [getToken, loadAnalytics]);

  useEffect(() => { scan(); }, [scan]);

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="label">INTRADAY AI / LIVE</span>
          <h2 style={{ marginTop: 8 }}>Nifty LargeMidcap 250 Scanner</h2>
          <p>Only higher-quality setups are shown. The machine prefers controlled risk over maximum signal count.</p>
        </div>
        <button className="primary" onClick={scan} disabled={status === "loading"}>{status === "loading" ? "Scanning…" : "Scan now"}</button>
      </div>
      {status === "loading" && <p style={{ marginTop: 18 }}>Scanning 250 constituents and applying risk gates…</p>}
      {status === "error" && <div className="error" style={{ marginTop: 18 }}>{message}</div>}
      {status === "ready" && meta && (
        <div style={{ marginTop: 18, opacity: 0.75, fontSize: 13 }}>
          Universe {meta.universe_count} · Quotes {meta.quote_count} · Signals {meta.signal_count} · Risk cap {meta.risk_policy?.max_risk_pct ?? 0.8}% · {meta.elapsed_ms}ms
        </div>
      )}
      <TrackRecord analytics={analytics} />
      {status === "ready" && signals.length === 0 && <p style={{ marginTop: 18 }}>No qualifying low-risk intraday setup right now. That is a valid result — the machine does not force a trade.</p>}
      {signals.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 20 }}>{signals.map((signal) => <SignalCard key={`${signal.instrument_key}-${signal.direction}-${signal.setup}`} signal={signal} />)}</div>}
      <p style={{ marginTop: 18, fontSize: 12, opacity: 0.6 }}>Research tool only. Entry, stop and targets are model-generated levels, not guaranteed execution prices or investment advice.</p>
    </section>
  );
}
