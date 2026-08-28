import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";


// ======================================================
// SUPABASE
// ======================================================

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing."
    );
  }

  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is missing."
    );
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}


// ======================================================
// CLASSIFICATION ENGINE
// ======================================================

function classifyStock(companyName, symbol) {

  const name = String(companyName || "")
    .toUpperCase()
    .trim();

  const sym = String(symbol || "")
    .toUpperCase()
    .trim();


  // ====================================================
  // 1. EXACT PORTFOLIO OVERRIDES
  // ====================================================

  const overrides = {

    // ------------------------------
    // DEFENCE
    // ------------------------------

    "BHARAT ELECTRONICS LTD": {
      security_type: "DEFENCE",
      sector: "DEFENCE & AEROSPACE",
    },

    "GARDEN REACH SHIP&ENG LTD": {
      security_type: "DEFENCE",
      sector: "DEFENCE & AEROSPACE",
    },


    // ------------------------------
    // BANKING
    // ------------------------------

    "HDFC BANK LTD": {
      security_type: "BANK",
      sector: "BANKING",
    },

    "FEDERAL BANK LTD": {
      security_type: "BANK",
      sector: "BANKING",
    },

    "IDBI BANK LIMITED": {
      security_type: "BANK",
      sector: "BANKING",
    },

    "INDUSIND BANK LIMITED": {
      security_type: "BANK",
      sector: "BANKING",
    },

    "INDIAN OVERSEAS BANK": {
      security_type: "BANK",
      sector: "BANKING",
    },

    "STATE BANK OF INDIA": {
      security_type: "BANK",
      sector: "BANKING",
    },


    // ------------------------------
    // FINANCIAL SERVICES
    // ------------------------------

    "IFCI LTD": {
      security_type: "FINANCIAL",
      sector: "FINANCIAL SERVICES",
    },

    "INDIAN RAILWAY FIN CORP L": {
      security_type: "FINANCIAL",
      sector: "FINANCIAL SERVICES",
    },

    "SBI FUNDS MANAGEMENT LTD": {
      security_type: "FINANCIAL",
      sector: "FINANCIAL SERVICES",
    },

    "JM FINANCL": {
      security_type: "FINANCIAL",
      sector: "FINANCIAL SERVICES",
    },

    "PANAFIC INDUS": {
      security_type: "FINANCIAL",
      sector: "FINANCIAL SERVICES",
    },

    "BILLIONBRAINS GARAGE VN L": {
      security_type: "FINANCIAL",
      sector: "FINTECH",
    },


    // ------------------------------
    // TECHNOLOGY / IT
    // ------------------------------

    "TATA CONSULTANCY SERV LT": {
      security_type: "TECHNOLOGY",
      sector: "IT & TECHNOLOGY",
    },

    "WIPRO LTD": {
      security_type: "TECHNOLOGY",
      sector: "IT & TECHNOLOGY",
    },

    "FCS SOFTWARE SOL": {
      security_type: "TECHNOLOGY",
      sector: "IT & TECHNOLOGY",
    },

    "AVENUESAI LIMITED": {
      security_type: "TECHNOLOGY",
      sector: "IT & TECHNOLOGY",
    },

    "REDINGTON LIMITED": {
      security_type: "TECHNOLOGY",
      sector: "IT & TECHNOLOGY",
    },

    "AVANTEL": {
      security_type: "TECHNOLOGY",
      sector: "TELECOM & TECHNOLOGY",
    },

    "HFCL LIMITED": {
      security_type: "TECHNOLOGY",
      sector: "TELECOM & TECHNOLOGY",
    },

    "AIRAN LTD": {
      security_type: "TECHNOLOGY",
      sector: "TELECOM & TECHNOLOGY",
    },


    // ------------------------------
    // PHARMA / HEALTHCARE
    // ------------------------------

    "BIOCON LIMITED.": {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    },

    "LAURUS LABS LIMITED": {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    },

    "KOPRAN LTD": {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    },

    "MAKERS LABORATORIES LTD.": {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    },

    "NECTAR LIFESCIENCES LTD.": {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    },

    "IOL CHEM AND PHARMA LTD": {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    },

    "NARAYANA HRUDAYALAYA LTD.": {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    },

    "VEERHEALTH CARE LIMITED": {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    },

    "MARKSANS PHA": {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    },

    "LOOKS HEALTH SER": {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    },

    "EVEXIA LIFECARE": {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    },


    // ------------------------------
    // ENERGY / POWER
    // ------------------------------

    "AMARA RAJA ENERGY MOB LTD": {
      security_type: "ENERGY",
      sector: "POWER & ENERGY",
    },

    "NTPC LTD": {
      security_type: "ENERGY",
      sector: "POWER & ENERGY",
    },

    "NHPC LTD": {
      security_type: "ENERGY",
      sector: "POWER & ENERGY",
    },

    "TATA POWER CO LTD": {
      security_type: "ENERGY",
      sector: "POWER & ENERGY",
    },

    "SUZLON ENERGY": {
      security_type: "ENERGY",
      sector: "POWER & ENERGY",
    },

    "JAIPRAKASH POWER": {
      security_type: "ENERGY",
      sector: "POWER & ENERGY",
    },

    "GUJARAT ENERGY LIMITED": {
      security_type: "ENERGY",
      sector: "POWER & ENERGY",
    },


    // ------------------------------
    // OIL & GAS
    // ------------------------------

    "GAIL (INDIA) LTD": {
      security_type: "OIL_GAS",
      sector: "OIL & GAS",
    },

    "CASTROL INDIA LIMITED": {
      security_type: "OIL_GAS",
      sector: "OIL & GAS",
    },


    // ------------------------------
    // METALS / MINING
    // ------------------------------

    "TATA STEEL LIMITED": {
      security_type: "METALS_MINING",
      sector: "METALS & MINING",
    },

    "STEEL AUTHORITY OF INDIA": {
      security_type: "METALS_MINING",
      sector: "METALS & MINING",
    },

    "NMDC LTD.": {
      security_type: "METALS_MINING",
      sector: "METALS & MINING",
    },

    "VIRAM SUVARNA": {
      security_type: "METALS_MINING",
      sector: "METALS & MINING",
    },


    // ------------------------------
    // INFRA / CONSTRUCTION
    // ------------------------------

    "IRB INFRA DEV LTD.": {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    },

    "NBCC (INDIA) LIMITED": {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    },

    "NCC LIMITED": {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    },

    "JSW INFRASTRUCTURE LTD": {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    },

    "PSP PROJECTS LIMITED": {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    },

    "ASHOKA BUILD": {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    },

    "LLOYDS ENGINEER": {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    },

    "ENVIRO INFRA ENGINEERS L": {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    },

    "JK LAKSHMI CEMENT LTD": {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    },

    "GMR POW AND URBAN INFRA L": {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    },

    "G G Engineering Limited": {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    },


    // ------------------------------
    // AUTOMOBILE / EV
    // ------------------------------

    "TATA MOTORS LIMITED": {
      security_type: "AUTOMOBILE",
      sector: "AUTOMOBILE & AUTO COMPONENTS",
    },

    "TATA MOTORS PASS VEH LTD": {
      security_type: "AUTOMOBILE",
      sector: "AUTOMOBILE & AUTO COMPONENTS",
    },

    "MOTHERSON SUMI WRNG IND L": {
      security_type: "AUTOMOBILE",
      sector: "AUTOMOBILE & AUTO COMPONENTS",
    },

    "SAMVRDHNA MTHRSN INTL LTD": {
      security_type: "AUTOMOBILE",
      sector: "AUTOMOBILE & AUTO COMPONENTS",
    },

    "SONA BLW PRECISION FRGS L": {
      security_type: "AUTOMOBILE",
      sector: "AUTOMOBILE & AUTO COMPONENTS",
    },

    "MERCURY EV": {
      security_type: "AUTOMOBILE",
      sector: "AUTOMOBILE & AUTO COMPONENTS",
    },


    // ------------------------------
    // CHEMICALS
    // ------------------------------

    "DEEPAK FERTILIZERS & PETR": {
      security_type: "CHEMICALS",
      sector: "CHEMICALS & FERTILIZERS",
    },

    "KREBS BIOCHEMICALS & IND": {
      security_type: "CHEMICALS",
      sector: "CHEMICALS & FERTILIZERS",
    },

    "RESONANCE SPECIALTIES LTD.": {
      security_type: "CHEMICALS",
      sector: "CHEMICALS & SPECIALTY MATERIALS",
    },

    "SHALIMAR PRODU": {
      security_type: "CHEMICALS",
      sector: "CHEMICALS & INDUSTRIALS",
    },


    // ------------------------------
    // CONSUMER
    // ------------------------------

    "ITC LTD": {
      security_type: "CONSUMER",
      sector: "CONSUMER",
    },

    "ITC HOTELS LIMITED": {
      security_type: "CONSUMER",
      sector: "CONSUMER",
    },

    "KALYAN JEWELLERS IND LTD": {
      security_type: "CONSUMER",
      sector: "CONSUMER",
    },

    "TRIDENT LIMITED": {
      security_type: "CONSUMER",
      sector: "CONSUMER",
    },

    "TUNI TEXTILE MILLS LTD.": {
      security_type: "CONSUMER",
      sector: "CONSUMER",
    },

    "MISHTANN FOODS": {
      security_type: "CONSUMER",
      sector: "CONSUMER",
    },

    "DEVYANI INTER": {
      security_type: "CONSUMER",
      sector: "CONSUMER",
    },

    "HUHTAMAKI INDIA LIMITED": {
      security_type: "CONSUMER",
      sector: "CONSUMER",
    },


    // ------------------------------
    // INDUSTRIAL
    // ------------------------------

    "INTL CONVEYORS LIMITED": {
      security_type: "INDUSTRIAL",
      sector: "INDUSTRIALS",
    },

    "PRAJ INDUSTRIES LTD": {
      security_type: "INDUSTRIAL",
      sector: "INDUSTRIALS",
    },

    "SHREE GANESH": {
      security_type: "INDUSTRIAL",
      sector: "INDUSTRIALS",
    },

    "LLOYDS ENTERPRISE": {
      security_type: "INDUSTRIAL",
      sector: "INDUSTRIALS",
    },

    "OSWAL GREENTECH": {
      security_type: "INDUSTRIAL",
      sector: "INDUSTRIALS",
    },


    // ------------------------------
    // AGRICULTURE / SUGAR
    // ------------------------------

    "MUKTA AGRICULTURE": {
      security_type: "AGRICULTURE",
      sector: "AGRICULTURE & SUGAR",
    },

    "BAJAJ HINDUSTHAN": {
      security_type: "AGRICULTURE",
      sector: "AGRICULTURE & SUGAR",
    },

    "BCL ENTERPRISE": {
      security_type: "AGRICULTURE",
      sector: "AGRICULTURE & SUGAR",
    },


    // ------------------------------
    // FUNDS / ETF
    // ------------------------------

    "TATAAML-TATAGOLD": {
      security_type: "FUND",
      sector: "COMMODITY ETF",
    },

    "TATAAML-TATSILV": {
      security_type: "FUND",
      sector: "COMMODITY ETF",
    },
  };


  // ====================================================
  // APPLY EXACT OVERRIDE
  // ====================================================

  if (overrides[name]) {
    return overrides[name];
  }


  // ====================================================
  // FUND / ETF FALLBACK
  // ====================================================

  if (
    sym.startsWith("INF") ||
    name.includes("ETF") ||
    name.includes("MUTUAL FUND") ||
    name.includes("FUND")
  ) {
    return {
      security_type: "FUND",
      sector: "MUTUAL FUND / ETF",
    };
  }


  // ====================================================
  // BANK FALLBACK
  // ====================================================

  if (
    name.includes("BANK")
  ) {
    return {
      security_type: "BANK",
      sector: "BANKING",
    };
  }


  // ====================================================
  // FINANCIAL FALLBACK
  // ====================================================

  const financialWords = [
    "FINANC",
    "CAPITAL",
    "INVESTMENT",
    "INSURANCE",
    "BROKING",
    "BROKER",
    "NBFC",
  ];

  if (
    financialWords.some(
      (word) => name.includes(word)
    )
  ) {
    return {
      security_type: "FINANCIAL",
      sector: "FINANCIAL SERVICES",
    };
  }


  // ====================================================
  // DEFENCE FALLBACK
  // ====================================================

  const defenceWords = [
    "DEFENCE",
    "DEFENSE",
    "AEROSPACE",
    "BEML",
    "MAZAGON",
    "SHIPYARD",
    "BHARAT DYNAMICS",
    "MIDHANI",
  ];

  if (
    defenceWords.some(
      (word) => name.includes(word)
    )
  ) {
    return {
      security_type: "DEFENCE",
      sector: "DEFENCE & AEROSPACE",
    };
  }


  // ====================================================
  // TECHNOLOGY FALLBACK
  // ====================================================

  const technologyWords = [
    "SOFTWARE",
    "TECHNOLOG",
    "INFOTECH",
    "DIGITAL",
    "COMPUTER",
    "SYSTEMS",
  ];

  if (
    technologyWords.some(
      (word) => name.includes(word)
    )
  ) {
    return {
      security_type: "TECHNOLOGY",
      sector: "IT & TECHNOLOGY",
    };
  }


  // ====================================================
  // PHARMA FALLBACK
  // ====================================================

  const pharmaWords = [
    "PHARMA",
    "PHARMACEUTICAL",
    "LIFESCIENCES",
    "HEALTH",
    "HEALTHCARE",
    "HOSPITAL",
    "LABORATOR",
  ];

  if (
    pharmaWords.some(
      (word) => name.includes(word)
    )
  ) {
    return {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    };
  }


  // ====================================================
  // ENERGY FALLBACK
  // ====================================================

  const energyWords = [
    "POWER",
    "ENERGY",
    "ELECTRIC",
    "ELECTRICITY",
    "SOLAR",
    "RENEWABLE",
  ];

  if (
    energyWords.some(
      (word) => name.includes(word)
    )
  ) {
    return {
      security_type: "ENERGY",
      sector: "POWER & ENERGY",
    };
  }


  // ====================================================
  // OIL / GAS FALLBACK
  // ====================================================

  const oilGasWords = [
    "GAS",
    "PETROLEUM",
    "OIL",
    "REFINER",
  ];

  if (
    oilGasWords.some(
      (word) => name.includes(word)
    )
  ) {
    return {
      security_type: "OIL_GAS",
      sector: "OIL & GAS",
    };
  }


  // ====================================================
  // METALS FALLBACK
  // ====================================================

  const metalsWords = [
    "STEEL",
    "MINING",
    "MINES",
    "METAL",
    "MINERAL",
    "ALUMINIUM",
    "ALUMINUM",
    "COPPER",
    "IRON",
  ];

  if (
    metalsWords.some(
      (word) => name.includes(word)
    )
  ) {
    return {
      security_type: "METALS_MINING",
      sector: "METALS & MINING",
    };
  }


  // ====================================================
  // INFRA FALLBACK
  // ====================================================

  const infraWords = [
    "INFRA",
    "INFRASTRUCTURE",
    "CONSTRUCTION",
    "PROJECTS",
    "BUILD",
    "ENGINEER",
    "ENGINEERING",
    "CEMENT",
  ];

  if (
    infraWords.some(
      (word) => name.includes(word)
    )
  ) {
    return {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    };
  }


  // ====================================================
  // AUTOMOBILE FALLBACK
  // ====================================================

  const autoWords = [
    "MOTOR",
    "MOTORS",
    "AUTOMOBILE",
    "AUTOMOTIVE",
    "MOBILITY",
    "MOTHERSON",
    "AUTO",
    "TYRE",
    "TIRES",
  ];

  if (
    autoWords.some(
      (word) => name.includes(word)
    )
  ) {
    return {
      security_type: "AUTOMOBILE",
      sector: "AUTOMOBILE & AUTO COMPONENTS",
    };
  }


  // ====================================================
  // CHEMICAL FALLBACK
  // ====================================================

  const chemicalWords = [
    "CHEMICAL",
    "FERTILIZER",
    "FERTILISER",
    "PETROCHEM",
  ];

  if (
    chemicalWords.some(
      (word) => name.includes(word)
    )
  ) {
    return {
      security_type: "CHEMICALS",
      sector: "CHEMICALS & FERTILIZERS",
    };
  }


  // ====================================================
  // CONSUMER FALLBACK
  // ====================================================

  const consumerWords = [
    "FOOD",
    "FOODS",
    "TEXTILE",
    "RETAIL",
    "JEWELLER",
    "JEWELLERY",
    "HOTEL",
  ];

  if (
    consumerWords.some(
      (word) => name.includes(word)
    )
  ) {
    return {
      security_type: "CONSUMER",
      sector: "CONSUMER",
    };
  }


  // ====================================================
  // DEFAULT
  // ====================================================

  return {
    security_type: "OTHER",
    sector: "OTHER",
  };
}


