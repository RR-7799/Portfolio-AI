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
|--------------------------------------------------------------------------
| ENGINE
|--------------------------------------------------------------------------
*/

const ENGINE_VERSION = "sector_fix_v1_1";

/*
|--------------------------------------------------------------------------
| STOCK SECTORS
|--------------------------------------------------------------------------
|
| These values match the sector values already used in your database
| and the normalization logic expected by safe_v4_1.
|
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
|--------------------------------------------------------------------------
| NON-STOCK / FUND SECTORS
|--------------------------------------------------------------------------
|
| These must be preserved because the scorer intentionally skips them.
|
*/

const NON_STOCK_SECTORS = [
  "MUTUAL FUNDS & ETF",
];

/*
|--------------------------------------------------------------------------
| EXPLICIT COMPANY OVERRIDES
|--------------------------------------------------------------------------
|
| Explicit company rules ALWAYS win over keyword rules.
|
| This prevents bad classifications such as:
|
| HOSPITALITY -> HEALTHCARE
| ENGINEER -> CONSTRUCTION
| AGRICULTURE -> OTHER
| etc.
|
*/

const COMPANY_OVERRIDES = {
  /*
  |--------------------------------------------------------------------------
  | TECHNOLOGY
  |--------------------------------------------------------------------------
  */

  "HFCL LIMITED": SECTORS.TECHNOLOGY,
  "FCS SOFTWARE SOL": SECTORS.TECHNOLOGY,
  "AIRAN LTD": SECTORS.TECHNOLOGY,
  "AVENUESAI LIMITED": SECTORS.TECHNOLOGY,

  /*
  |--------------------------------------------------------------------------
  | FINANCIAL SERVICES
  |--------------------------------------------------------------------------
  */

  "BILLIONBRAINS GARAGE VN L": SECTORS.FINANCIAL,
  "JM FINANCL": SECTORS.FINANCIAL,
  "PANAFIC INDUS": SECTORS.FINANCIAL,
  "IFCI LTD": SECTORS.FINANCIAL,
  "INDIAN RAILWAY FIN CORP L": SECTORS.FINANCIAL,

  /*
  |--------------------------------------------------------------------------
  | CHEMICALS
  |--------------------------------------------------------------------------
  */

  "RESONANCE SPECIALTIES LTD.": SECTORS.CHEMICALS,
  "PRAJ INDUSTRIES LTD": SECTORS.CHEMICALS,
  "IOL CHEM AND PHARMA LTD": SECTORS.CHEMICALS,
  "KREBS BIOCHEMICALS & IND": SECTORS.CHEMICALS,
  "DEEPAK FERTILIZERS & PETR": SECTORS.CHEMICALS,

  /*
  |--------------------------------------------------------------------------
  | PHARMA / HEALTHCARE
  |--------------------------------------------------------------------------
  */

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

  /*
  |--------------------------------------------------------------------------
  | AUTOMOBILE
  |--------------------------------------------------------------------------
  */

  "CASTROL INDIA LIMITED": SECTORS.AUTOMOBILE,
  "MERCURY EV": SECTORS.AUTOMOBILE,
  "AMARA RAJA ENERGY MOB LTD": SECTORS.AUTOMOBILE,
  "SAMVRDHNA MTHRSN INTL LTD": SECTORS.AUTOMOBILE,
  "TATA MOTORS LIMITED": SECTORS.AUTOMOBILE,
  "TATA MOTORS PASS VEH LTD": SECTORS.AUTOMOBILE,

  /*
  |--------------------------------------------------------------------------
  | CONSUMER
  |--------------------------------------------------------------------------
  */

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
  "MUKTA AGRICULTURE": SECTORS.CONSUMER,

  /*
  |--------------------------------------------------------------------------
  | CONSTRUCTION / INFRASTRUCTURE
  |--------------------------------------------------------------------------
  */

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

  /*
  |--------------------------------------------------------------------------
  | METALS / MINING
  |--------------------------------------------------------------------------
  |
  | Lloyds Enterprise is intentionally NOT forced into metals.
  | It is diversified and should stay OTHER.
  |
  */

  "LLOYDS ENTERPRISE": SECTORS.OTHER,
  "VIRAM SUVARNA": SECTORS.METALS,
  "NMDC LTD.": SECTORS.METALS,
  "TATA STEEL LIMITED": SECTORS.METALS,
  "STEEL AUTHORITY OF INDIA": SECTORS.METALS,

  /*
  |--------------------------------------------------------------------------
  | ENERGY
  |--------------------------------------------------------------------------
  */

  "SUZLON ENERGY": SECTORS.ENERGY,
  "NHPC LTD": SECTORS.ENERGY,
  "NTPC LTD": SECTORS.ENERGY,
  "TATA POWER CO LTD": SECTORS.ENERGY,
  "JAIPRAKASH POWER": SECTORS.ENERGY,
  "GUJARAT ENERGY LIMITED": SECTORS.ENERGY,

  /*
  |--------------------------------------------------------------------------
  | OIL & GAS
  |--------------------------------------------------------------------------
  */

  "GAIL (INDIA) LTD": SECTORS.OIL_GAS,

  /*
  |--------------------------------------------------------------------------
  | DEFENCE
  |--------------------------------------------------------------------------
  */

  "BHARAT ELECTRONICS LTD": SECTORS.DEFENCE,
  "GARDEN REACH SHIP&ENG LTD": SECTORS.DEFENCE,
  "AVANTEL": SECTORS.DEFENCE,

  /*
  |--------------------------------------------------------------------------
  | INDUSTRIAL
  |--------------------------------------------------------------------------
  */

  "HUHTAMAKI INDIA LIMITED": SECTORS.INDUSTRIAL,
  "INTL CONVEYORS LIMITED": SECTORS.INDUSTRIAL,

  /*
  |--------------------------------------------------------------------------
  | OTHER / DIVERSIFIED
  |--------------------------------------------------------------------------
  */

  "OSWAL GREENTECH": SECTORS.OTHER,
  "SHREE GANESH": SECTORS.OTHER,
  "SHALIMAR PRODU": SECTORS.OTHER,

  /*
  |--------------------------------------------------------------------------
  | MUTUAL FUNDS / ETF
  |--------------------------------------------------------------------------
  |
  | These are NOT stock sectors. They must remain identifiable as funds
  | because the portfolio scorer skips them.
  |
  */

  "SBI FUNDS MANAGEMENT LTD": "MUTUAL FUNDS & ETF",
  "TATAAML-TATAGOLD": "MUTUAL FUNDS & ETF",
  "TATAAML-TATSILV": "MUTUAL FUNDS & ETF",
};

