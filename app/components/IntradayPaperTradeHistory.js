"use client";

import { useCallback, useEffect, useState } from "react";

const money = (n) => Number.isFinite(Number(n)) ? `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
const rText = (n) => Number.isFinite(Number(n)) ? `${Number(n) >= 0 ? "+" : ""}${Number(n).toFixed(2)}R` : "—";
const timeText = (value) => value ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function outcomeLabel(row) {
  if (row.status === "OPEN") return "OPEN";
  if (row.outcome === "TARGET_2") return "T2 HIT";
  if (row.outcome === "TARGET_1") return "T1 HIT";
  if (row.outcome === "STOP_LOSS") return "STOP LOSS";
  if (row.outcome === "EXPIRED") return "EXPIRED";
  return row.outcome || row.status || "—";
}

export default function IntradayPaperTradeHistory({ getToken, refreshKey = 0 }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const response = await fetch("/api/intraday-paper-trades", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json();
      if (response.ok && body.success) setData(body);
    } catch {}
  }, [getToken]);

  useEffect(() => { load(); }, [load, refreshKey]);

  if (!data) return null;
  const summary = data.summary || {};

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <div className="label">PAPER TRADE TRACKER</div>
      <div className="grid two" style={{ marginTop: 12, gap: 10 }}>
        <div><span className="label">OPEN</span><div>{summary.open || 0}</div></div>
        <div><span className="label">CLOSED</span><div>{summary.closed || 0}</div></div>
        <div><span className="label">NET R</span><div>{rText(summary.net_r)}</div></div>
        <div><span className="label">WIN RATE</span><div>{summary.win_rate == null ? "—" : `${summary.win_rate}%`}</div></div>
      </div>

      <div style={{ marginTop: 18, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760, fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", opacity: 0.65 }}>
              {['Time','Stock','Side','Entry','Current / Exit','Result','R','Duration'].map(label => <th key={label} style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {(data.trades || []).map(row => (
              <tr key={row.id} style={{ borderTop: "1px solid rgba(127,127,127,.16)" }}>
                <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>{timeText(row.signal_at)}</td>
                <td style={{ padding: "9px 10px" }}><strong>{row.trading_symbol || "—"}</strong><div style={{ opacity: .55, fontSize: 11 }}>{row.setup || "—"}</div></td>
                <td style={{ padding: "9px 10px" }}>{row.direction || "—"}</td>
                <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>{money(row.entry_price)}</td>
                <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>{money(row.current_price)}</td>
                <td style={{ padding: "9px 10px", whiteSpace: "nowrap", fontWeight: 600 }}>{outcomeLabel(row)}</td>
                <td style={{ padding: "9px 10px", whiteSpace: "nowrap", fontWeight: 600 }}>{rText(row.realized_r)}</td>
                <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>{Number.isFinite(Number(row.duration_minutes)) ? `${Number(row.duration_minutes).toFixed(1)}m` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 12, opacity: .6, fontSize: 12 }}>This ledger is persistent. A stock disappearing from the next scan does not delete or invalidate its earlier paper trade; the outcome engine continues tracking each open signal independently.</div>
    </div>
  );
}
