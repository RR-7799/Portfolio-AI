import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is missing.");
  }

  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing.");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

/*
  Portfolio AI — Sector Classification Engine

  IMPORTANT:
  - This is classification only.
  - It does NOT calculate scores.
  - It uses company-specific overrides first.
  - Then sector/security keyword rules.
  - Unknown companies remain OTHER rather than being guessed.
*/

const COMPANY_OVERRIDES = {
  // =========================
  // BANKS
  // =========================
  "HDFC BANK": ["BANK", "BANKING"],
  "FEDERAL BANK": ["BANK", "BANKING"],
  "IDBI BANK": ["BANK", "BANKING"],
  "INDUSIND BANK": ["BANK", "BANKING"],
  "STATE BANK OF INDIA": ["BANK", "BANKING"],
  "INDIAN OVERSEAS BANK": ["BANK", "BANKING"],

  // =========================
  // FINANCIAL SERVICES
  // =========================
  "JM FINANCL": ["FINANCIAL", "FINANCIAL SERVICES"],
  "JM FINANCIAL": ["FINANCIAL", "FINANCIAL SERVICES"],
  "INDIAN RAILWAY FIN CORP": ["FINANCIAL", "FINANCIAL SERVICES"],
  "IRFC": ["FINANCIAL", "FINANCIAL SERVICES"],
  "IFCI": ["FINANCIAL", "FINANCIAL SERVICES"],

  // =========================
  // DEFENCE
  // =========================
  "BHARAT ELECTRONICS": ["DEFENCE", "DEFENCE & AEROSPACE"],
  "GARDEN REACH": ["DEFENCE", "DEFENCE & AEROSPACE"],
  "GRSE": ["DEFENCE", "DEFENCE & AEROSPACE"],
  "AVANTEL": ["DEFENCE", "DEFENCE & AEROSPACE"],

  // =========================
  // IT / TECHNOLOGY
  // =========================
  "TATA CONSULTANCY": ["TECHNOLOGY", "IT & TECHNOLOGY"],
  "TCS": ["TECHNOLOGY", "IT & TECHNOLOGY"],
  "WIPRO": ["TECHNOLOGY", "IT & TECHNOLOGY"],
  "FCS SOFTWARE": ["TECHNOLOGY", "IT & TECHNOLOGY"],
  "AVENUESAI": ["TECHNOLOGY", "IT & TECHNOLOGY"],

  // =========================
  // PHARMA
  // =========================
  "BIOCON": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],
  "LAURUS LABS": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],
  "MARKSANS": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],
  "NECTAR LIFESCIENCES": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],
  "IOL CHEM": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],
  "KOPRAN": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],
  "MAKERS LABORATORIES": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],
  "KREBS BIOCHEMICALS": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],
  "EVEXIA LIFECARE": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],
  "LOOKS HEALTH": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],
  "VEERHEALTH": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],
  "NARAYANA HRUDAYALAYA": ["PHARMA_HEALTHCARE", "PHARMA & HEALTHCARE"],

  // =========================
  // AUTOMOBILE
  // =========================
  "TATA MOTORS": ["AUTOMOBILE", "AUTOMOBILE & AUTO COMPONENTS"],
  "TATA MOTORS PASS": ["AUTOMOBILE", "AUTOMOBILE & AUTO COMPONENTS"],
  "MOTHERSON": ["AUTOMOBILE", "AUTOMOBILE & AUTO COMPONENTS"],
  "SAMVRDHNA MTHRSN": ["AUTOMOBILE", "AUTOMOBILE & AUTO COMPONENTS"],
  "SONA BLW": ["AUTOMOBILE", "AUTOMOBILE & AUTO COMPONENTS"],
  "AMARA RAJA": ["AUTOMOBILE", "AUTOMOBILE & AUTO COMPONENTS"],

  // =========================
  // POWER / ENERGY
  // =========================
  "TATA POWER": ["ENERGY", "POWER & ENERGY"],
  "NTPC": ["ENERGY", "POWER & ENERGY"],
  "NHPC": ["ENERGY", "POWER & ENERGY"],
  "GAIL": ["OIL_GAS", "OIL & GAS"],
  "SUZLON": ["ENERGY", "POWER & ENERGY"],
  "JAIPRAKASH POWER": ["ENERGY", "POWER & ENERGY"],
  "GUJARAT ENERGY": ["ENERGY", "POWER & ENERGY"],

  // =========================
  // METALS / MINING
  // =========================
  "TATA STEEL": ["METALS_MINING", "METALS & MINING"],
  "SAIL": ["METALS_MINING", "METALS & MINING"],
  "STEEL AUTHORITY": ["METALS_MINING", "METALS & MINING"],
  "NMDC": ["METALS_MINING", "METALS & MINING"],

  // =========================
  // INFRASTRUCTURE
  // =========================
  "IRB INFRA": ["CONSTRUCTION_INFRA", "CONSTRUCTION & INFRASTRUCTURE"],
  "GMR POW": ["CONSTRUCTION_INFRA", "CONSTRUCTION & INFRASTRUCTURE"],
  "JSW INFRA": ["CONSTRUCTION_INFRA", "CONSTRUCTION & INFRASTRUCTURE"],
  "NBCC": ["CONSTRUCTION_INFRA", "CONSTRUCTION & INFRASTRUCTURE"],
  "NCC": ["CONSTRUCTION_INFRA", "CONSTRUCTION & INFRASTRUCTURE"],
  "ASHOKA BUILD": ["CONSTRUCTION_INFRA", "CONSTRUCTION & INFRASTRUCTURE"],
  "PSP PROJECTS": ["CONSTRUCTION_INFRA", "CONSTRUCTION & INFRASTRUCTURE"],
  "ENVIRO INFRA": ["CONSTRUCTION_INFRA", "CONSTRUCTION & INFRASTRUCTURE"],
  "LLOYDS ENGINEER": ["CONSTRUCTION_INFRA", "CONSTRUCTION & INFRASTRUCTURE"],
  "G G ENGINEERING": ["CONSTRUCTION_INFRA", "CONSTRUCTION & INFRASTRUCTURE"],

  // =========================
  // CHEMICALS / FERTILIZERS
  // =========================
  "DEEPAK FERTILIZERS": ["CHEMICALS", "CHEMICALS & FERTILIZERS"],
  "IOL CHEM": ["CHEMICALS", "CHEMICALS & FERTILIZERS"],
  "PRAJ INDUSTRIES": ["CHEMICALS", "CHEMICALS & FERTILIZERS"],
  "KREBS BIOCHEMICALS": ["CHEMICALS", "CHEMICALS & FERTILIZERS"],

  // =========================
  // CONSUMER / FMCG
  // =========================
  "ITC": ["CONSUMER", "FMCG & CONSUMER"],
  "ITC HOTELS": ["CONSUMER", "CONSUMER & HOSPITALITY"],
  "KALYAN JEWELLERS": ["CONSUMER", "CONSUMER & JEWELLERY"],
  "JYOTHY LABS": ["CONSUMER", "FMCG & CONSUMER"],
  "TRIDENT": ["CONSUMER", "TEXTILES & CONSUMER"],
  "TUNI TEXTILE": ["CONSUMER", "TEXTILES & CONSUMER"],
  "DEVYANI": ["CONSUMER", "CONSUMER & HOSPITALITY"],
  "MISHTANN": ["CONSUMER", "FMCG & CONSUMER"],

  // =========================
  // INDUSTRIAL
  // =========================
  "CASTROL": ["INDUSTRIAL", "INDUSTRIAL & AUTO"],
  "HUHTAMAKI": ["INDUSTRIAL", "PACKAGING & INDUSTRIAL"],
  "INTERNATIONAL CONVEYORS": ["INDUSTRIAL", "INDUSTRIAL PRODUCTS"],
  "INTL CONVEYORS": ["INDUSTRIAL", "INDUSTRIAL PRODUCTS"],
  "REDINGTON": ["TECHNOLOGY", "IT & TECHNOLOGY"],

  // =========================
  // FUNDS / ETFs
  // =========================
  "TATAAML": ["FUND", "MUTUAL FUNDS & ETF"],
  "TATAGOLD": ["FUND", "MUTUAL FUNDS & ETF"],
  "TATSILV": ["FUND", "MUTUAL FUNDS & ETF"],
  "SBI FUNDS": ["FUND", "MUTUAL FUNDS & ETF"],
};