// ======================================================
// GET /api/classify-portfolio
// ======================================================

export async function GET() {

  try {

    const supabase =
      getSupabase();


    // ==================================================
    // GET HOLDINGS
    // ==================================================

    const {
      data: holdings,
      error: holdingsError,
    } = await supabase
      .from("holdings")
      .select("instrument_id");


    if (holdingsError) {

      return NextResponse.json({
        success: false,
        step: "holdings",
        error:
          holdingsError.message,
      });
    }


    // ==================================================
    // UNIQUE INSTRUMENT IDS
    // ==================================================

    const instrumentIds = [
      ...new Set(
        (holdings || [])
          .map(
            (item) =>
              item.instrument_id
          )
          .filter(Boolean)
      ),
    ];


    if (
      instrumentIds.length === 0
    ) {

      return NextResponse.json({
        success: false,
        step: "holdings",
        error:
          "No instruments found in holdings.",
      });
    }


    // ==================================================
    // GET INSTRUMENTS
    // ==================================================

    const {
      data: instruments,
      error: instrumentsError,
    } = await supabase
      .from("instruments")
      .select(
        "id, symbol, company_name, security_type, sector"
      )
      .in(
        "id",
        instrumentIds
      );


    if (instrumentsError) {

      return NextResponse.json({
        success: false,
        step: "instruments",
        error:
          instrumentsError.message,
      });
    }


    // ==================================================
    // CLASSIFY
    // ==================================================

    const results = [];
    const errors = [];
    const counts = {};


    for (
      const instrument of
        instruments || []
    ) {

      try {

        const classification =
          classifyStock(
            instrument.company_name,
            instrument.symbol
          );


        const {
          error: saveError,
        } = await supabase
          .from("instruments")
          .update({
            security_type:
              classification.security_type,

            sector:
              classification.sector,
          })
          .eq(
            "id",
            instrument.id
          );


        if (saveError) {

          errors.push({
            symbol:
              instrument.symbol,

            company_name:
              instrument.company_name,

            error:
              saveError.message,
          });

          continue;
        }


        const type =
          classification.security_type;


        counts[type] =
          (counts[type] || 0) + 1;


        results.push({

          symbol:
            instrument.symbol,

          company_name:
            instrument.company_name,

          instrument_id:
            instrument.id,

          security_type:
            classification.security_type,

          sector:
            classification.sector,
        });


      } catch (error) {

        errors.push({

          symbol:
            instrument.symbol,

          company_name:
            instrument.company_name,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }
    }


    // ==================================================
    // FINAL RESPONSE
    // ==================================================

    return NextResponse.json({

      success: true,

      message:
        "Portfolio classification completed successfully.",

      summary: {

        total_instruments:
          instrumentIds.length,

        classified:
          results.length,

        failed:
          errors.length,

        types:
          counts,
      },

      results,

      errors,
    });


  } catch (error) {

    console.error(
      "classify-portfolio error:",
      error
    );


    return NextResponse.json(
      {
        success: false,

        step: "server",

        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      {
        status: 500,
      }
    );
  }
}
