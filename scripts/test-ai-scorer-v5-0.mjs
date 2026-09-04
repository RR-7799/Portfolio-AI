import assert from "node:assert/strict";
import { calculateFinalScore, scoreStock, WEIGHTS, ENGINE_VERSION } from "../app/lib/scoring/ai-scorer-v5-0.js";

assert.equal(ENGINE_VERSION, "ai_scorer_v5_0");
assert.deepEqual(WEIGHTS, { longTerm: 0.5, shortTerm: 0.25, risk: 0.15, valuation: 0.1 });

const balanced = calculateFinalScore({ longTermScore: 80, shortTermScore: 80, riskScore: 80, valuationScore: 80 });
assert.equal(balanced, 80);

// Missing core data must not silently renormalize the economic weights.
assert.equal(calculateFinalScore({ longTermScore: 90, shortTermScore: null, riskScore: 90, valuationScore: 90 }), null);

const baseFundamentals = {
  sales_growth: 15,
  profit_growth: 18,
  roe: 16,
  roce: 18,
  debt_to_equity: 0.35,
  operating_cash_flow: 100,
  promoter_holding: 50,
  promoter_pledge: 0,
  fii_holding: 20,
  dii_holding: 10,
  pe_ratio: 18,
  pb_ratio: 2.2
};

const peers = [
  { sales_growth: 10, profit_growth: 12, roe: 12, roce: 14, debt_to_equity: 0.8, operating_cash_flow: 70, pe_ratio: 25, pb_ratio: 3 },
  { sales_growth: 5, profit_growth: 7, roe: 9, roce: 10, debt_to_equity: 1.1, operating_cash_flow: 50, pe_ratio: 30, pb_ratio: 4 },
  { sales_growth: 20, profit_growth: 22, roe: 20, roce: 22, debt_to_equity: 0.2, operating_cash_flow: 150, pe_ratio: 15, pb_ratio: 1.8 }
];

const technical = {
  available: true,
  trend: "UPTREND",
  momentum: { rsi14: 62, one_month: 4, three_month: 10 },
  volatility: { volume_ratio_20d: 1.2, annualized_20d_pct: 18 }
};

for (const sector of ["IT", "PHARMA", "MANUFACTURING", "INFRASTRUCTURE", "DEFENCE", "FMCG", "ENERGY", "CHEMICALS", "AUTO", "BANKING", "NBFC", "FINANCIAL_SERVICES", "OTHER"]) {
  const result = scoreStock({ fundamentals: baseFundamentals, peers, technical, regime: "NEUTRAL", sector });
  assert.equal(result.engine_version, "ai_scorer_v5_0");
  assert.ok(result.long_term_score != null, `${sector}: LT score missing`);
  assert.ok(result.short_term_score != null, `${sector}: ST score missing`);
  assert.ok(result.risk_score != null, `${sector}: risk score missing`);
  assert.ok(result.valuation_score != null, `${sector}: valuation score missing`);
  assert.ok(result.final_ai_score != null, `${sector}: final score missing`);
  assert.deepEqual(result.weights, WEIGHTS);
  assert.equal(result.eligibility.all_core_scores_available, true);
}

console.log("AI scorer v5.0 core tests passed");