const KEYWORD_RULES = [
  {
    security_type: "BANK",
    sector: "BANKING",
    keywords: [
      "BANK LTD",
      "BANK LIMITED",
      "BANK",
    ],
  },

  {
    security_type: "DEFENCE",
    sector: "DEFENCE & AEROSPACE",
    keywords: [
      "DEFENCE",
      "DEFENSE",
      "AEROSPACE",
      "SHIPYARD",
      "ORDNANCE",
    ],
  },

  {
    security_type: "TECHNOLOGY",
    sector: "IT & TECHNOLOGY",
    keywords: [
      "SOFTWARE",
      "TECHNOLOG",
      "DIGITAL",
      "SYSTEMS",
      "IT SERVICES",
      "COMPUTER",
    ],
  },

  {
    security_type: "PHARMA_HEALTHCARE",
    sector: "PHARMA & HEALTHCARE",
    keywords: [
      "PHARMA",
      "PHARMACEUTICAL",
      "LIFESCIENCES",
      "LIFE SCIENCES",
      "BIOCHEM",
      "BIOCON",
      "HEALTHCARE",
      "HEALTH CARE",
      "HOSPITAL",
      "HOSPITALS",
      "MEDICAL",
      "LABORATORIES",
    ],
  },

  {
    security_type: "AUTOMOBILE",
    sector: "AUTOMOBILE & AUTO COMPONENTS",
    keywords: [
      "MOTORS",
      "AUTOMOTIVE",
      "AUTO",
      "MOTHERSON",
      "MOBILITY",
      "PRECISION FORGINGS",
    ],
  },

  {
    security_type: "ENERGY",
    sector: "POWER & ENERGY",
    keywords: [
      "POWER",
      "ENERGY",
      "ELECTRIC",
      "RENEWABLE",
      "SOLAR",
      "WIND",
      "HYDRO",
    ],
  },

  {
    security_type: "OIL_GAS",
    sector: "OIL & GAS",
    keywords: [
      "OIL",
      "GAS",
      "PETROLEUM",
      "PETRO",
      "REFINERY",
    ],
  },

  {
    security_type: "METALS_MINING",
    sector: "METALS & MINING",
    keywords: [
      "STEEL",
      "MINING",
      "MINES",
      "METALS",
      "MINERAL",
      "NMDC",
    ],
  },

  {
    security_type: "CONSTRUCTION_INFRA",
    sector: "CONSTRUCTION & INFRASTRUCTURE",
    keywords: [
      "INFRA",
      "INFRASTRUCTURE",
      "CONSTRUCTION",
      "PROJECTS",
      "BUILD",
      "ENGINEER",
      "ENGINEERING",
    ],
  },

  {
    security_type: "CHEMICALS",
    sector: "CHEMICALS & FERTILIZERS",
    keywords: [
      "CHEMICAL",
      "CHEM",
      "FERTILIZER",
      "FERTILISER",
      "BIOCHEMICAL",
    ],
  },

  {
    security_type: "CONSUMER",
    sector: "FMCG & CONSUMER",
    keywords: [
      "CONSUMER",
      "FMCG",
      "JEWELL",
      "TEXTILE",
      "FOODS",
      "FOOD",
      "HOTELS",
      "RETAIL",
    ],
  },

  {
    security_type: "FINANCIAL",
    sector: "FINANCIAL SERVICES",
    keywords: [
      "FINANCIAL",
      "FINANCE",
      "FINANCL",
      "CAPITAL",
      "INVESTMENT",
      "LEASING",
      "CREDIT",
      "HOUSING FINANCE",
    ],
  },

  {
    security_type: "FUND",
    sector: "MUTUAL FUNDS & ETF",
    keywords: [
      "FUND",
      "ETF",
      "MUTUAL",
      "GOLD",
      "SILVER",
    ],
  },
];

