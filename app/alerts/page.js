"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

function Badge({ children }) {
  const s = String(children || "INFO").toUpperCase();
  const cls = s === "CRITICAL" ? "reduce" : s === "WARNING" ? "watch" : "hold";
  return <span className={`badge ${cls}`}>{children}</span>;
}

export default function AlertsPage() {
  const [session, setSession] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL");

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data: s }) => {
      if (!mounted) return;
      setSession(s.session);
      if (s.session) load(s.session.access_token); else setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      if (next) load(next.access_token); else { setData(null); setLoading(false); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  async function load(token) {
    setLoading(true); setError("");
    try {
      const r = await fetch("/api/portfolio-alerts", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await r.json();
      if (!r.ok || !body.success) throw new Error(body.error || "Unable to load alerts.");
      setData(body);
    } catch (e) { setError(e.message || "Unable to load alerts."); }
    finally { setLoading(false); }
  }

  const visible = useMemo(() => {
    const alerts = data?.alerts || [];
    return filter === "ALL" ? alerts : alerts.filter(a => a.severity === filter);
  }, [data, filter]);

  if (!session) return <main className="shell"><section className="card"><h1>Sign in required</h1><p>Please sign in on the main dashboard first.</p><Link href="/">Go to Dashboard</Link></section></main>;

  return <main className="shell">
    <header className="topbar"><div><div className="eyebrow">PORTFOLIO AI / ALERTS</div><h1>Portfolio Alerts</h1><p>Current issues and signals detected from your portfolio.</p></div><div style={{display:"flex",gap:8}}><Link href="/health"><button>Health</button></Link><Link href="/command-center"><button>Command Center</button></Link></div></header>
    {error && <div className="error">{error}</div>}
    {loading ? <section className="card"><h2>Scanning portfolio…</h2></section> : <>
      <section className="grid three">
        <div className="card"><span className="label">CRITICAL</span><h2>{data?.summary?.critical || 0}</h2></div>
        <div className="card"><span className="label">WARNING</span><h2>{data?.summary?.warning || 0}</h2></div>
        <div className="card"><span className="label">INFO</span><h2>{data?.summary?.info || 0}</h2></div>
      </section>
      <section className="card"><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{["ALL","CRITICAL","WARNING","INFO"].map(x => <button key={x} onClick={() => setFilter(x)} className={filter === x ? "primary" : ""}>{x}</button>)}</div></section>
      <section className="card"><div style={{display:"grid",gap:12}}>{visible.length ? visible.map((a, i) => <article key={`${a.type}-${a.instrument_id || "portfolio"}-${i}`} className="metricBox"><div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}><div><Badge>{a.severity}</Badge><strong style={{marginLeft:8}}>{a.title}</strong></div><small>{new Date(a.created_at).toLocaleString("en-IN")}</small></div><p>{a.message}</p>{a.instrument_id ? <Link href={`/stock?instrument_id=${encodeURIComponent(a.instrument_id)}`}>Open stock intelligence →</Link> : null}</article>) : <div className="metricBox"><strong>No alerts in this filter.</strong><p>Your current portfolio scan has nothing to report here.</p></div>}</div></section>
      <section className="card"><h2>Daily Portfolio Brief</h2><p>Today’s scan found <strong>{data?.summary?.alert_count || 0}</strong> active alerts. Start with critical items, then warnings; information items are lower urgency.</p><p className="muted">Generated {data?.generated_at ? new Date(data.generated_at).toLocaleString("en-IN") : "—"}. This page currently generates alerts on demand.</p></section>
    </>}
  </main>;
}
