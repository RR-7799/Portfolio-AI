"use client";

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const n = (v) => (v == null ? null : Number(v));
const score = (v) => (v == null ? "—" : Number(v).toFixed(1));

function decision({ lt, risk, confidence, completeness, freshness }) {
  const reliable =
    confidence != null &&
    confidence >= 60 &&
    completeness != null &&
    completeness >= 60 &&
    !["STALE", "VERY_STALE", "MISSING"].includes(
      String(freshness || "").toUpperCase()
    );

  if (!reliable || lt == null) return "WATCH";
  if (risk != null && risk < 25) return "EXIT";
  if (lt < 50) return "EXIT";
  if (lt < 70) return "REDUCE";
  if (lt < 80) return "HOLD";
  return "BUY";
}

function tone(action) {
  if (action === "BUY") return "positive";
  if (action === "EXIT") return "negative";
  return "";
}

export default function V55DecisionTable({ instrumentIds = [], compact = false }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function load() {
      if (!instrumentIds.length) {
        setRows([]);
        return;
      }

      setLoading(true);
      setError("");

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session) {
          if (mounted) setRows([]);
          return;
        }

        const [{ data: instruments, error: instrumentError }, { data: scores, error: scoreError }] =
          await Promise.all([
            supabase
              .from("instruments")
              .select("id, company_name, symbol, sector")
              .in("id", instrumentIds),
            supabase
              .from("ai_scores")
              .select(
                "instrument_id,long_term_score,short_term_score,risk_score,valuation_score,final_ai_score,confidence,data_completeness,freshness_status,action,rating,score_version,score_breakdown,calculated_at"
              )
              .eq("user_id", session.user.id)
              .eq("score_version", "ai_scorer_v5_5")
              .in("instrument_id", instrumentIds)
              .order("calculated_at", { ascending: false }),
          ]);

        if (instrumentError) throw instrumentError;
        if (scoreError) throw scoreError;

        const instrumentMap = new Map(
          (instruments || []).map((x) => [x.id, x])
        );
        const latest = new Map();
        (scores || []).forEach((x) => {
          if (!latest.has(x.instrument_id)) latest.set(x.instrument_id, x);
        });

        const next = instrumentIds
          .map((id) => {
            const i = instrumentMap.get(id) || {};
            const q = latest.get(id) || {};
            const freshness =
              q.freshness_status ||
              q.score_breakdown?.freshness?.status ||
              "MISSING";
            const row = {
              id,
              company_name: i.company_name || "Unknown",
              symbol: i.symbol || "—",
              sector: i.sector || "—",
              lt: n(q.long_term_score),
              st: n(q.short_term_score),
              risk: n(q.risk_score),
              valuation: n(q.valuation_score),
              final: n(q.final_ai_score),
              confidence: n(q.confidence),
              completeness: n(q.data_completeness),
              freshness,
              rating: q.rating || null,
            };
            row.action = decision(row);
            return row;
          })
          .sort((a, b) => (b.lt ?? -1) - (a.lt ?? -1));

        if (mounted) setRows(next);
      } catch (err) {
        console.error("V5.5 decision table error:", err);
        if (mounted) {
          setRows([]);
          setError("V5.5 intelligence could not be loaded.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [instrumentIds.join(",")]);

  if (loading) return <p style={{ marginTop: 20 }}>Loading V5.5 intelligence...</p>;
  if (error) return <p style={{ marginTop: 20, opacity: 0.7 }}>{error}</p>;
  if (!rows.length) return null;

  return (
    <div style={{ marginTop: 20, overflowX: "auto" }}>
      {!compact && (
        <p style={{ marginBottom: 12, opacity: 0.7 }}>
          V5.5 Long-Term Score drives the thesis action. Short-term, valuation and risk are diagnostics; severe risk is a safety override. Final AI Score is diagnostic only.
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Company</th>
            <th>Long-term</th>
            <th>Short-term</th>
            {!compact && <th>Risk</th>}
            {!compact && <th>Valuation</th>}
            {!compact && <th>Final AI</th>}
            <th>Confidence</th>
            <th>Data</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.company_name}</strong>
                <div style={{ fontSize: 12, opacity: 0.65, marginTop: 3 }}>
                  {r.symbol}{r.sector !== "—" ? ` · ${r.sector}` : ""}
                </div>
              </td>
              <td><strong>{score(r.lt)}</strong></td>
              <td>{score(r.st)}</td>
              {!compact && <td>{score(r.risk)}</td>}
              {!compact && <td>{score(r.valuation)}</td>}
              {!compact && <td>{score(r.final)}{r.rating ? <div style={{ fontSize: 11, opacity: 0.65 }}>{r.rating}</div> : null}</td>}
              <td>{r.confidence == null ? "—" : `${r.confidence.toFixed(0)}%`}</td>
              <td>{r.completeness == null ? "—" : `${r.completeness.toFixed(0)}%`}<div style={{ fontSize: 11, opacity: 0.65 }}>{r.freshness}</div></td>
              <td><strong className={tone(r.action)}>{r.action}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
