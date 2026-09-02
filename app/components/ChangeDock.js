"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export default function ChangeDock() {
  const [session, setSession] = useState(null);
  const [change, setChange] = useState(null);

  async function load(token) {
    try {
      const r = await fetch("/api/portfolio-history?days=30", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await r.json();
      if (!r.ok || !body.success || !body.history?.length) return;
      const history = body.history;
      const latest = history[history.length - 1];
      const previous = history.length > 1 ? history[history.length - 2] : null;
      if (!previous) return;
      setChange({
        health: Number(latest.health_score ?? 0),
        healthDelta: Number(latest.health_score ?? 0) - Number(previous.health_score ?? 0),
        score: latest.average_ai_score == null ? null : Number(latest.average_ai_score),
        scoreDelta: latest.average_ai_score == null || previous.average_ai_score == null ? null : Number(latest.average_ai_score) - Number(previous.average_ai_score),
        riskDelta: Number(latest.high_risk_capital_pct ?? 0) - Number(previous.high_risk_capital_pct ?? 0),
      });
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
      if (next) load(next.access_token); else setChange(null);
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  if (!session || !change) return null;

  const healthDown = change.healthDelta < -3;
  const riskUp = change.riskDelta >= 5;
  const scoreDown = change.scoreDelta !== null && change.scoreDelta <= -3;
  const concern = healthDown || riskUp || scoreDown;
  const direction = concern ? "Portfolio risk changed" : "Portfolio improved";
  const badge = concern ? "watch" : "hold";

  return (
    <div style={{ position: "fixed", right: 20, bottom: 112, zIndex: 49 }}>
      <Link href="/history" style={{ textDecoration: "none" }}>
        <div className="card" style={{ padding: "12px 16px", minWidth: 230, boxShadow: "0 10px 30px rgba(0,0,0,.12)" }}>
          <div className="eyebrow">SINCE LAST SCAN</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <strong>{direction}</strong>
            <span className={`badge ${badge}`}>{change.health.toFixed(0)} health</span>
          </div>
          <div className="muted" style={{ marginTop: 5 }}>
            {change.scoreDelta === null ? "Score history unavailable" : `AI score ${change.scoreDelta >= 0 ? "+" : ""}${change.scoreDelta.toFixed(1)}`}
            {riskUp ? ` · high-risk capital +${change.riskDelta.toFixed(1)}%` : ""}
          </div>
        </div>
      </Link>
    </div>
  );
}
