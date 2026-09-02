import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase environment variables.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

/*
  Sector values used by the scoring engine.

  IMPORTANT:
  These are intentionally kept aligned with the existing
  safe_v4_1 scorer so classification changes immediately
  improve scoring without requiring a scoring-engine rewrite.
*/
const SECTORS = {
  BANK: "BANKING",
  DEFENCE: "DEFENCE & AEROSPACE",
  TECHNOLOGY: "IT & TECHNOLOGY",
  PHARMA: "PHARMA & HEALTHCARE",
  CONSTRUCTION: "CONSTRUCTION & INFRASTRUCTURE",
  AUTOMOBILE: "AUTOMOBILE & AUTO COMPONENTS",
  CONSUMER: "FMCG & CONSUMER",
  CHEMICALS: "CHEMICALS & FERTILIZERS",
  ENERGY: "POWER & ENERGY",
  FINANCIAL: "FINANCIAL SERVICES",
  INDUSTRIAL: "INDUSTRIAL PRODUCTS",
  METALS: "METALS & MINING",
  OIL_GAS: "OIL & GAS",
  OTHER: "OTHER",
};

/*
  Explicit company-level overrides.

  Company overrides ALWAYS win over keyword classification.
  This prevents common false matches such as:

  HOSPITALITY -> healthcare
  OIL in a company name -> energy
  ENGINEER -> construction when actually industrial
*/
const COMPANY_OVERRIDES = {
  // -------------------------
  // TECHNOLOGY
  // -------------------------
  "HFCL LIMITED": SECTORS.TECHNOLOGY,
  "FCS SOFTWARE SOL": SECTORS.TECHNOLOGY,
  "AIRAN LTD": SECTORS.TECHNOLOGY,
  "AVENUESAI LIMITED": SECTORS.TECHNOLOGY,

  // -------------------------
  // FINANCIAL
  // -------------------------
  "BILLIONBRAINS GARAGE VN L": SECTORS.FINANCIAL,
  "JM FINANCL": SECTORS.FINANCIAL,
  "PANAFIC INDUS": SECTORS.FINANCIAL,
  "IFCI LTD": SECTORS.FINANCIAL,
  "INDIAN RAILWAY FIN CORP L": SECTORS.FINANCIAL,

  // -------------------------
  // CHEMICALS
  // -------------------------
  "RESONANCE SPECIALTIES LTD.": SECTORS.CHEMICALS,
  "PRAJ INDUSTRIES LTD": SECTORS.CHEMICALS,
  "IOL CHEM AND PHARMA LTD": SECTORS.CHEMICALS,
  "KREBS BIOCHEMICALS & IND": SECTORS.CHEMICALS,
  "DEEPAK FERTILIZERS & PETR": SECTORS.CHEMICALS,

  // -------------------------
  // PHARMA / HEALTHCARE
  // -------------------------
  "MAKERS LABORATORIES LTD.": SECTORS.PHARMA,
  "VEERHEALTH CARE LIMITED": SECTORS.PHARMA,
  "LOOKS HEALTH SER": SECTORS.PHARMA,
  "EVEXIA LIFECARE": SECTORS.PHARMA,
  "KOPRAN LTD": SECTORS.PHARMA,
  "LAURUS LABS LIMITED": SECTORS.PHARMA,
  "MARKSANS PHA": SECTORS.PHARMA,
  "NARAYANA HRUDAYALAYA LTD.": SECTORS.PHARMA,
  "NECTAR LIFESCIENCES LTD.": SECTORS.PHARMA,
  "BIOCON LIMITED.": SECTORS.PHARMA,

  // -------------------------
  // AUTOMOBILE
  // -------------------------
  "CASTROL INDIA LIMITED": SECTORS.AUTOMOBILE,
  "MERCURY EV": SECTORS.AUTOMOBILE,
  "AMARA RAJA ENERGY MOB LTD": SECTORS.AUTOMOBILE,
  "SAMVRDHNA MTHRSN INTL LTD": SECTORS.AUTOMOBILE,
  "TATA MOTORS LIMITED": SECTORS.AUTOMOBILE,
  "TATA MOTORS PASS VEH LTD": SECTORS.AUTOMOBILE,

  // -------------------------
  // CONSUMER
  // -------------------------

  // Critical correction:
  // Hospitality must NOT become healthcare.
  "DEVYANI INTER": SECTORS.CONSUMER,

  "ITC LTD": SECTORS.CONSUMER,
  "ITC HOTELS LIMITED": SECTORS.CONSUMER,
  "JYOTHY LABS LIMITED": SECTORS.CONSUMER,
  "KALYAN JEWELLERS IND LTD": SECTORS.CONSUMER,
  "TRIDENT LIMITED": SECTORS.CONSUMER,
  "MISHTANN FOODS": SECTORS.CONSUMER,
  "BAJAJ HINDUSTHAN": SECTORS.CONSUMER,
  "BCL ENTERPRISE": SECTORS.CONSUMER,
  "TUNI TEXTILE MILLS LTD.": SECTORS.CONSUMER,

  // Agriculture-related company.
  // Kept in the consumer bucket rather than OTHER so the
  // scoring system does not treat it as an unclassified company.
  "MUKTA AGRICULTURE": SECTORS.CONSUMER,

  // -------------------------
  // CONSTRUCTION / INFRA
  // -------------------------
  "JK LAKSHMI CEMENT LTD": SECTORS.CONSTRUCTION,
  "G G ENGINEERING LIMITED": SECTORS.CONSTRUCTION,
  "NBCC (INDIA) LIMITED": SECTORS.CONSTRUCTION,
  "NCC LIMITED": SECTORS.CONSTRUCTION,
  "IRB INFRA DEV LTD.": SECTORS.CONSTRUCTION,
  "PSP PROJECTS LIMITED": SECTORS.CONSTRUCTION,
  "ASHOKA BUILD": SECTORS.CONSTRUCTION,
  "LLOYDS ENGINEER": SECTORS.CONSTRUCTION,
  "JSW INFRASTRUCTURE LTD": SECTORS.CONSTRUCTION,
  "ENVIRO INFRA ENGINEERS L": SECTORS.CONSTRUCTION,
  "GMR POW AND URBAN INFRA L": SECTORS.CONSTRUCTION,

  // -------------------------
  // METALS / MINING
  // -------------------------
  "LLOYDS ENTERPRISE": SECTORS.METALS,
  "VIRAM SUVARNA": SECTORS.METALS,
  "NMDC LTD.": SECTORS.METALS,
  "TATA STEEL LIMITED": SECTORS.METALS,
  "STEEL AUTHORITY OF INDIA": SECTORS.METALS,

  // -------------------------
  // ENERGY
  // -------------------------
  "SUZLON ENERGY": SECTORS.ENERGY,
  "NHPC LTD": SECTORS.ENERGY,
  "NTPC LTD": SECTORS.ENERGY,
  "TATA POWER CO LTD": SECTORS.ENERGY,
  "JAIPRAKASH POWER": SECTORS.ENERGY,
  "GUJARAT ENERGY LIMITED": SECTORS.ENERGY,

  // -------------------------
  // OIL & GAS
  // -------------------------
  "GAIL (INDIA) LTD": SECTORS.OIL_GAS,

  // -------------------------
  // DEFENCE
  // -------------------------
  "BHARAT ELECTRONICS LTD": SECTORS.DEFENCE,
  "GARDEN REACH SHIP&ENG LTD": SECTORS.DEFENCE,
  "AVANTEL": SECTORS.DEFENCE,

  // -------------------------
  // INDUSTRIAL
  // -------------------------
  "HUHTAMAKI INDIA LIMITED": SECTORS.INDUSTRIAL,
  "INTL CONVEYORS LIMITED": SECTORS.INDUSTRIAL,

  // -------------------------
  // OTHER / DIVERSIFIED
  // -------------------------

  // This is deliberately kept OTHER because the business
  // spans engineering, real estate, mining and investments.
  // We do NOT force a misleading pure sector.
  "OSWAL GREENTECH": SECTORS.OTHER,

  "SHREE GANESH": SECTORS.OTHER,
  "SHALIMAR PRODU": SECTORS.OTHER,
  "KREBS BIOCHEMICALS & IND": SECTORS.CHEMICALS,
};

