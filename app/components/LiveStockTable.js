"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

function normalise(value) {
  return String(value || "").trim().toUpperCase();
}

export default function LiveStockTable() {
  const [session, setSession] = useState(null);
  const [quotes, setQuotes] = useState(new Map());
  const [updatedAt, setUpdatedAt] = useState(null);
  const [status, setStatus] = useState("Loading live prices…");
  const observerRef = useRef(null);

  const applyToTable = useCallback(() => {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, span, div"));
    const heading = headings.find((node) => normalise(node.textContent) === "STOCK HOLDINGS");
    const section = heading?.closest("section");
    const table = section?.querySelector("table");

    if (!table) return false;

    table.style.minWidth = "980px";
    table.style.width = "100%";

    const headRow = table.querySelector("thead tr");
    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    if (!headRow) return false;

    const headers = Array.from(headRow.children);
    const headerTexts = headers.map((cell) => normalise(cell.textContent));
    const symbolIndex = headerTexts.findIndex((text) => text === "SYMBOL");

    if (symbolIndex < 0) return false;

    if (!headRow.querySelector('[data-live-ltp-header="true"]')) {
      const ltpHeader = document.createElement("th");
      ltpHeader.textContent = "LTP";
      ltpHeader.dataset.liveLtpHeader = "true";
      headRow.insertBefore(ltpHeader, headRow.children[symbolIndex + 1] || null);

      const dayHeader = document.createElement("th");
      dayHeader.textContent = "DAY";
      dayHeader.dataset.liveDayHeader = "true";
      headRow.insertBefore(dayHeader, headRow.children[symbolIndex + 2] || null);
    }

    const currentHeaders = Array.from(headRow.children);
    const ltpIndex = currentHeaders.findIndex((cell) => cell.dataset.liveLtpHeader === "true");
    const dayIndex = currentHeaders.findIndex((cell) => cell.dataset.liveDayHeader === "true");

    bodyRows.forEach((row) => {
      if (row.querySelector('[data-live-ltp-cell="true"]')) return;
      const cells = Array.from(row.children);
      const symbol = normalise(cells[symbolIndex]?.textContent);
      const quote = quotes.get(symbol);

      const ltpCell = document.createElement("td");
      ltpCell.dataset.liveLtpCell = "true";
      ltpCell.style.whiteSpace = "nowrap";
      ltpCell.innerHTML = quote?.lastPrice == null
        ? '<span style="opacity:.55">—</span>'
        : `<strong>${money(quote.lastPrice)}</strong>`;
      row.insertBefore(ltpCell, row.children[ltpIndex] || null);

      const dayCell = document.createElement("td");
      dayCell.dataset.liveDayCell = "true";
      dayCell.style.whiteSpace = "nowrap";
      if (quote?.changePct == null) {
        dayCell.innerHTML = '<span style="opacity:.55">—</span>';
      } else {
        const sign = quote.changePct >= 0 ? "+" : "";
        dayCell.textContent = `${sign}${quote.changePct.toFixed(2)}%`;
        dayCell.className = quote.changePct >= 0 ? "positive" : "negative";
      }
      row.insertBefore(dayCell, row.children[dayIndex] || null);
    });

    return true;
  }, [quotes]);

  const refresh = useCallback(async (activeSession) => {
    if (!activeSession?.access_token) return;

    try {
      setStatus("Refreshing live prices…");

      const response = await fetch("/api/market-quotes", {
        headers: {
          Authorization: `Bearer ${activeSession.access_token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.success) {
        throw new Error(body?.error || `Market quote request failed (${response.status})`);
      }

      const nextQuotes = new Map();
      Object.entries(body.quotes || {}).forEach(([key, quote]) => {
        const token = quote?.instrument_token || key.replace(/^NSE_EQ:/, "NSE_EQ|");
        const isin = token.includes("|") ? token.split("|").slice(1).join("|") : token;
        const lastPrice = Number(quote?.last_price);
        const previousClose = Number(quote?.cp);
        const change = Number.isFinite(lastPrice) && Number.isFinite(previousClose)
          ? lastPrice - previousClose
          : null;
        const changePct = Number.isFinite(lastPrice) && Number.isFinite(previousClose) && previousClose !== 0
          ? (change / previousClose) * 100
          : null;
        nextQuotes.set(normalise(isin), {
          lastPrice: Number.isFinite(lastPrice) ? lastPrice : null,
          changePct,
        });
      });

      // The holdings table displays the instrument symbol/ISIN. Quotes are keyed by ISIN.
      const { data: holdings } = await supabase
        .from("holdings")
        .select("instrument_id")
        .eq("user_id", activeSession.user.id);
      const ids = [...new Set((holdings || []).map((x) => x.instrument_id).filter(Boolean))];
      if (ids.length) {
        const { data: instruments } = await supabase
          .from("instruments")
          .select("id,symbol")
          .in("id", ids);
        (instruments || []).forEach((instrument) => {
          const quote = nextQuotes.get(normalise(instrument.symbol));
          if (quote) nextQuotes.set(normalise(instrument.symbol), quote);
        });
      }

      setQuotes(nextQuotes);
      setUpdatedAt(body.fetched_at || new Date().toISOString());
      setStatus(`${nextQuotes.size} live quotes · updates every 30s`);
    } catch (error) {
      console.error("Live stock table error:", error);
      setStatus(error?.message || "Live prices unavailable");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session || null);
      if (data.session) refresh(data.session);
    });
    return () => { mounted = false; };
  }, [refresh]);

  useEffect(() => {
    if (!session) return undefined;
    const timer = window.setInterval(() => refresh(session), 30000);
    return () => window.clearInterval(timer);
  }, [session, refresh]);

  useEffect(() => {
    applyToTable();

    const observer = new MutationObserver(() => applyToTable());
    observer.observe(document.body, { childList: true, subtree: true });
    observerRef.current = observer;

    return () => observer.disconnect();
  }, [applyToTable]);

  useEffect(() => {
    applyToTable();
  }, [quotes, applyToTable]);

  if (!session) return null;

  return updatedAt ? (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        left: 16,
        bottom: 16,
        zIndex: 40,
        padding: "7px 11px",
        borderRadius: 999,
        background: "rgba(255,255,255,.94)",
        border: "1px solid #e2e8f0",
        boxShadow: "0 8px 24px rgba(15,23,42,.10)",
        fontSize: 11,
        color: "#475569",
      }}
      title={`Last live quote request: ${new Date(updatedAt).toLocaleTimeString("en-IN")}`}
    >
      ● {status}
    </div>
  ) : null;
}
