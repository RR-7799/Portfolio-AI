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
    const heading = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, span, div")
    ).find((node) => normalise(node.textContent) === "STOCK HOLDINGS");

    const section = heading?.closest("section");
    const table = section?.querySelector("table");
    if (!table) return false;

    table.style.minWidth = "980px";
    table.style.width = "100%";

    const headRow = table.querySelector("thead tr");
    if (!headRow) return false;

    const headers = Array.from(headRow.children);
    const companyHeader = headers.find(
      (cell) => normalise(cell.textContent) === "COMPANY"
    );
    const symbolHeader = headers.find(
      (cell) => normalise(cell.textContent) === "SYMBOL"
    );

    if (!companyHeader) return false;

    // Remove Symbol completely: the requested table is
    // Company | LTP | Broker | Qty | Invested | Value | P/L | AI
    if (symbolHeader) {
      const symbolIndex = headers.indexOf(symbolHeader);
      symbolHeader.remove();
      table.querySelectorAll("tbody tr").forEach((row) => {
        row.children[symbolIndex]?.remove();
      });
    }

    const refreshedHeaders = Array.from(headRow.children);
    const refreshedCompanyHeader = refreshedHeaders.find(
      (cell) => normalise(cell.textContent) === "COMPANY"
    );

    if (!refreshedCompanyHeader) return false;

    let ltpHeader = headRow.querySelector('[data-live-ltp-header="true"]');
    if (!ltpHeader) {
      ltpHeader = document.createElement("th");
      ltpHeader.textContent = "LTP";
      ltpHeader.dataset.liveLtpHeader = "true";
      refreshedCompanyHeader.insertAdjacentElement("afterend", ltpHeader);
    }

    const companyIndex = Array.from(headRow.children).indexOf(
      refreshedCompanyHeader
    );
    const ltpIndex = companyIndex + 1;

    table.querySelectorAll("tbody tr").forEach((row) => {
      const cells = Array.from(row.children);
      const companyCell = cells[companyIndex];
      if (!companyCell) return;

      // The quote API returns the instrument symbol (ISIN), so keep it
      // hidden in a data attribute instead of displaying a Symbol column.
      const symbol = normalise(
        companyCell.getAttribute("data-instrument-symbol") ||
          companyCell.dataset.instrumentSymbol
      );

      let ltpCell = row.querySelector('[data-live-ltp-cell="true"]');
      if (!ltpCell) {
        ltpCell = document.createElement("td");
        ltpCell.dataset.liveLtpCell = "true";
        ltpCell.style.whiteSpace = "nowrap";
        companyCell.insertAdjacentElement("afterend", ltpCell);
      }

      const quote = symbol ? quotes.get(symbol) : null;
      ltpCell.innerHTML = quote?.lastPrice == null
        ? '<span style="opacity:.55">—</span>'
        : `<strong>${money(quote.lastPrice)}</strong>`;

      // Keep the inserted cell immediately after Company even if React
      // re-renders the table.
      const currentIndex = Array.from(row.children).indexOf(ltpCell);
      if (currentIndex !== ltpIndex) {
        companyCell.insertAdjacentElement("afterend", ltpCell);
      }
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
        throw new Error(
          body?.error || `Market quote request failed (${response.status})`
        );
      }

      const nextQuotes = new Map();

      Object.values(body.quotes || {}).forEach((quote) => {
        const isin = normalise(quote?.symbol);
        const lastPrice = Number(quote?.last_price);

        if (!isin) return;

        nextQuotes.set(isin, {
          lastPrice: Number.isFinite(lastPrice) ? lastPrice : null,
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
      const activeSession = data.session || null;
      setSession(activeSession);
      if (activeSession) refresh(activeSession);
    });

    return () => {
      mounted = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!session) return undefined;

    const timer = window.setInterval(() => refresh(session), 30000);
    return () => window.clearInterval(timer);
  }, [session, refresh]);

  useEffect(() => {
    let frame = null;

    const scheduleApply = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        applyToTable();
      });
    };

    scheduleApply();

    const observer = new MutationObserver(scheduleApply);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [applyToTable]);

  // React dashboard remains the source of truth for holdings.
  // This component only decorates the existing table with live LTP.
  return null;
}
