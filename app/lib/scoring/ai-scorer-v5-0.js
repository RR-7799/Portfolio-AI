const clamp = (v, min = 0, max = 100) => Math.max(min, Math.min(max, v));
const num = v => Number.isFinite(Number(v)) ? Number(v) : null;
const avg = values => { const xs = values.filter(v => v != null && Number.isFinite(v)); return xs.length ? xs.reduce((a,b) => a+b, 0) / xs.length : null; };

export const ENGINE_VERSION = "ai_scorer_v5_0";
export const WEIGHTS = Object.freeze({ longTerm: 0.50, shortTerm: 0.25, risk: 0.15, valuation: 0.10 });

const SECTOR_PROFILES = {
  BANKING: { growth: 20, profitability: 30, balanceSheet: 30, cashFlow: 5, ownership: 5, valuation: 10 },
  NBFC: { growth: 20, profitability: 25, balanceSheet: 30, cashFlow: 10, ownership: 5, valuation: 10 },
  IT: { growth: 25, profitability: 25, balanceSheet: 10, cashFlow: 15, ownership: 10, valuation: 15 },
  PHARMA: { growth: 25, profitability: 25, balanceSheet: 15, cashFlow: 15, ownership: 5, valuation: 15 },
  MANUFACTURING: { growth: 20, profitability: 25, balanceSheet: 20, cashFlow: 15, ownership: 5, valuation: 15 },
  INFRASTRUCTURE: { growth: 20, profitability: 20, balanceSheet: 25, cashFlow: 20, ownership: 5, valuation: 10 },
  DEFENCE: { growth: 25, profitability: 25, balanceSheet: 15, cashFlow: 15, ownership: 5, valuation: 15 },
  FMCG: { growth: 20, profitability: 30, balanceSheet: 15, cashFlow: 20, ownership: 5, valuation: 10 },
  ENERGY: { growth: 20, profitability: 25, balanceSheet: 25, cashFlow: 15, ownership: 5, valuation: 10 },
  CHEMICALS: { growth: 25, profitability: 25, balanceSheet: 20, cashFlow: 15, ownership: 5, valuation: 10 },
  AUTO: { growth: 20, profitability: 25, balanceSheet: 20, cashFlow: 15, ownership: 5, valuation: 15 },
  FINANCIAL_SERVICES: { growth: 20, profitability: 30, balanceSheet: 25, cashFlow: 10, ownership: 5, valuation: 10 },
  OTHER: { growth: 22, profitability: 25, balanceSheet: 18, cashFlow: 15, ownership: 5, valuation: 15 }
};

const profileFor = sector => SECTOR_PROFILES[String(sector || "OTHER").toUpperCase()] || SECTOR_PROFILES.OTHER;

function percentile(value, peers, higherIsBetter = true) {
  const v = num(value);
  const xs = peers.map(num).filter(x => x != null).sort((a,b) => a-b);
  if (v == null || xs.length < 3) return null;
  let below = 0, equal = 0;
  for (const x of xs) { if (x < v) below++; else if (x === v) equal++; }
  const p = ((below + Math.max(0, equal - 1) / 2) / Math.max(1, xs.length - 1)) * 100;
  return clamp(higherIsBetter ? p : 100 - p);
}

function metricScore(value, peers, higherIsBetter = true, neutral = 50) {
  const p = percentile(value, peers, higherIsBetter);
  return p == null ? (value == null ? null : neutral) : p;
}

function growth(f, peers) {
  return avg([
    metricScore(f.sales_growth, peers.map(x => x.sales_growth), true),
    metricScore(f.profit_growth, peers.map(x => x.profit_growth), true)
  ]);
}

function profitability(f, peers, sector) {
  if (sector === "BANKING" || sector === "NBFC") return metricScore(f.roe, peers.map(x => x.roe), true);
  return avg([
    metricScore(f.roe, peers.map(x => x.roe), true),
    metricScore(f.roce, peers.map(x => x.roce), true)
  ]);
}

function balanceSheet(f, peers, sector) {
  if (sector === "BANKING" || sector === "NBFC") {
    // GNPA/NNPA/capital adequacy/credit growth/provisioning are not present in the
    // current fundamentals schema. Never substitute ROE for balance-sheet quality.
    return null;
  }
  return metricScore(f.debt_to_equity, peers.map(x => x.debt_to_equity), false);
}

function cashFlow(f, peers) {
  return metricScore(f.operating_cash_flow, peers.map(x => x.operating_cash_flow), true);
}

function ownership(f) {
  const parts = [];
  const pledge = num(f.promoter_pledge);
  const promoter = num(f.promoter_holding);
  if (pledge != null) parts.push(clamp(100 - pledge * 2));
  if (promoter != null) parts.push(clamp(promoter));
  if (!parts.length) return null;
  return avg(parts);
}

