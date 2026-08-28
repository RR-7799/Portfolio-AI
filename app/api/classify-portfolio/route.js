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
  // FUND / ETF
  // ====================================================

  if (
    sym.startsWith("INF") ||
    name.includes("ETF") ||
    name.includes("MUTUAL FUND") ||
    name.includes("FUND MANAGEMENT")
  ) {
    return {
      security_type: "FUND",
      sector: "MUTUAL FUND / ETF",
    };
  }


  // ====================================================
  // BANKS
  // ====================================================

  const bankNames = [
    "HDFC BANK",
    "FEDERAL BANK",
    "IDBI BANK",
    "INDIAN OVERSEAS BANK",
    "INDUSIND BANK",
    "STATE BANK OF INDIA",
  ];

  if (
    bankNames.some(
      (item) => name.includes(item)
    ) ||
    name.includes("BANK LTD")
  ) {
    return {
      security_type: "BANK",
      sector: "BANKING",
    };
  }


  // ====================================================
  // FINANCIAL SERVICES
  // ====================================================

  const financialNames = [
    "IFCI",
    "INDIAN RAILWAY FIN",
    "JM FIN",
    "SBI FUNDS",
    "MOTILAL OSWAL",
    "HOUSING FINANCE",
    "FINANCIAL",
    "FINANC",
    "CAPITAL",
    "INVESTMENT",
    "INSURANCE",
    "BROKING",
    "BROKER",
    "NBFC",
  ];

  if (
    financialNames.some(
      (item) => name.includes(item)
    )
  ) {
    return {
      security_type: "FINANCIAL",
      sector: "FINANCIAL SERVICES",
    };
  }


  // ====================================================
  // DEFENCE
  // ====================================================

  const defenceNames = [
    "BHARAT ELECTRONICS",
    "GARDEN REACH",
    "DEFENCE",
    "DEFENSE",
    "AEROSPACE",
    "HINDUSTAN AERONAUTICS",
    "BEML",
    "MAZAGON",
    "COCHIN SHIPYARD",
    "BHARAT DYNAMICS",
    "MIDHANI",
    "SOLAR INDUSTRIES",
  ];

  if (
    defenceNames.some(
      (item) => name.includes(item)
    )
  ) {
    return {
      security_type: "DEFENCE",
      sector: "DEFENCE & AEROSPACE",
    };
  }


  // ====================================================
  // IT / TECHNOLOGY
  // ====================================================

  const technologyNames = [
    "TATA CONSULTANCY",
    "WIPRO",
    "FCS SOFTWARE",
    "INFOTECH",
    "TECHNOLOG",
    "SOFTWARE",
    "IT SERVICES",
    "DIGITAL",
    "COMPUTER",
  ];

  if (
    technologyNames.some(
      (item) => name.includes(item)
    )
  ) {
    return {
      security_type: "TECHNOLOGY",
      sector: "IT & TECHNOLOGY",
    };
  }


  // ====================================================
  // PHARMA / HEALTHCARE
  // ====================================================

  const pharmaNames = [
    "BIOCON",
    "PHARMA",
    "PHARMACEUTICAL",
    "LIFESCIENCES",
    "LIFE SCIENCES",
    "HEALTH",
    "HEALTHCARE",
    "HOSPITAL",
    "HOSPITALS",
    "LABORATORIES",
    "LABS",
    "NARAYANA HRUDAYALAYA",
    "KOPRAN",
    "MARKSANS",
  ];

  if (
    pharmaNames.some(
      (item) => name.includes(item)
    )
  ) {
    return {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    };
  }


  // ====================================================
  // POWER / ENERGY
  // ====================================================

  const energyNames = [
    "AMARA RAJA ENERGY",
    "GUJARAT ENERGY",
    "NTPC",
    "NHPC",
    "TATA POWER",
    "SUZLON",
    "JAIPRAKASH POWER",
    "POWER",
    "ENERGY",
    "ELECTRIC",
    "ELECTRICITY",
    "SOLAR",
    "RENEWABLE",
  ];

  if (
    energyNames.some(
      (item) => name.includes(item)
    )
  ) {
    return {
      security_type: "ENERGY",
      sector: "POWER & ENERGY",
    };
  }


  // ====================================================
  // OIL / GAS
  // ====================================================

  const oilGasNames = [
    "GAIL",
    "CASTROL",
    "PETROLEUM",
    "OIL",
    "GAS",
    "REFINER",
  ];

  if (
    oilGasNames.some(
      (item) => name.includes(item)
    )
  ) {
    return {
      security_type: "OIL_GAS",
      sector: "OIL & GAS",
    };
  }


  // ====================================================
  // METALS / MINING
  // ====================================================

  const metalsNames = [
    "TATA STEEL",
    "SAIL",
    "NMDC",
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
    metalsNames.some(
      (item) => name.includes(item)
    )
  ) {
    return {
      security_type: "METALS_MINING",
      sector: "METALS & MINING",
    };
  }


  // ====================================================
  // INFRA / CONSTRUCTION
  // ====================================================

  const infraNames = [
    "IRB",
    "NBCC",
    "NCC",
    "PSP PROJECTS",
    "ASHOKA BUILD",
    "LLOYDS ENGINEER",
    "JSW INFRA",
    "GMR",
    "ENVIRO INFRA",
    "JK LAKSHMI CEMENT",
    "CEMENT",
    "INFRA",
    "INFRASTRUCTURE",
    "CONSTRUCTION",
    "PROJECTS",
    "BUILD",
    "BUILDERS",
    "ENGINEER",
    "ENGINEERING",
  ];

  if (
    infraNames.some(
      (item) => name.includes(item)
    )
  ) {
    return {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    };
  }


  // ====================================================
  // AUTOMOBILE
  // ====================================================

  const autoNames = [
    "TATA MOTORS",
    "TATA MOTORS PASS",
    "MOTHERSON",
    "SONA BLW",
    "AUTOMOBILE",
    "AUTOMOTIVE",
    "MOTOR",
    "MOBILITY",
    "AUTO",
    "TYRE",
    "TIRES",
  ];

  if (
    autoNames.some(
      (item) => name.includes(item)
    )
  ) {
    return {
      security_type: "AUTOMOBILE",
      sector: "AUTOMOBILE & AUTO COMPONENTS",
    };
  }


  // ====================================================
  // CHEMICALS / FERTILIZERS
  // ====================================================

  const chemicalNames = [
    "DEEPAK FERTILIZERS",
    "KREBS BIOCHEMICAL",
    "CHEMICAL",
    "FERTILIZER",
    "FERTILISER",
    "PETROCHEM",
  ];

  if (
    chemicalNames.some(
      (item) => name.includes(item)
    )
  ) {
    return {
      security_type: "CHEMICALS",
      sector: "CHEMICALS & FERTILIZERS",
    };
  }


  // ====================================================
  // CONSUMER
  // ====================================================

  const consumerNames = [
    "ITC HOTELS",
    "ITC LIMITED",
    "KALYAN JEWELLERS",
    "TRIDENT",
    "TUNI TEXTILE",
    "MISHTANN FOODS",
    "JEWELLERS",
    "JEWELLERY",
    "TEXTILE",
    "RETAIL",
    "HOTEL",
    "FOODS",
    "FOOD",
  ];

  if (
    consumerNames.some(
      (item) => name.includes(item)
    )
  ) {
    return {
      security_type: "CONSUMER",
      sector: "CONSUMER",
    };
  }


  // ====================================================
  // OTHER
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
    const supabase = getSupabase();


    // --------------------------------------------------
    // GET HOLDINGS
    // --------------------------------------------------

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
        error: holdingsError.message,
      });
    }


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


    if (instrumentIds.length === 0) {
      return NextResponse.json({
        success: false,
        step: "holdings",
        error:
          "No instruments found in holdings.",
      });
    }


    // --------------------------------------------------
    // GET INSTRUMENTS
    // --------------------------------------------------

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


    // --------------------------------------------------
    // CLASSIFY
    // --------------------------------------------------

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


    // --------------------------------------------------
    // RESPONSE
    // --------------------------------------------------

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