/*
  Keyword rules are fallback rules only.
  Explicit company overrides always take priority.
*/
const KEYWORD_RULES = [
  {
    sector: SECTORS.BANK,
    keywords: [
      "BANK",
      "BANKING",
    ],
  },

  {
    sector: SECTORS.DEFENCE,
    keywords: [
      "DEFENCE",
      "DEFENSE",
      "AEROSPACE",
      "SHIPYARD",
      "SHIP",
    ],
  },

  {
    sector: SECTORS.PHARMA,
    keywords: [
      "PHARMA",
      "PHARMACEUT",
      "LIFESCIENCE",
      "BIOCON",
      "HEALTH",
      "HOSPITAL",
      "HOSPITALS",
    ],
  },

  {
    sector: SECTORS.CHEMICALS,
    keywords: [
      "CHEMICAL",
      "CHEM",
      "FERTILIZER",
      "FERTILISER",
      "SPECIALT",
      "BIOCHEM",
    ],
  },

  {
    sector: SECTORS.TECHNOLOGY,
    keywords: [
      "TECH",
      "SOFTWARE",
      "IT ",
      "INFORMATION TECHNOLOGY",
      "DIGITAL",
      "TELECOM",
      "NETWORK",
      "OPTICAL FIBER",
      "OPTICAL FIBRE",
      "COMMUNICATION",
    ],
  },

  {
    sector: SECTORS.AUTOMOBILE,
    keywords: [
      "MOTOR",
      "AUTOMOBILE",
      "AUTO ",
      "MOBILITY",
      "TYRE",
      "TIRES",
      "CASTROL",
      "EV ",
    ],
  },

  {
    sector: SECTORS.CONSTRUCTION,
    keywords: [
      "CEMENT",
      "INFRA",
      "CONSTRUCTION",
      "PROJECTS",
      "BUILD",
      "ENGINEERING",
      "REALTY",
      "INFRASTRUCTURE",
    ],
  },

  {
    sector: SECTORS.METALS,
    keywords: [
      "STEEL",
      "MINING",
      "METAL",
      "MINERALS",
      "IRON",
      "GOLD",
    ],
  },

  {
    sector: SECTORS.ENERGY,
    keywords: [
      "POWER",
      "ENERGY",
      "RENEWABLE",
      "ELECTRIC",
    ],
  },

  {
    sector: SECTORS.OIL_GAS,
    keywords: [
      "OIL",
      "GAS",
      "PETROLEUM",
      "NATURAL GAS",
    ],
  },

  {
    sector: SECTORS.FINANCIAL,
    keywords: [
      "FINANCE",
      "FINANCIAL",
      "CAPITAL",
      "INVESTMENT",
      "BROKING",
      "BROKER",
      "HOLDINGS",
      "LEASING",
      "CREDIT",
    ],
  },

  {
    sector: SECTORS.CONSUMER,
    keywords: [
      "FMCG",
      "CONSUMER",
      "JEWELL",
      "JEWELLERY",
      "TEXTILE",
      "FOODS",
      "FOOD",
      "SUGAR",
      "HOTELS",
      "HOSPITALITY",
      "RETAIL",
      "BEVERAGE",
      "TOBACCO",
    ],
  },

  {
    sector: SECTORS.INDUSTRIAL,
    keywords: [
      "INDUSTRIAL",
      "PACKAGING",
      "CONVEYOR",
      "EQUIPMENT",
      "MANUFACTURING",
    ],
  },
];

