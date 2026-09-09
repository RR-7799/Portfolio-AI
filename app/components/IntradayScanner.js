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
      <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: "rgba(127,127,127,.08)" }}>
        <span className="label">EXPECTED TRADE WINDOW</span>
        <div style={{ marginTop: 5, fontWeight: 600 }}>10–30 min</div>
        <small style={{ opacity: 0.7 }}>Timeline is measured after the signal. Actual outcome is tracked separately.</small>
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
      <div style={{ marginTop: 16, fontWeight: 600 }}>Timeline accuracy</div>
      <div className="grid two" style={{ marginTop: 8, gap: 10 }}>
        {(analytics.horizons || []).map(h => (
          <div key={h.minutes} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{h.minutes} min</span><strong>{h.accuracy == null ? "—" : `${h.accuracy}%`} <small style={{ opacity: .6 }}>({h.samples})</small></strong>
          </div>
        ))}
      </div>
      {analytics.best_horizon && <div style={{ marginTop: 12, fontSize: 13 }}>Best observed horizon: <strong>{analytics.best_horizon.minutes} min</strong> at <strong>{analytics.best_horizon.accuracy}%</strong> accuracy.</div>}
      <div style={{ marginTop: 14, fontWeight: 600 }}>Trade duration performance</div>
      <div className="grid two" style={{ marginTop: 8, gap: 10 }}>
        {(analytics.duration_buckets || []).map(b => (
          <div key={b.bucket} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{b.bucket}</span><strong>{b.win_rate == null ? "—" : `${b.win_rate}%`} <small style={{ opacity: .6 }}>({b.trades})</small></strong>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, opacity: 0.65, fontSize: 12 }}>Timeline accuracy is directional accuracy at the stated horizon, not a guaranteed profit rate. Duration performance is based only on closed trades. No horizon is treated as proven until enough observations exist.</div>
    </div>
  );
}

function RejectionFunnel({ funnel }) {
  if (!funnel) return null;
  const rows = [
    ["Universe", funnel.universe],
    ["Quote eligible", funnel.quote_eligible],
    ["Candle / metrics eligible", funnel.candle_eligible],
    ["Setup eligible", funnel.setup_eligible],
    ["VWAP rejected", funnel.vwap_rejected],
    ["Chase rejected", funnel.chase_rejected],
    ["Guard passed", funnel.guard_passed],
    ["Score ≥ 78", funnel.score_passed],
    ["Score rejected", funnel.score_rejected],
    ["Risk passed", funnel.risk_passed],
    ["Risk rejected", funnel.risk_rejected],
  ];
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="label">SCAN DIAGNOSTICS</div>
      <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>Why stocks were rejected — no trading thresholds are changed by this diagnostic.</div>
      <div style={{ marginTop: 12, display: "grid", gap: 7 }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13 }}>
            <span>{label}</span><strong>{Number(value || 0).toLocaleString("en-IN")}</strong>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, marginTop: 4, paddingTop: 8, borderTop: "1px solid rgba(127,127,127,.18)" }}>
          <span>Candle/API failures</span><strong>{Number(funnel.candle_failures || 0).toLocaleString("en-IN")}</strong>
        </div>
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
  const getToken = useCallback(async () => { const { data } = await supabase.auth.getSession(); if (!data.session?.access_token) throw new Error("Authentication required."); return data.session.access_token; }, []);
  const loadAnalytics = useCallback(async (token) => { try { const response = await fetch("/api/intraday-analytics", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }); const body = await response.json(); if (response.ok && body.success) setAnalytics(body); } catch {} }, []);
  const evaluateOutcomes = useCallback(async (token) => { try { const response = await fetch("/api/intraday-signal-outcomes/evaluate", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }); const body = await response.json(); if (response.ok && body.success) { await loadAnalytics(token); setHistoryRefreshKey(key => key + 1); } } catch {} }, [loadAnalytics]);
  const scan = useCallback(async () => { setStatus("loading"); setMessage(""); try { const token = await getToken(); const response = await fetch("/api/intraday-scanner", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }); const body = await response.json(); if (!response.ok || !body.success) throw new Error(body.error || "Intraday scan failed."); setSignals(body.signals || []); setMeta(body); setStatus("ready"); await evaluateOutcomes(token); setHistoryRefreshKey(key => key + 1); } catch (error) { setStatus("error"); setMessage(error.message || "Intraday scan failed."); } }, [getToken, evaluateOutcomes]);
  useEffect(() => { scan(); }, [scan]);
  useEffect(() => { let timer; const refreshOutcomes = async () => { try { const token = await getToken(); await evaluateOutcomes(token); } catch {} }; refreshOutcomes(); timer = window.setInterval(refreshOutcomes, 5 * 60 * 1000); return () => window.clearInterval(timer); }, [getToken, evaluateOutcomes]);
  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div><span className="label">INTRADAY AI / LIVE</span><h2 style={{ marginTop: 8 }}>Nifty 500 Scanner</h2><p>Scans the official NIFTY 500 universe. Only higher-quality setups are shown; the machine prefers controlled risk over maximum signal count.</p></div>
        <button className="primary" onClick={scan} disabled={status === "loading"}>{status === "loading" ? "Scanning…" : "Scan now"}</button>
      </div>
      {status === "loading" && <p style={{ marginTop: 18 }}>Scanning the NIFTY 500 universe and applying risk gates…</p>}
      {status === "error" && <div className="error" style={{ marginTop: 18 }}>{message}</div>}
      {status === "ready" && meta && <div style={{ marginTop: 18, opacity: 0.75, fontSize: 13 }}>Universe {meta.universe_count} · Quotes {meta.quote_count} · Signals {meta.signal_count} · Risk cap {meta.risk_policy?.max_risk_pct ?? 0.6}% · {meta.elapsed_ms}ms</div>}
      {status === "ready" && meta?.rejection_funnel && <RejectionFunnel funnel={{ ...meta.rejection_funnel, candle_failures: meta.candle_failures }} />}
      <TrackRecord analytics={analytics} />
      <IntradayPaperTradeHistory getToken={getToken} refreshKey={historyRefreshKey} />
      {status === "ready" && signals.length === 0 && <p style={{ marginTop: 18 }}>No qualifying low-risk intraday setup right now. That is a valid result — the machine does not force a trade.</p>}
      {signals.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 20 }}>{signals.map((signal) => <SignalCard key={`${signal.instrument_key}-${signal.direction}-${signal.setup}`} signal={signal} />)}</div>}
      <p style={{ marginTop: 18, fontSize: 12, opacity: 0.6 }}>Research tool only. Entry, stop and targets are model-generated levels, not guaranteed execution prices or investment advice.</p>
    </section>
  );
}
