const MAP = {
  BANKING: "BANKING",
  "FINANCIAL SERVICES": "FINANCIAL_SERVICES",
  "IT & TECHNOLOGY": "IT",
  "PHARMA & HEALTHCARE": "PHARMA",
  "CONSTRUCTION & INFRASTRUCTURE": "INFRASTRUCTURE",
  "DEFENCE & AEROSPACE": "DEFENCE",
  "FMCG & CONSUMER": "FMCG",
  "POWER & ENERGY": "ENERGY",
  "CHEMICALS & FERTILIZERS": "CHEMICALS",
  "AUTOMOBILE & AUTO COMPONENTS": "AUTO",
  MANUFACTURING: "MANUFACTURING",
  "INDUSTRIAL PRODUCTS": "MANUFACTURING",
  "OIL & GAS": "ENERGY",
  "METALS & MINING": "ENERGY"
};

export function normalizeSector(sector) {
  const key = String(sector || "OTHER").trim().toUpperCase();
  return MAP[key] || "OTHER";
}

export function isFinancialSector(sector) {
  const normalized = normalizeSector(sector);
  return normalized === "BANKING" || normalized === "FINANCIAL_SERVICES";
}

export const SECTOR_MAP = Object.freeze({ ...MAP });