/*
|--------------------------------------------------------------------------
| KEYWORD FALLBACK RULES
|--------------------------------------------------------------------------
|
| These are only used when an explicit company override is unavailable.
|
*/

const KEYWORD_RULES = [
  /*
  |--------------------------------------------------------------------------
  | BANK
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.BANK,
    keywords: [
      "BANK",
      "BANKING",
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | DEFENCE
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.DEFENCE,
    keywords: [
      "DEFENCE",
      "DEFENSE",
      "AEROSPACE",
      "SHIPYARD",
      "DEFENCE SYSTEM",
      "DEFENSE SYSTEM",
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | PHARMA
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.PHARMA,
    keywords: [
      "PHARMA",
      "PHARMACEUT",
      "LIFESCIENCE",
      "LIFE SCIENCE",
      "BIOPHARMA",
      "HEALTHCARE",
      "HEALTH CARE",
      "HOSPITAL",
      "HOSPITALS",
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | CHEMICALS
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.CHEMICALS,
    keywords: [
      "CHEMICAL",
      "CHEM",
      "FERTILIZER",
      "FERTILISER",
      "SPECIALTY CHEMICAL",
      "SPECIALTY",
      "BIOCHEM",
      "BIOCHEMICAL",
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | TECHNOLOGY
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.TECHNOLOGY,
    keywords: [
      "SOFTWARE",
      "TECHNOLOGY",
      "TECH",
      "IT ",
      "INFORMATION TECHNOLOGY",
      "DIGITAL",
      "TELECOM",
      "NETWORK",
      "OPTICAL FIBER",
      "OPTICAL FIBRE",
      "COMMUNICATION",
      "CYBER",
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | AUTOMOBILE
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.AUTOMOBILE,
    keywords: [
      "AUTOMOBILE",
      "AUTOMOTIVE",
      "MOTOR",
      "MOTORCYCLE",
      "MOBILITY",
      "AUTO ",
      "TYRE",
      "TYRES",
      "TIRE",
      "TIRES",
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | CONSTRUCTION / INFRA
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.CONSTRUCTION,
    keywords: [
      "CEMENT",
      "INFRA",
      "INFRASTRUCTURE",
      "CONSTRUCTION",
      "PROJECTS",
      "REALTY",
      "BUILD",
      "BUILDERS",
      "ENGINEERING",
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | METALS / MINING
  |--------------------------------------------------------------------------
  */

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

  /*
  |--------------------------------------------------------------------------
  | ENERGY
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.ENERGY,
    keywords: [
      "POWER",
      "ENERGY",
      "RENEWABLE",
      "ELECTRIC",
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | OIL & GAS
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.OIL_GAS,
    keywords: [
      "PETROLEUM",
      "OIL",
      "GAS",
      "NATURAL GAS",
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | FINANCIAL SERVICES
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.FINANCIAL,
    keywords: [
      "FINANCE",
      "FINANCIAL",
      "CAPITAL",
      "INVESTMENT",
      "BROKING",
      "BROKER",
      "LEASING",
      "CREDIT",
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | CONSUMER
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.CONSUMER,
    keywords: [
      "FMCG",
      "CONSUMER",
      "JEWELL",
      "JEWELLERY",
      "JEWELRY",
      "TEXTILE",
      "TEXTILES",
      "FOODS",
      "FOOD",
      "SUGAR",
      "HOTEL",
      "HOTELS",
      "HOSPITALITY",
      "RETAIL",
      "BEVERAGE",
      "TOBACCO",
    ],
  },

  /*
  |--------------------------------------------------------------------------
  | INDUSTRIAL
  |--------------------------------------------------------------------------
  */

  {
    sector: SECTORS.INDUSTRIAL,
    keywords: [
      "INDUSTRIAL",
      "PACKAGING",
      "CONVEYOR",
      "EQUIPMENT",
      "MANUFACTURING",
      "MACHINERY",
    ],
  },
];