/*
  IMPORTANT BUG FIX:

  Old logic effectively treated "HOSPITALITY" as containing
  "HOSPITAL", which incorrectly classified hospitality
  businesses such as Devyani as healthcare.

  We now check explicit overrides first and use safer matching.
*/
function normalizeText(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function keywordMatches(text, keyword) {
  const normalizedText = normalizeText(text);
  const normalizedKeyword = normalizeText(keyword);

  if (!normalizedKeyword) {
    return false;
  }

  // Exact phrase matching for longer phrases.
  if (normalizedKeyword.includes(" ")) {
    return normalizedText.includes(normalizedKeyword);
  }

  // Avoid false matches:
  // HOSPITAL must not match HOSPITALITY.
  const regex = new RegExp(
    `(^|[^A-Z0-9])${normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^A-Z0-9])`,
    "i"
  );

  return regex.test(normalizedText);
}

function classifyCompany(companyName, currentSector) {
  const name = normalizeText(companyName);

  // 1. Explicit override
  if (COMPANY_OVERRIDES[name]) {
    return {
      sector: COMPANY_OVERRIDES[name],
      method: "OVERRIDE",
    };
  }

  // 2. Preserve existing valid sector when it is not OTHER
  const existing = normalizeText(currentSector);

  const validExisting = Object.values(SECTORS).some(
    (sector) => normalizeText(sector) === existing
  );

  if (validExisting && existing !== normalizeText(SECTORS.OTHER)) {
    return {
      sector: currentSector,
      method: "EXISTING",
    };
  }

  // 3. Keyword fallback
  for (const rule of KEYWORD_RULES) {
    for (const keyword of rule.keywords) {
      if (keywordMatches(name, keyword)) {
        return {
          sector: rule.sector,
          method: "KEYWORD",
        };
      }
    }
  }

  // 4. Keep OTHER if nothing reliable matched.
  return {
    sector: SECTORS.OTHER,
    method: "UNCLASSIFIED",
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    const onlyOther = body?.onlyOther === true;

    const { data: instruments, error } = await supabase
      .from("instruments")
      .select("id, company_name, symbol, sector")
      .order("company_name", { ascending: true });

    if (error) {
      throw new Error(`Instruments query failed: ${error.message}`);
    }

    if (!instruments || instruments.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No instruments found.",
        processed: 0,
        updated: 0,
      });
    }

    const results = [];
    let updated = 0;
    let unchanged = 0;
    let errors = 0;

    for (const instrument of instruments) {
      try {
        const currentSector = normalizeText(instrument.sector);

        if (
          onlyOther &&
          currentSector !== normalizeText(SECTORS.OTHER)
        ) {
          unchanged++;

          results.push({
            id: instrument.id,
            symbol: instrument.symbol,
            company_name: instrument.company_name,
            old_sector: instrument.sector,
            new_sector: instrument.sector,
            method: "SKIPPED_NON_OTHER",
            changed: false,
          });

          continue;
        }

        const classification = classifyCompany(
          instrument.company_name,
          instrument.sector
        );

        const oldSector = instrument.sector;
        const newSector = classification.sector;

        const changed =
          normalizeText(oldSector) !== normalizeText(newSector);

        if (changed) {
          const { error: updateError } = await supabase
            .from("instruments")
            .update({
              sector: newSector,
            })
            .eq("id", instrument.id);

          if (updateError) {
            throw new Error(updateError.message);
          }

          updated++;
        } else {
          unchanged++;
        }

        results.push({
          id: instrument.id,
          symbol: instrument.symbol,
          company_name: instrument.company_name,
          old_sector: oldSector,
          new_sector: newSector,
          method: classification.method,
          changed,
        });
      } catch (instrumentError) {
        errors++;

        results.push({
          id: instrument.id,
          symbol: instrument.symbol,
          company_name: instrument.company_name,
          old_sector: instrument.sector,
          new_sector: null,
          method: "ERROR",
          changed: false,
          error: instrumentError.message,
        });
      }
    }

    const sectorCounts = {};

    for (const item of results) {
      if (!item.new_sector) continue;

      sectorCounts[item.new_sector] =
        (sectorCounts[item.new_sector] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      engine_version: "sector_fix_v1",
      processed: instruments.length,
      updated,
      unchanged,
      errors,
      sector_counts: sectorCounts,
      corrections: results.filter((x) => x.changed),
      unclassified: results.filter(
        (x) =>
          x.new_sector === SECTORS.OTHER &&
          x.method === "UNCLASSIFIED"
      ),
    });
  } catch (error) {
    console.error("Sector classification failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
export async function GET() {
  try {
    const { data: instruments, error } = await supabase
      .from("instruments")
      .select("id, company_name, symbol, sector")
      .order("company_name", { ascending: true });

    if (error) {
      throw new Error(`Instruments query failed: ${error.message}`);
    }

    if (!instruments || instruments.length === 0) {
      return NextResponse.json({
        success: true,
        engine_version: "sector_fix_v1",
        message: "No instruments found.",
        processed: 0,
        updated: 0,
        unchanged: 0,
        errors: 0,
      });
    }

    const results = [];
    let updated = 0;
    let unchanged = 0;
    let errors = 0;

    for (const instrument of instruments) {
      try {
        const classification = classifyCompany(
          instrument.company_name,
          instrument.sector
        );

        const oldSector = instrument.sector;
        const newSector = classification.sector;

        const changed =
          normalizeText(oldSector) !== normalizeText(newSector);

        if (changed) {
          const { error: updateError } = await supabase
            .from("instruments")
            .update({
              sector: newSector,
            })
            .eq("id", instrument.id);

          if (updateError) {
            throw new Error(updateError.message);
          }

          updated++;
        } else {
          unchanged++;
        }

        results.push({
          symbol: instrument.symbol,
          company_name: instrument.company_name,
          old_sector: oldSector,
          new_sector: newSector,
          method: classification.method,
          changed,
        });
      } catch (instrumentError) {
        errors++;

        results.push({
          symbol: instrument.symbol,
          company_name: instrument.company_name,
          old_sector: instrument.sector,
          new_sector: null,
          method: "ERROR",
          changed: false,
          error: instrumentError.message,
        });
      }
    }

    const sectorCounts = {};

    for (const item of results) {
      if (!item.new_sector) continue;

      sectorCounts[item.new_sector] =
        (sectorCounts[item.new_sector] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      engine_version: "sector_fix_v1",
      processed: instruments.length,
      updated,
      unchanged,
      errors,
      sector_counts: sectorCounts,
      corrections: results.filter((x) => x.changed),
      unclassified: results.filter(
        (x) =>
          x.new_sector === SECTORS.OTHER &&
          x.method === "UNCLASSIFIED"
      ),
    });
  } catch (error) {
    console.error("Sector classification GET failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
