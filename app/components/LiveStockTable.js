"use client";

import { useCallback, useEffect, useState } from "react";
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

  const applyToTable = useCallback(() => {
    const heading = Array.from(document.querySelectorAll("h1, h2, h3, h4, span, div"))
      .find((node) => normalise(node.textContent) === "STOCK HOLDINGS");
    const section = heading?.closest("section");
    const table = section?.querySelector("table");

    if (!table) return false;

    table.style.minWidth = "980px";
    table.style.width = "100%";

    const headRow = table.querySelector("thead tr");
    if (!headRow) return false;

    let symbolHeader = Array.from(headRow.children)
      .find((cell) => normalise(cell.textContent) === "SYMBOL");
    if (!symbolHeader) return false;

    if (!headRow.querySelector('[data-live-ltp-header="true"]')) {
      const ltpHeader = document.createElement("th");
      ltpHeader.textContent = "LTP";
      ltpHeader.dataset.liveLtpHeader = "true";
      symbolHeader.insertAdjacentElement("afterend", ltpHeader);

      const dayHeader = document.createElement("th");
      dayHeader.textContent = "DAY";
      dayHeader.dataset.liveDayHeader = "true";
      ltpHeader.insertAdjacentElement("afterend", dayHeader);
    }

    const symbolIndex = Array.from(headRow.children).indexOf(symbolHeader);
    const rows = Array.from(table.querySelectorAll("tbody tr"));

    rows.forEach((row) => {
      const cells = Array.from(row.children);
      const symbolCell = cells[symbolIndex];
      if (!symbolCell) return;

      const symbol = normalise(symbolCell.textContent);
      const quote = quotes.get(symbol);
      const ltpText = quote?.lastPrice == null ? "—" : money(quote.lastPrice);
      const dayText = quote?.changePct == null
        ? "—"
        : `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`;

      let ltpCell = row.querySelector('[data-live-ltp-cell="true"]');
      if (!ltpCell) {
        ltpCell = document.createElement("td");
        ltpCell.dataset.liveLtpCell = "true";
        ltpCell.style.whiteSpace = "nowrap";
        symbolCell.insertAdjacentElement("afterend", ltpCell);
      }
      ltpCell.innerHTML = quote?.lastPrice == null
        ? '<span style="opacity:.55">—</span>'
        : `<strong>${ltpText}</strong>`;

      let dayCell = row.querySelector('[data-live-day-cell="true"]');
      if (!dayCell) {
        dayCell = document.createElement("td");
        dayCell.dataset.liveDayCell = "true";
        dayCell.style.whiteSpace = "nowrap";
        ltpCell.insertAdjacentElement("afterend", dayCell);
      }
      dayCell.className = quote?.changePct == null
        ? ""
        : quote.changePct >= 0 ? "positive" : "negative";
      dayCell.innerHTML = quote?.changePct == null
        ? '<span style="opacity:.55">—</span>'
        : dayText;
    });

    return true;
  }, [quotes]);

  const refresh = useCallback(async (activeSession) => {
    if (!activeSession?.access_token) return;

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
        throw new Error(body?.error || `Market quote request failed (${response.status})`);
      }

      const nextQuotes = new Map();
      Object.entries(body.quotes || {}).forEach(([key, quote]) => {
        const token = quote?.instrument_token || key.replace(/^NSE_EQ:/, "NSE_EQ|");
        const isin = token.includes("|")
          ? token.split("|").slice(1).join("|")
          : token;
        const lastPrice = Number(quote?.last_price);
        const previousClose = Number(quote?.cp);
        const changePct = Number.isFinite(lastPrice) && Number.isFinite(previousClose) && previousClose !== 0
          ? ((lastPrice - previousClose) / previousClose) * 100
          : null;

        nextQuotes.set(normalise(isin), {
          lastPrice: Number.isFinite(lastPrice) ? lastPrice : null,
          changePct,
        });
      });

      setQuotes(nextQuotes);
    } catch (error) {
      console.error("Live stock table error:", error);
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

    return () => observer.disconnect();
  }, [applyToTable]);

  return null;
}
