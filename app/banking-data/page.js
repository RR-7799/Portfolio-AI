"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

function ratioClass(name, company, sector) {
  if (company == null || sector == null || sector === 0) return "";
  const lowerIsBetter = name === "P/E" || name === "P/B" || name === "EV/EBITDA";
  const better = lowerIsBetter ? company <= sector : company >= sector;
  return better ? "ratioBetter" : "ratioWorse";
}

export default function BankingDataPage() {
  const [session, setSession] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
  }, []);

  async function run() {
    if (!session?.access_token) return;
    setLoading(true); setError(""); setData(null);
    try {
      const response = await fetch("/api/banking-data-preview", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.success) throw new Error(body?.error || `Banking discovery failed (${response.status}).`);
      setData(body);
    } catch (e) {
      setError(e?.message || "Unable to run banking discovery.");
    } finally { setLoading(false); }
  }

  if (!session) return <main className="shell"><section className="card"><h1>Sign in required</h1><p>Please sign in on the main dashboard first.</p><Link href="/">Go to Dashboard</Link></section></main>;

  return <main className="shell">
    <header className="topbar">
      <div><div className="eyebrow">PORTFOLIO AI / DATA AUDIT</div><h1>Banking Data Discovery</h1><p>Dry-run inspection of verified banking-specific fields exposed by Upstox. No database writes.</p></div>
      <div style={{display:"flex",gap:8}}><Link href="/ai"><button>AI Analysis</button></Link><button onClick={run} disabled={loading}>{loading ? "Inspecting…" : "Run Banking Audit"}</button></div>
    </header>
    {error ? <div className="error">{error}</div> : null}
    {data ? <>
      <section className="card"><div className="eyebrow">DISCOVERY RESULT</div><h2>Provider fields — do not assume unavailable metrics</h2><p>Only fields actually returned by the provider will be promoted into the banking scorer. Key Ratios also expose the provider's sector benchmark for relative analysis.</p></section>
      {(data.results || []).map(r => <section className="card" key={r.isin}>
        <div className="sectionHead"><div><h2 style={{margin:"0 0 4px"}}>{r.company}</h2><span className="muted">{r.isin}</span></div><strong>{r.ok ? "Provider OK" : `Provider issue`}</strong></div>
        <p><strong>Balance Sheet:</strong> HTTP {r.balance_sheet_status ?? "—"} &nbsp; <strong>Key Ratios:</strong> HTTP {r.key_ratios_status ?? "—"}</p>
        <p><strong>Periods:</strong> {r.periods?.length ? r.periods.join(" · ") : "None returned"}</p>
        <div className="grid two">
          <div>
            <h3>Key Ratios — company vs sector</h3>
            {r.key_ratios?.length ? <div style={{display:"grid",gap:8}}>{r.key_ratios.map((x,i) => {
              const company = x.company_numeric;
              const sector = x.sector_numeric;
              const delta = company != null && sector != null ? company - sector : null;
              return <div className={`metricBox ${ratioClass(x.name, company, sector)}`} key={`${x.name}-${i}`}>
                <strong>{x.name}</strong>
                <small>Company: {x.company_value ?? "—"} · Sector: {x.sector_value ?? "—"}{delta != null ? ` · Difference: ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}` : ""}</small>
              </div>;
            })}</div> : <p>No key ratios returned by provider.</p>}
          </div>
          <div>
            <h3>Available balance-sheet line items</h3>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{(r.available_line_items || []).map((x,i)=><span className="badge" key={`${x}-${i}`}>{x}</span>)}</div>
            <h3 style={{marginTop:20}}>Banking-specific balance-sheet candidates</h3>
            {r.candidate_banking_items?.length ? r.candidate_banking_items.map((x,i)=><div key={`${x.particular}-${i}`} className="metricBox" style={{marginBottom:8}}><strong>{x.particular}</strong><small>{Array.isArray(x.history) ? x.history.map(h => `${h.period}: ${h.value ?? "—"}`).join(" · ") : "History unavailable"}</small></div>) : <p>No requested banking-specific line item was exposed in the detailed statement.</p>}
          </div>
        </div>
      </section>)}
    </> : <section className="card"><h2>Ready</h2><p>Run the audit to inspect the actual Upstox payload for HDFC Bank, State Bank of India and IndusInd Bank.</p></section>}
  </main>;
}