/*
|--------------------------------------------------------------------------
| TEXT NORMALIZATION
|--------------------------------------------------------------------------
*/

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

/*
|--------------------------------------------------------------------------
| SAFE KEYWORD MATCHING
|--------------------------------------------------------------------------
|
| Prevents:
|
| HOSPITAL -> matching HOSPITALITY
|
| Example:
|
| HOSPITAL      => true
| HOSPITALITY   => false
|
*/

function keywordMatches(text, keyword) {
  const normalizedText = normalizeText(text);
  const normalizedKeyword = normalizeText(keyword);

  if (!normalizedKeyword) {
    return false;
  }

  /*
  |--------------------------------------------------------------------------
  | Multi-word phrases
  |--------------------------------------------------------------------------
  */

  if (normalizedKeyword.includes(" ")) {
    return normalizedText.includes(normalizedKeyword);
  }

  /*
  |--------------------------------------------------------------------------
  | Single-word phrase
  |--------------------------------------------------------------------------
  */

  const escapedKeyword = normalizedKeyword.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );

  const regex = new RegExp(
    `(^|[^A-Z0-9])${escapedKeyword}($|[^A-Z0-9])`,
    "i"
  );

  return regex.test(normalizedText);
}

/*
|--------------------------------------------------------------------------
| VALID SECTOR CHECK
|--------------------------------------------------------------------------
*/

function isValidSector(sector) {
  const normalized = normalizeText(sector);

  const stockSectorValid = Object.values(SECTORS).some(
    (value) => normalizeText(value) === normalized
  );

  const nonStockSectorValid = NON_STOCK_SECTORS.some(
    (value) => normalizeText(value) === normalized
  );

  return stockSectorValid || nonStockSectorValid;
}

/*
|--------------------------------------------------------------------------
| CLASSIFICATION
|--------------------------------------------------------------------------
*/

function classifyCompany(companyName, currentSector) {
  const name = normalizeText(companyName);

  /*
  |--------------------------------------------------------------------------
  | 1. Explicit company override
  |--------------------------------------------------------------------------
  */

  if (Object.prototype.hasOwnProperty.call(COMPANY_OVERRIDES, name)) {
    return {
      sector: COMPANY_OVERRIDES[name],
      method: "OVERRIDE",
    };
  }

  /*
  |--------------------------------------------------------------------------
  | 2. Preserve existing valid sector
  |--------------------------------------------------------------------------
  |
  | We preserve an existing valid classification when there is no
  | explicit override.
  |
  */

  if (isValidSector(currentSector)) {
    return {
      sector: currentSector,
      method: "EXISTING",
    };
  }

  /*
  |--------------------------------------------------------------------------
  | 3. Keyword fallback
  |--------------------------------------------------------------------------
  */

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

  /*
  |--------------------------------------------------------------------------
  | 4. Unclassified
  |--------------------------------------------------------------------------
  */

  return {
    sector: SECTORS.OTHER,
    method: "UNCLASSIFIED",
  };
}