function valuation(f, peers) {
  const pe = num(f.pe_ratio);
  const pb = num(f.pb_ratio);
  const pePeers = peers.map(x => x.pe_ratio).map(num).filter(x => x != null && x > 0);
  const pbPeers = peers.map(x => x.pb_ratio).map(num).filter(x => x != null && x > 0);
  const parts = [];
  if (pe != null && pe > 0) parts.push({ score: metricScore(pe, pePeers, false), weight: 65 });
  if (pb != null && pb > 0) parts.push({ score: metricScore(pb, pbPeers, false), weight: 35 });
  return parts.length ? parts.reduce((s,x) => s + x.score * x.weight, 0) / parts.reduce((s,x) => s+x.weight, 0) : null;
}

function longTerm(f, peers, sector) {
  const p = profileFor(sector);
  const factors = [
    ["Growth", growth(f, peers), p.growth],
    ["Profitability / capital efficiency", profitability(f, peers, sector), p.profitability],
    ["Balance sheet", balanceSheet(f, peers, sector), p.balanceSheet],
    ["Operating cash flow", cashFlow(f, peers), p.cashFlow],
    ["Ownership alignment", ownership(f), p.ownership],
    ["Valuation", valuation(f, peers), p.valuation]
  ];
  const available = factors.filter(x => x[1] != null);
  const score = available.length ? available.reduce((s,x) => s + x[1] * x[2], 0) / available.reduce((s,x) => s+x[2], 0) : null;
  const unavailable = factors.filter(x => x[1] == null).map(x => x[0]);
  return { score, factors: available.map(([name,score,weight]) => ({ name, score: Math.round(score*10)/10, weight })), unavailable };
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
  if (sector === "BANKING" || sector === "NBFC") {
    factors.push(["Financial resilience", metricScore(f.roe, peers.map(x => x.roe), true), 40]);
  } else {
    factors.push(["Leverage resilience", metricScore(f.debt_to_equity, peers.map(x => x.debt_to_equity), false), 35]);
  }
  factors.push(["Cash-flow resilience", cashFlow(f, peers), 30]);
  factors.push(["Profitability resilience", profitability(f, peers, sector), 20]);
  const vol = technical?.available ? num(technical.volatility?.annualized_20d_pct) : null;
  factors.push(["Market volatility", vol == null ? null : clamp(100 - vol * 1.5), 15]);
  const available = factors.filter(x => x[1] != null);
  return { score: available.length ? available.reduce((s,x)=>s+x[1]*x[2],0)/available.reduce((s,x)=>s+x[2],0) : null, factors: available.map(([name,score,weight])=>({name,score:Math.round(score*10)/10,weight})) };
}

export function calculateFinalScore({ longTermScore, shortTermScore, riskScore, valuationScore }) {
  const values = { longTermScore, shortTermScore, riskScore, valuationScore };
  if (Object.values(values).some(v => v == null)) return null;
  return Math.round((longTermScore * WEIGHTS.longTerm + shortTermScore * WEIGHTS.shortTerm + riskScore * WEIGHTS.risk + valuationScore * WEIGHTS.valuation) * 10) / 10;
}

export function scoreStock({ fundamentals, peers = [], technical, regime = "NEUTRAL", sector = "OTHER" }) {
  const lt = longTerm(fundamentals || {}, peers, sector);
  const st = shortTerm(technical, regime);
  const riskScore = risk(fundamentals || {}, peers, technical, sector);
  const val = valuation(fundamentals || {}, peers);
  const final = calculateFinalScore({ longTermScore: lt.score, shortTermScore: st.score, riskScore: riskScore.score, valuationScore: val });
  const completenessFields = ["sales_growth","profit_growth","roe","roce","debt_to_equity","operating_cash_flow","promoter_holding","promoter_pledge","fii_holding","dii_holding","pe_ratio","pb_ratio"];
  const fundamentalCoverage = completenessFields.filter(k => num(fundamentals?.[k]) != null).length / completenessFields.length;
  const technicalCoverage = technical?.available ? 1 : 0;
  const completeness = Math.round((fundamentalCoverage * 0.70 + technicalCoverage * 0.30) * 1000) / 10;
  const unavailable = [...lt.unavailable, ...st.unavailable];
  return {
    engine_version: ENGINE_VERSION,
    long_term_score: lt.score == null ? null : Math.round(lt.score*10)/10,
    short_term_score: st.score == null ? null : Math.round(st.score*10)/10,
    risk_score: riskScore.score == null ? null : Math.round(riskScore.score*10)/10,
    valuation_score: val == null ? null : Math.round(val*10)/10,
    final_ai_score: final,
    weights: WEIGHTS,
    data_completeness: completeness,
    unavailable_factors: unavailable,
    factor_breakdown: { long_term: lt.factors, short_term: st.factors, risk: riskScore.factors },
    eligibility: { all_core_scores_available: final != null, missing_factors: unavailable }
  };
}