function normalize(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[.,()&'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyCompany(companyName, symbol) {
  const name = normalize(companyName);
  const sym = normalize(symbol);

  // --------------------------------
  // 1. Exact / partial company overrides
  // --------------------------------

  for (const [pattern, classification] of Object.entries(COMPANY_OVERRIDES)) {
    const normalizedPattern = normalize(pattern);

    if (
      name.includes(normalizedPattern) ||
      sym.includes(normalizedPattern)
    ) {
      return {
        security_type: classification[0],
        sector: classification[1],
        method: "company_override",
      };
    }
  }

  // --------------------------------
  // 2. Keyword classification
  // --------------------------------

  for (const rule of KEYWORD_RULES) {
    const matched = rule.keywords.some((keyword) => {
      const k = normalize(keyword);
      return name.includes(k) || sym.includes(k);
    });

    if (matched) {
      return {
        security_type: rule.security_type,
        sector: rule.sector,
        method: "keyword",
      };
    }
  }

  // --------------------------------
  // 3. Default
  // --------------------------------

  return {
    security_type: "OTHER",
    sector: "OTHER",
    method: "default",
  };
}

export async function GET() {
  try {
    const supabase = getSupabase();

    // --------------------------------
    // Get all holdings
    // --------------------------------

    const { data: holdings, error: holdingsError } = await supabase
      .from("holdings")
      .select("instrument_id");

    if (holdingsError) {
      throw new Error(
        `Failed to load holdings: ${holdingsError.message}`
      );
    }

    if (!holdings || holdings.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No holdings found.",
        summary: {
          holdings: 0,
          unique_instruments: 0,
          instruments_processed: 0,
          updated: 0,
          unchanged: 0,
          errors: 0,
        },
      });
    }

    // --------------------------------
    // Unique instruments
    // --------------------------------

    const instrumentIds = [
      ...new Set(
        holdings
          .map((row) => row.instrument_id)
          .filter(Boolean)
      ),
    ];

    // --------------------------------
    // Load instruments
    // --------------------------------

    const { data: instruments, error: instrumentsError } =
      await supabase
        .from("instruments")
        .select(
          "id, symbol, company_name, instrument_type, sector, security_type"
        )
        .in("id", instrumentIds);

    if (instrumentsError) {
      throw new Error(
        `Failed to load instruments: ${instrumentsError.message}`
      );
    }

    let updated = 0;
    let unchanged = 0;
    const errors = [];
    const results = [];

    // --------------------------------
    // Classify every instrument
    // --------------------------------

    for (const instrument of instruments || []) {
      try {
        const classification = classifyCompany(
          instrument.company_name,
          instrument.symbol
        );

        const oldSecurityType =
          instrument.security_type || "OTHER";

        const oldSector =
          instrument.sector || "OTHER";

        const changed =
          oldSecurityType !== classification.security_type ||
          oldSector !== classification.sector;

        if (changed) {
          const { data: saved, error: updateError } =
            await supabase
              .from("instruments")
              .update({
                security_type: classification.security_type,
                sector: classification.sector,
              })
              .eq("id", instrument.id)
              .select(
                "id, symbol, company_name, instrument_type, sector, security_type"
              )
              .single();

          if (updateError) {
            throw new Error(updateError.message);
          }

          updated++;

          results.push({
            symbol: instrument.symbol,
            company_name: instrument.company_name,
            instrument_id: instrument.id,
            previous: {
              security_type: oldSecurityType,
              sector: oldSector,
            },
            classification,
            saved,
          });
        } else {
          unchanged++;

          results.push({
            symbol: instrument.symbol,
            company_name: instrument.company_name,
            instrument_id: instrument.id,
            previous: {
              security_type: oldSecurityType,
              sector: oldSector,
            },
            classification,
            changed: false,
          });
        }
      } catch (error) {
        errors.push({
          instrument_id: instrument.id,
          symbol: instrument.symbol,
          company_name: instrument.company_name,
          error: error.message,
        });
      }
    }

    // --------------------------------
    // Summary by security type
    // --------------------------------

    const bySecurityType = {};

    for (const item of results) {
      const type =
        item.classification?.security_type || "OTHER";

      bySecurityType[type] =
        (bySecurityType[type] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      message: "Portfolio classification completed successfully.",

      summary: {
        holdings: holdings.length,
        unique_instruments: instrumentIds.length,
        instruments_processed: results.length,
        updated,
        unchanged,
        errors: errors.length,
        by_security_type: bySecurityType,
      },

      results,
      errors,
    });
  } catch (error) {
    console.error("Portfolio classification error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
