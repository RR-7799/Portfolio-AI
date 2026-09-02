"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

export default function AlertDock() {
  const [session, setSession] = useState(null);
  const [summary, setSummary] = useState(null);

  async function load(token) {
    try {
      const r = await fetch("/api/portfolio-alerts", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await r.json();
      if (r.ok && body.success) setSummary(body.summary);
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
      if (next) load(next.access_token); else setSummary(null);
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  if (!session || !summary) return null;

  const unread = Number(summary.unread || 0);
  const critical = Number(summary.critical || 0);
  const warning = Number(summary.warning || 0);

  return (
    <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 50 }}>
      <Link href="/alerts" style={{ textDecoration: "none" }}>
        <div className="card" style={{ padding: "12px 16px", minWidth: 190, boxShadow: "0 10px 30px rgba(0,0,0,.16)" }}>
          <div className="eyebrow">PORTFOLIO AI</div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "center" }}>
            <strong>Alerts</strong>
            <span className={`badge ${critical ? "reduce" : warning ? "watch" : "hold"}`}>{unread} unread</span>
          </div>
          {(critical || warning) ? <div className="muted" style={{ marginTop: 5 }}>{critical} critical · {warning} warning</div> : <div className="muted" style={{ marginTop: 5 }}>No urgent alerts</div>}
        </div>
      </Link>
    </div>
  );
}
