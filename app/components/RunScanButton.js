"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const SCAN_RESULT_KEY = "portfolio-ai:last-scan-result";

export default function RunScanButton() {
  const [session, setSession] = useState(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, next) => {
        if (mounted) setSession(next);
      }
    );

    // Keep the completed-scan result visible after the dashboard reloads.
    try {
      const saved = window.sessionStorage.getItem(SCAN_RESULT_KEY);
      if (saved && mounted) {
        const parsed = JSON.parse(saved);
        if (parsed?.message) setMessage(parsed.message);
      }
    } catch (storageError) {
      console.warn("Unable to restore scan result:", storageError);
    }

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  function dismissMessage() {
    setMessage("");
    try {
      window.sessionStorage.removeItem(SCAN_RESULT_KEY);
    } catch (storageError) {
      console.warn("Unable to clear scan result:", storageError);
    }
  }

  async function runScan() {
    if (running) return;

    setRunning(true);
    setMessage("Refreshing data, intelligence and decisions…");
    setError("");

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError) {
        throw new Error(`Authentication error: ${sessionError.message}`);
      }

      const currentSession = sessionData?.session;
      setSession(currentSession);

      if (!currentSession?.access_token) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      const response = await fetch("/api/run-scan", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentSession.access_token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      });

      const contentType = response.headers.get("content-type") || "";
      let body = null;

      if (contentType.includes("application/json")) {
        body = await response.json();
      } else {
        const text = await response.text();
        body = { error: text || `HTTP ${response.status}` };
      }

      if (!response.ok || !body?.success) {
        const pipeline = body?.pipeline || {};
        const failedStage = pipeline?.failed_stage || body?.failed_stage;
        const detail = body?.error || body?.message || `HTTP ${response.status}`;
        const stageText = failedStage ? ` [stage: ${failedStage}]` : "";
        throw new Error(`${detail}${stageText}`);
      }

      const summary = body.pipeline_summary || {};
      const generated = Number(summary.alerts_generated || 0);
      const scored = summary.scored == null ? "—" : summary.scored;
      const buys = summary.buy_candidates == null ? "—" : summary.buy_candidates;
      const completedMessage =
        `Scan complete · ${scored} scored · ${buys} BUY candidates · ${generated} new alerts · decisions synced`;

      // Persist the result before reloading so the user sees it on the fresh
      // dashboard instead of losing it during navigation.
      try {
        window.sessionStorage.setItem(
          SCAN_RESULT_KEY,
          JSON.stringify({ message: completedMessage, savedAt: Date.now() })
        );
      } catch (storageError) {
        console.warn("Unable to persist scan result:", storageError);
      }

      setMessage(completedMessage);
      window.dispatchEvent(new CustomEvent("portfolio-scan-complete"));

      // Reload immediately so all dashboard data reflects the completed scan.
      // The completion notification is restored from sessionStorage after reload.
      window.setTimeout(() => window.location.reload(), 250);
    } catch (scanError) {
      console.error("Portfolio scan error:", scanError);
      setError(scanError?.message || "Portfolio scan failed.");
      setMessage("");
    } finally {
      setRunning(false);
    }
  }

  if (!session) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        top: 16,
        transform: "translateX(-50%)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        gap: 10,
        maxWidth: "calc(100% - 32px)",
      }}
    >
      <button
        onClick={runScan}
        disabled={running}
        className="primaryAction"
        style={{
          borderRadius: 999,
          boxShadow: "0 8px 24px rgba(23,32,51,.18)",
        }}
      >
        {running ? "⟳ Scanning…" : "↻ Run Portfolio Scan"}
      </button>

      {message ? (
        <span
          className="noticeBox"
          style={{
            margin: 0,
            padding: "8px 12px",
            background: "white",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {message}
          <button
            type="button"
            onClick={dismissMessage}
            aria-label="Dismiss scan result"
            style={{
              border: 0,
              background: "transparent",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
              padding: 2,
            }}
          >
            ×
          </button>
        </span>
      ) : null}

      {error ? (
        <span
          className="error"
          style={{ margin: 0, whiteSpace: "nowrap" }}
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}
