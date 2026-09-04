const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
const avg = values => { const xs = values.filter(v => v != null && Number.isFinite(v)); return xs.length ? xs.reduce((a,b) => a+b, 0) / xs.length : null; };

export const ENGINE_VERSION = "ai_scorer_v5_0";
export const WEIGHTS = Object.freeze({ longTerm: 0.50, shortTerm: 0.25, risk: 0.15, valuation: 0.10 });

const SECTOR_PROFILES = {
  BANKING: { growth: 25, profitability: 35, balanceSheet: 25, cashFlow: 0, ownership: 5, valuation: 10 },
  NBFC: { growth: 25, profitability: 30, balanceSheet: 25, cashFlow: 0, ownership: 5, valuation: 15 },
  IT: { growth: 25, profitability: 25, balanceSheet: 15, cashFlow: 15, ownership: 5, valuation: 15 },
  PHARMA: { growth: 25, profitability: 25, balanceSheet: 15, cashFlow: 15, ownership: 5, valuation: 15 },
  MANUFACTURING: { growth: 25, profitability: 25, balanceSheet: 20, cashFlow: 15, ownership: 5, valuation: 10 },
  INFRASTRUCTURE: { growth: 20, profitability: 20, balanceSheet: 25, cashFlow: 25, ownership: 5, valuation: 5 },
  DEFENCE: { growth: 25, profitability: 30, balanceSheet: 15, cashFlow: 15, ownership: 5, valuation: 10 },
  FMCG: { growth: 20, profitability: 30, balanceSheet: 15, cashFlow: 25, ownership: 5, valuation: 5 },
  ENERGY: { growth: 20, profitability: 25, balanceSheet: 25, cashFlow: 20, ownership: 5, valuation: 5 },
  CHEMICALS: { growth: 25, profitability: 25, balanceSheet: 20, cashFlow: 20, ownership: 5, valuation: 5 },
  AUTO: { growth: 20, profitability: 30, balanceSheet: 20, cashFlow: 20, ownership: 5, valuation: 5 },
  FINANCIAL_SERVICES: { growth: 25, profitability: 35, balanceSheet: 25, cashFlow: 0, ownership: 5, valuation: 10 },
  OTHER: { growth: 22, profitability: 28, balanceSheet: 20, cashFlow: 20, ownership: 5, valuation: 5 }
};

const profileFor = sector => SECTOR_PROFILES[String(sector || "OTHER").toUpperCase()] || SECTOR_PROFILES.OTHER;

