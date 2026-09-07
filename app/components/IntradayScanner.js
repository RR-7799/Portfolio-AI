"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const money = (n) => Number.isFinite(Number(n)) ? `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
const pct = (n) => Number.isFinite(Number(n)) ? `${Number(n).toFixed(2)}%` : "—";

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
        <div><span className="label">SCORE</span><div>{Number(signal.setup_score || 0).toFixed(1)}</div></div>
        <div><span className="label">STOP</span><div>{money(signal.stop_loss)}</div></div>
        <div><span className="label">TARGET 1</span><div>{money(signal.target_1)}</div></div>
        <div><span className="label">TARGET 2</span><div>{money(signal.target_2)}</div></div>
        <div><span className="label">R:R</span><div>1:{signal.risk_reward || 2}</div></div>
      </div>
      <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 12, opacity: 0.8, fontSize: 13 }}>
        <span>Change {pct(signal.change_pct)}</span>
        <span>RV {Number(signal.relative_volume || 0).toFixed(2)}x</span>
        <span>VWAP {money(signal.vwap)}</span>
      </div>
    </div>
  );
}

export default function IntradayScanner() {
  const [signals, setSignals] = useState([]);
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [meta, setMeta] = useState(null);

  const scan = useCallback(async () => {
    setStatus("loading");
    setMessage("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Authentication required.");
      const response = await fetch("/api/intraday-scanner", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || "Intraday scan failed.");
      setSignals(body.signals || []);
      setMeta(body);
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "Intraday scan failed.");
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  return (
    <section className="card" style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="label">INTRADAY AI / LIVE</span>
          <h2 style={{ marginTop: 8 }}>Nifty LargeMidcap 250 Scanner</h2>
          <p>Scans the full 250-stock universe and ranks the strongest live volume, VWAP and momentum setups.</p>
        </div>
        <button className="primary" onClick={scan} disabled={status === "loading"}>
          {status === "loading" ? "Scanning…" : "Scan now"}
        </button>
      </div>

      {status === "loading" && <p style={{ marginTop: 18 }}>Scanning 250 constituents…</p>}
      {status === "error" && <div className="error" style={{ marginTop: 18 }}>{message}</div>}
      {status === "ready" && meta && (
        <div style={{ marginTop: 18, opacity: 0.75, fontSize: 13 }}>
          Universe {meta.universe_count} · Quotes {meta.quote_count} · Candidates scanned {meta.intraday_candidates_scanned} · Signals {meta.signal_count} · {meta.elapsed_ms}ms
        </div>
      )}

      {status === "ready" && signals.length === 0 && <p style={{ marginTop: 18 }}>No qualifying intraday setup right now. That is a valid result.</p>}
      {signals.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14, marginTop: 20 }}>
          {signals.map((signal) => <SignalCard key={`${signal.instrument_key}-${signal.direction}`} signal={signal} />)}
        </div>
      )}
      <p style={{ marginTop: 18, fontSize: 12, opacity: 0.6 }}>Research tool only. Signals are not guaranteed returns or investment advice.</p>
    </section>
  );
}