/*
|--------------------------------------------------------------------------
| PROCESS INSTRUMENTS
|--------------------------------------------------------------------------
*/

async function processClassification() {
  const { data: instruments, error } = await supabase
    .from("instruments")
    .select("id, company_name, symbol, sector")
    .order("company_name", { ascending: true });

  if (error) {
    throw new Error(`Instruments query failed: ${error.message}`);
  }

  if (!instruments || instruments.length === 0) {
    return {
      success: true,
      engine_version: ENGINE_VERSION,
      processed: 0,
      updated: 0,
      unchanged: 0,
      errors: 0,
      sector_counts: {},
      corrections: [],
      unclassified: [],
    };
  }

  const results = [];

  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  /*
  |--------------------------------------------------------------------------
  | Process each instrument
  |--------------------------------------------------------------------------
  */

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

      /*
      |--------------------------------------------------------------------------
      | Update only when required
      |--------------------------------------------------------------------------
      */

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
        error:
          instrumentError?.message ||
          "Unknown instrument update error",
      });
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Sector counts
  |--------------------------------------------------------------------------
  */

  const sectorCounts = {};

  for (const item of results) {
    if (!item.new_sector) {
      continue;
    }

    sectorCounts[item.new_sector] =
      (sectorCounts[item.new_sector] || 0) + 1;
  }

  /*
  |--------------------------------------------------------------------------
  | Return detailed diagnostics
  |--------------------------------------------------------------------------
  */

  return {
    success: true,
    engine_version: ENGINE_VERSION,
    processed: instruments.length,
    updated,
    unchanged,
    errors,
    sector_counts: sectorCounts,

    /*
    |--------------------------------------------------------------------------
    | Only actual sector changes
    |--------------------------------------------------------------------------
    */

    corrections: results.filter(
      (item) => item.changed === true
    ),

    /*
    |--------------------------------------------------------------------------
    | Still unclassified
    |--------------------------------------------------------------------------
    */

    unclassified: results.filter(
      (item) =>
        item.new_sector === SECTORS.OTHER &&
        item.method === "UNCLASSIFIED"
    ),

    /*
    |--------------------------------------------------------------------------
    | Explicit override results
    |--------------------------------------------------------------------------
    */

    overrides_applied: results.filter(
      (item) => item.method === "OVERRIDE"
    ),

    /*
    |--------------------------------------------------------------------------
    | Keyword classifications
    |--------------------------------------------------------------------------
    */

    keyword_classifications: results.filter(
      (item) => item.method === "KEYWORD"
    ),

    /*
    |--------------------------------------------------------------------------
    | Existing classifications preserved
    |--------------------------------------------------------------------------
    */

    existing_preserved: results.filter(
      (item) => item.method === "EXISTING"
    ),

    /*
    |--------------------------------------------------------------------------
    | Errors
    |--------------------------------------------------------------------------
    */

    failed_updates: results.filter(
      (item) => item.method === "ERROR"
    ),
  };
}

/*
|--------------------------------------------------------------------------
| POST
|--------------------------------------------------------------------------
|
| API-friendly method.
|
| Can be used later by frontend/admin tools.
|
*/

export async function POST() {
  try {
    const result = await processClassification();

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "Sector classification POST failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        engine_version: ENGINE_VERSION,
        error:
          error?.message ||
          "Unknown sector classification error",
      },
      {
        status: 500,
      }
    );
  }
}

/*
|--------------------------------------------------------------------------
| GET
|--------------------------------------------------------------------------
|
| Browser-friendly method.
|
| This exists because you are currently deploying directly
| through GitHub + Vercel and opening the endpoint in Chrome.
|
| WARNING:
| GET performs database updates.
| Run it once after deployment.
|
*/

export async function GET() {
  try {
    const result = await processClassification();

    return NextResponse.json(result);
  } catch (error) {
    console.error(
      "Sector classification GET failed:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        engine_version: ENGINE_VERSION,
        error:
          error?.message ||
          "Unknown sector classification error",
      },
      {
        status: 500,
      }
    );
  }
}
