"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export default function DecisionDock() {
  const [session, setSession] = useState(null);
  const [portfolio, setPortfolio] = useState(null);

  async function loadFresh() {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        setPortfolio(null);
        return;
      }
      setSession(data.session);
      const r = await fetch(`/api/decision-engine?ts=${Date.now()}`, {
        headers: { Authorization: `Bearer ${data.session.access_token}`, Accept: "application/json" },
        cache: "no-store",
      });
      const body = await r.json();
      if (r.ok && body.success) setPortfolio(body);
      else setPortfolio(null);
    } catch {
      setPortfolio(null);
    }
  }

  useEffect(() => {
    let mounted = true;
    loadFresh();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      if (next) loadFresh(); else setPortfolio(null);
    });

    const onScanComplete = () => {
      if (mounted) loadFresh();
    };
    window.addEventListener("portfolio-scan-complete", onScanComplete);

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
      window.removeEventListener("portfolio-scan-complete", onScanComplete);
    };
  }, []);

  if (!session || !portfolio) return null;
  const top = portfolio.decisions?.[0];
  if (!top) return null;

  const badgeClass = ["EXIT", "REDUCE", "HOLD & TRIM"].includes(top.decision)
    ? "reduce"
    : ["BUY", "ACCUMULATE", "BUY MORE", "HOLD"].includes(top.decision)
      ? "hold"
      : "watch";

  return (
    <div style={{ position: "fixed", left: 20, bottom: 20, zIndex: 49, maxWidth: 310 }}>
      <Link href="/dashboard" style={{ textDecoration: "none" }}>
        <div className="card" style={{ padding: "12px 16px", boxShadow: "0 10px 30px rgba(0,0,0,.16)" }}>
          <div className="eyebrow">DECISION ENGINE V2</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
            <strong>{top.company_name}</strong>
            <span className={`badge ${badgeClass}`}>{top.decision}</span>
          </div>
          <div className="muted" style={{ marginTop: 5 }}>
            {top.reason} · {top.confidence}% confidence
          </div>
        </div>
      </Link>
    </div>
  );
}