function median(values) {
  const xs = values.filter(v => v != null && Number.isFinite(v)).sort((a,b) => a-b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
}

function percentile(value, peers, higherIsBetter = true) {
  const v = num(value);
  const xs = peers.map(num).filter(x => x != null).sort((a,b) => a-b);
  if (v == null || xs.length < 3) return null;
  let below = 0, equal = 0;
  for (const x of xs) { if (x < v) below++; else if (x === v) equal++; }
  const p = ((below + Math.max(0, equal - 1) / 2) / Math.max(1, xs.length - 1)) * 100;
  return clamp(higherIsBetter ? p : 100 - p);
}

// Combines relative ranking with distance from the peer median. This prevents a
// single extreme peer from defining the score while remaining adaptive to sector data.
function adaptiveMetricScore(value, peers, higherIsBetter = true) {
  const v = num(value);
  const xs = peers.map(num).filter(x => x != null);
  if (v == null || xs.length < 3) return null;
  const p = percentile(v, xs, higherIsBetter);
  const med = median(xs);
  const deviations = xs.map(x => Math.abs(x - med));
  const mad = median(deviations);
  if (p == null || med == null || mad == null || mad === 0) return p;
  const direction = higherIsBetter ? 1 : -1;
  const z = direction * (v - med) / mad;
  const robust = clamp(50 + 50 * Math.tanh(z / 2));
  return clamp(p * 0.60 + robust * 0.40);
}

function marketCapAdjustedCashFlow(f) {
  const ocf = num(f.operating_cash_flow);
  const marketCap = num(f.market_cap);
  if (ocf == null || marketCap == null || marketCap <= 0) return null;
  // Absolute OCF is not comparable across companies of different sizes.
  // OCF / market cap is used only as a relative cash-generation proxy.
  return (ocf / marketCap) * 100;
}

function growth(f, peers) {
  const sales = adaptiveMetricScore(f.sales_growth, peers.map(x => x.sales_growth), true);
  const profit = adaptiveMetricScore(f.profit_growth, peers.map(x => x.profit_growth), true);
  // Profit growth is noisier than revenue growth. A weak profit year should not
  // erase a structurally healthy revenue trend when profitability is assessed separately.
  if (sales != null && profit != null) return sales * 0.65 + profit * 0.35;
  return sales ?? profit;
}

function profitability(f, peers, sector) {
  if (sector === "BANKING" || sector === "NBFC" || sector === "FINANCIAL_SERVICES") {
    return adaptiveMetricScore(f.roe, peers.map(x => x.roe), true);
  }
  return avg([
    adaptiveMetricScore(f.roe, peers.map(x => x.roe), true),
    adaptiveMetricScore(f.roce, peers.map(x => x.roce), true)
  ]);
}

function balanceSheet(f, peers, sector) {
  if (sector === "BANKING" || sector === "NBFC" || sector === "FINANCIAL_SERVICES") {
    // Banking-specific asset quality/capital metrics are not present in the current schema.
    // Do not substitute unrelated metrics.
    return null;
  }
  return adaptiveMetricScore(f.debt_to_equity, peers.map(x => x.debt_to_equity), false);
}

function cashFlow(f, peers, sector) {
  if (sector === "BANKING" || sector === "NBFC" || sector === "FINANCIAL_SERVICES") return null;
  const value = marketCapAdjustedCashFlow(f);
  const peerValues = peers.map(marketCapAdjustedCashFlow);
  return adaptiveMetricScore(value, peerValues, true);
}

function ownership(f) {
  // Ownership percentage itself is not a universal quality measure.
  // Only pledged promoter shares provide a directly interpretable risk signal here.
  const pledge = num(f.promoter_pledge);
  return pledge == null ? 50 : clamp(100 - pledge * 2);
}

function valuation(f, peers) {
  const pe = num(f.pe_ratio);
  const pb = num(f.pb_ratio);
  const pePeers = peers.map(x => x.pe_ratio).map(num).filter(x => x != null && x > 0);
  const pbPeers = peers.map(x => x.pb_ratio).map(num).filter(x => x != null && x > 0);
  const parts = [];
  if (pe != null && pe > 0 && pePeers.length >= 3) parts.push({ score: adaptiveMetricScore(pe, pePeers, false), weight: 65 });
  if (pb != null && pb > 0 && pbPeers.length >= 3) parts.push({ score: adaptiveMetricScore(pb, pbPeers, false), weight: 35 });
  return parts.length ? parts.reduce((s,x) => s + x.score * x.weight, 0) / parts.reduce((s,x) => s+x.weight, 0) : null;
}

function longTerm(f, peers, sector) {
  const p = profileFor(sector);
  const factors = [
    ["Growth quality", growth(f, peers), p.growth],
    ["Profitability / capital efficiency", profitability(f, peers, sector), p.profitability],
    ["Balance-sheet resilience", balanceSheet(f, peers, sector), p.balanceSheet],
    ["Cash-flow quality", cashFlow(f, peers, sector), p.cashFlow],
    ["Ownership risk", ownership(f), p.ownership],
    ["Valuation context", valuation(f, peers), p.valuation]
  ].filter(x => x[2] > 0);

  const available = factors.filter(x => x[1] != null);
  const score = available.length ? available.reduce((s,x) => s + x[1] * x[2], 0) / available.reduce((s,x) => s+x[2], 0) : null;
  const unavailable = factors.filter(x => x[1] == null).map(x => x[0]);
  return {
    score,
    factors: available.map(([name,score,weight]) => ({ name, score: Math.round(score*10)/10, weight })),
    unavailable
  };
}

function shortTerm(technical, regime) {
  if (!technical?.available) return { score: null, factors: [], unavailable: ["Technical market data"] };
  const trendMap = { STRONG_UPTREND: 100, UPTREND: 80, SIDEWAYS: 55, DOWNTREND: 35, STRONG_DOWNTREND: 10 };
  const trend = trendMap[technical.trend] ?? 50;
  const rsi = num(technical.momentum?.rsi14);
  const rsiScore = rsi == null ? null : (rsi >= 50 && rsi <= 70 ? 80 : rsi > 70 ? 60 : rsi >= 40 ? 55 : 30);
  const oneMonth = num(technical.momentum?.one_month);
  const threeMonth = num(technical.momentum?.three_month);
  const momentum = avg([oneMonth == null ? null : clamp(50 + oneMonth * 4), threeMonth == null ? null : clamp(50 + threeMonth * 2)]);
  const volumeRatio = num(technical.volatility?.volume_ratio_20d);
  const volume = volumeRatio == null ? null : clamp(50 + (volumeRatio - 1) * 30);
  const annualVol = num(technical.volatility?.annualized_20d_pct);
  const volatility = annualVol == null ? null : clamp(100 - annualVol * 1.4);
  const regimeScore = regime === "BULL" ? 85 : regime === "BEAR" ? 30 : 60;
  const factors = [["Trend / moving-average alignment",trend,30],["Momentum",momentum,25],["RSI",rsiScore,10],["Volume",volume,10],["Volatility",volatility,10],["Market regime",regimeScore,15]].filter(x => x[1] != null);
  return { score: factors.reduce((s,x) => s+x[1]*x[2], 0) / factors.reduce((s,x) => s+x[2], 0), factors: factors.map(([name,score,weight]) => ({name,score:Math.round(score*10)/10,weight})), unavailable: [] };
}

function risk(f, peers, technical, sector) {
  const factors = [];
  if (sector === "BANKING" || sector === "NBFC" || sector === "FINANCIAL_SERVICES") {
    factors.push(["Profitability resilience", adaptiveMetricScore(f.roe, peers.map(x => x.roe), true), 45]);
    // Asset quality, capital adequacy and provisioning are unavailable and are reported separately.
  } else {
    factors.push(["Leverage resilience", adaptiveMetricScore(f.debt_to_equity, peers.map(x => x.debt_to_equity), false), 40]);
    factors.push(["Cash-flow resilience", cashFlow(f, peers, sector), 30]);
    factors.push(["Profitability resilience", profitability(f, peers, sector), 20]);
  }
  const vol = technical?.available ? num(technical.volatility?.annualized_20d_pct) : null;
  factors.push(["Market volatility", vol == null ? null : clamp(100 - vol * 1.5), sector === "BANKING" || sector === "NBFC" || sector === "FINANCIAL_SERVICES" ? 55 : 10]);
  const available = factors.filter(x => x[1] != null);
  return {
    score: available.length ? available.reduce((s,x)=>s+x[1]*x[2],0)/available.reduce((s,x)=>s+x[2],0) : null,
    factors: available.map(([name,score,weight])=>({name,score:Math.round(score*10)/10,weight})),
    unavailable: (sector === "BANKING" || sector === "NBFC" || sector === "FINANCIAL_SERVICES") ? ["Asset quality / capital adequacy"] : []
  };
}

export function calculateFinalScore({ longTermScore, shortTermScore, riskScore, valuationScore }) {
  const values = { longTermScore, shortTermScore, riskScore, valuationScore };
  if (Object.values(values).some(v => v == null)) return null;
  return Math.round((longTermScore * WEIGHTS.longTerm + shortTermScore * WEIGHTS.shortTerm + riskScore * WEIGHTS.risk + valuationScore * WEIGHTS.valuation) * 10) / 10;
}

export function scoreStock({ fundamentals, peers = [], technical, regime = "NEUTRAL", sector = "OTHER" }) {
  const f = fundamentals || {};
  const lt = longTerm(f, peers, sector);
  const st = shortTerm(technical, regime);
  const riskScore = risk(f, peers, technical, sector);
  const val = valuation(f, peers);
  const final = calculateFinalScore({ longTermScore: lt.score, shortTermScore: st.score, riskScore: riskScore.score, valuationScore: val });

  const completenessFields = ["sales_growth","profit_growth","roe","roce","debt_to_equity","operating_cash_flow","promoter_holding","promoter_pledge","fii_holding","dii_holding","pe_ratio","pb_ratio"];
  const fundamentalCoverage = completenessFields.filter(k => num(f[k]) != null).length / completenessFields.length;
  const technicalCoverage = technical?.available ? 1 : 0;
  const completeness = Math.round((fundamentalCoverage * 0.70 + technicalCoverage * 0.30) * 1000) / 10;

  const missingCore = [...new Set([...lt.unavailable, ...st.unavailable, ...(riskScore.unavailable || []), ...(val == null ? ["Valuation"] : [])])];
  const factorAvailability = [lt.score, st.score, riskScore.score, val].filter(x => x != null).length / 4;
  const confidence = Math.round(clamp(completeness * 0.70 + factorAvailability * 100 * 0.30));

  return {
    engine_version: ENGINE_VERSION,
    long_term_score: lt.score == null ? null : Math.round(lt.score*10)/10,
    short_term_score: st.score == null ? null : Math.round(st.score*10)/10,
    risk_score: riskScore.score == null ? null : Math.round(riskScore.score*10)/10,
    valuation_score: val == null ? null : Math.round(val*10)/10,
    final_ai_score: final,
    weights: WEIGHTS,
    confidence,
    data_completeness: completeness,
    unavailable_factors: missingCore,
    factor_breakdown: { long_term: lt.factors, short_term: st.factors, risk: riskScore.factors },
    eligibility: {
      all_core_scores_available: final != null,
      missing_factors: missingCore,
      confidence,
      data_completeness: completeness
    }
  };
}
