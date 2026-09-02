"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export default function DecisionDock() {
  const [session, setSession] = useState(null);
  const [portfolio, setPortfolio] = useState(null);

  async function load(token) {
    try {
      const r = await fetch("/api/decision-engine", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await r.json();
      if (r.ok && body.success) setPortfolio(body);
    } catch {}
  }

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) load(data.session.access_token);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      if (next) load(next.access_token); else setPortfolio(null);
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  if (!session || !portfolio) return null;
  const top = portfolio.decisions?.[0];
  if (!top) return null;

  return (
    <div style={{ position: "fixed", left: 20, bottom: 20, zIndex: 49, maxWidth: 310 }}>
      <Link href="/dashboard" style={{ textDecoration: "none" }}>
        <div className="card" style={{ padding: "12px 16px", boxShadow: "0 10px 30px rgba(0,0,0,.16)" }}>
          <div className="eyebrow">DECISION ENGINE</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
            <strong>{top.company_name}</strong>
            <span className={`badge ${["EXIT","REDUCE","HOLD & TRIM"].includes(top.decision) ? "reduce" : top.decision === "BUY MORE" ? "hold" : "watch"}`}>{top.decision}</span>
          </div>
          <div className="muted" style={{ marginTop: 5 }}>{top.reason} · {top.confidence}% confidence</div>
        </div>
      </Link>
    </div>
  );
}
