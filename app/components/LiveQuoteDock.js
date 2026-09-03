"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const money = (value) =>
  Number(value || 0).toLocaleString("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const pct = (value) =>
  `${Number(value || 0) >= 0 ? "+" : ""}${Number(value || 0).toFixed(2)}%`;

export default function LiveQuoteDock() {
  const [session, setSession] = useState(null);
  const [rows, setRows] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);

  const loadQuotes = useCallback(async (activeSession) => {
    if (!activeSession?.access_token) return;

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/market-quotes", {
        headers: {
          Authorization: `Bearer ${activeSession.access_token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        const detail = body?.errors?.length ? ` ${body.errors.join("; ")}` : "";
        throw new Error(body?.error || `Market quote request failed (${response.status}).${detail}`);
      }

      const quoteRows = Object.values(body.quotes || {}).map((quote) => ({
        id: String(quote.instrument_id),
        symbol: quote.symbol || String(quote.instrument_id),
        companyName: quote.company_name || "Unknown stock",
        lastPrice: Number.isFinite(Number(quote.last_price)) ? Number(quote.last_price) : null,
        previousClose: Number.isFinite(Number(quote.previous_close)) ? Number(quote.previous_close) : null,
        change: Number.isFinite(Number(quote.change)) ? Number(quote.change) : null,
        changePct: Number.isFinite(Number(quote.change_pct)) ? Number(quote.change_pct) : null,
      }));

      quoteRows.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
      setRows(quoteRows);
      setUpdatedAt(body.fetched_at || new Date().toISOString());

      if (body.skipped > 0 && !quoteRows.length) {
        setError(`No NSE equity quotes returned. ${body.skipped} portfolio instruments were skipped because they do not have a supported NSE equity ISIN.`);
      }
    } catch (quoteError) {
      console.error("Live quote error:", quoteError);
      setRows([]);
      setError(quoteError?.message || "Unable to load live prices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      if (data.session) loadQuotes(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next || null);
      if (next) loadQuotes(next);
      else setRows([]);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, [loadQuotes]);

  useEffect(() => {
    if (!session) return undefined;
    const timer = window.setInterval(() => loadQuotes(session), 30000);
    return () => window.clearInterval(timer);
  }, [session, loadQuotes]);

  const positive = useMemo(() => rows.filter((x) => Number(x.changePct) >= 0).length, [rows]);

  if (!session || !open) return null;

  return (
    <div style={{
      position: "fixed",
      right: 16,
      bottom: 16,
      width: "min(520px, calc(100vw - 32px))",
      maxHeight: "58vh",
      zIndex: 55,
      background: "white",
      border: "1px solid #e2e8f0",
      borderRadius: 16,
      boxShadow: "0 16px 40px rgba(15,23,42,.16)",
      overflow: "hidden",
    }}>
      <div style={{ padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, borderBottom: "1px solid #e2e8f0" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: ".12em", fontWeight: 800, color: "#64748b" }}>LIVE MARKET</div>
          <strong style={{ fontSize: 17 }}>Portfolio LTP</strong>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {loading ? "Refreshing…" : `${rows.length} quotes · ${positive} positive · refreshes every 30s`}
          </div>
        </div>
        <button onClick={() => setOpen(false)} aria-label="Close live market prices" style={{ border: 0, background: "#f1f5f9", borderRadius: 999, cursor: "pointer", width: 30, height: 30 }}>×</button>
      </div>

      {error ? (
        <div style={{ padding: 14, fontSize: 13, color: "#b91c1c" }}>{error}</div>
      ) : (
        <div style={{ overflow: "auto", maxHeight: "calc(58vh - 78px)" }}>
          <table style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Stock</th>
                <th>LTP</th>
                <th>Day</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.symbol}</strong>
                    <div style={{ fontSize: 11, opacity: .6, marginTop: 2 }}>{row.companyName}</div>
                  </td>
                  <td><strong>{row.lastPrice == null ? "—" : money(row.lastPrice)}</strong></td>
                  <td className={Number(row.changePct) >= 0 ? "positive" : "negative"}>
                    {row.change == null ? "—" : `${row.change >= 0 ? "+" : ""}${row.change.toFixed(2)}`}
                    <div style={{ fontSize: 11 }}>{row.changePct == null ? "" : pct(row.changePct)}</div>
                  </td>
                </tr>
              ))}
              {!rows.length && !loading && !error && (
                <tr><td colSpan="3" style={{ padding: 18, textAlign: "center", opacity: .6 }}>No LTP quotes returned.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {updatedAt && !error && (
        <div style={{ padding: "7px 14px", borderTop: "1px solid #e2e8f0", fontSize: 10, color: "#64748b" }}>
          Last quote request: {new Date(updatedAt).toLocaleTimeString("en-IN")}
        </div>
      )}
    </div>
  );
}
