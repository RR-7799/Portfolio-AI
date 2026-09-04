import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPSTOX_BASE_URL = "https://api.upstox.com/v2";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGETS = [
  { label: "INDUSIND BANK", isin: "INE095A01012" },
  { label: "HDFC BANK", isin: "INE040A01034" },
  { label: "STATE BANK OF INDIA", isin: "INE062A01020" },
];

function admin() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("Supabase service configuration is missing.");
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function authorized(request) {
  const secret = process.env.PIPELINE_SECRET || "";
  const header = request.headers.get("x-pipeline-secret") || "";
  const auth = request.headers.get("authorization") || "";
  if (secret && (header === secret || auth === `Bearer ${secret}`)) return true;
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!bearer) return false;
  try {
    const { data, error } = await admin().auth.getUser(bearer);
    return !error && !!data?.user;
  } catch {
    return false;
  }
}

async function fetchUpstox(path) {
  const token = process.env.UPSTOX_ANALYTICS_TOKEN;
  if (!token) throw new Error("Missing UPSTOX_ANALYTICS_TOKEN");
  const response = await fetch(`${UPSTOX_BASE_URL}${path}`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const body = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, body };
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function collectLabels(node, out = []) {
  if (Array.isArray(node)) {
    node.forEach(item => collectLabels(item, out));
    return out;
  }
  if (!node || typeof node !== "object") return out;
  if (node.particular != null) out.push(String(node.particular));
  for (const [key, value] of Object.entries(node)) if (key !== "history") collectLabels(value, out);
  return out;
}

function extractHistory(node, wanted, out = []) {
  if (Array.isArray(node)) {
    node.forEach(item => extractHistory(item, wanted, out));
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const label = normalize(node.particular);
  if (label && wanted.some(term => label === normalize(term) || label.includes(normalize(term)))) {
    if (Array.isArray(node.history)) out.push({ particular: node.particular, history: node.history });
  }
  for (const [key, value] of Object.entries(node)) if (key !== "history") extractHistory(value, wanted, out);
  return out;
}

const BANKING_TERMS = [
  "Gross Non-Performing Assets", "GNPA", "Gross NPA", "Net Non-Performing Assets", "NNPA", "Net NPA",
  "Capital Adequacy Ratio", "Capital Adequacy", "CRAR", "Tier 1 Capital Ratio", "CET1",
  "Provision Coverage Ratio", "Provisioning Coverage Ratio", "Credit Growth", "Advances",
  "Gross Advances", "Net Advances", "Deposits", "Net Interest Income", "NIM", "Slippages",
  "Provision for Bad and Doubtful Debts", "Provisions and Contingencies"
];

export async function GET(request) {
  if (!(await authorized(request))) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const results = [];
    for (const target of TARGETS) {
      const response = await fetchUpstox(`/fundamentals/${encodeURIComponent(target.isin)}/balance-sheet?type=consolidated&fs=true`);
      const fullStatement = response.body?.data?.full_statement || [];
      results.push({
        company: target.label,
        isin: target.isin,
        ok: response.ok,
        status: response.status,
        periods: response.body?.data?.history?.map(x => x.period) || [],
        available_line_items: [...new Set(collectLabels(fullStatement))],
        candidate_banking_items: extractHistory(fullStatement, BANKING_TERMS),
      });
    }
    return NextResponse.json({ success: true, dry_run: true, writes_performed: false, purpose: "Discover verified banking-specific fields exposed by Upstox before changing the database or scorer.", results });
  } catch (error) {
    return NextResponse.json({ success: false, error: error?.message || "Banking data discovery failed." }, { status: 500 });
  }
}
