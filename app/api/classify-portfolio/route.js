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

function classifyInstrument(companyName, symbol, instrumentType) {
  const name = String(companyName || "")
    .toUpperCase()
    .trim();

  const sym = String(symbol || "")
    .toUpperCase()
    .trim();

  const type = String(instrumentType || "")
    .toUpperCase()
    .trim();


  // ====================================================
  // ETF / MUTUAL FUND / FUND
  // ====================================================

  const fundWords = [
    "ETF",
    "MUTUAL FUND",
    "FUND",
    "FUND MANAGEMENT",
    "TATAGOLD",
    "TATSILV",
  ];

  if (
    type.includes("ETF") ||
    type.includes("MF") ||
    fundWords.some((word) =>
      name.includes(word)
    )
  ) {
    return {
      security_type: "FUND",
      sector: "MUTUAL FUNDS & ETF",
    };
  }


  // ====================================================
  // BANK
  // ====================================================

  const bankWords = [
    "BANK",
    "BANKING",
  ];

  if (
    bankWords.some((word) =>
      name.includes(word)
    )
  ) {
    return {
      security_type: "BANK",
      sector: "BANKING",
    };
  }


  // ====================================================
  // FINANCIAL SERVICES
  // ====================================================

  const financialWords = [
    "FINANC",
    "FINANCIAL",
    "NBFC",
    "HOUSING FINANCE",
    "CAPITAL",
    "INVESTMENT",
    "ASSET MANAGEMENT",
    "FUNDS MANAGEMENT",
    "BROKING",
    "BROKER",
    "INSURANCE",
    "LIFE INSURANCE",
    "MONEY",
    "MORTGAGE",
  ];

  if (
    financialWords.some((word) =>
      name.includes(word)
    )
  ) {
    return {
      security_type: "FINANCIAL",
      sector: "FINANCIAL SERVICES",
    };
  }


  // ====================================================
  // DEFENCE / AEROSPACE
  // ====================================================

  const defenceWords = [
    "DEFENCE",
    "DEFENSE",
    "AEROSPACE",
    "BHARAT ELECTRONICS",
    "HINDUSTAN AERONAUTICS",
    "BEML",
    "MAZAGON",
    "COCHIN SHIPYARD",
    "GARDEN REACH",
    "BHARAT DYNAMICS",
    "MIDHANI",
    "SOLAR INDUSTRIES",
  ];

  if (
    defenceWords.some((word) =>
      name.includes(word)
    )
  ) {
    return {
      security_type: "DEFENCE",
      sector: "DEFENCE & AEROSPACE",
    };
  }


  // ====================================================
  // PHARMA / HEALTHCARE
  // ====================================================

  const pharmaWords = [
    "PHARMA",
    "PHARMACEUTICAL",
    "LIFESCIENCES",
    "LIFE SCIENCES",
    "BIOCON",
    "HEALTH",
    "HEALTHCARE",
    "HOSPITAL",
    "HOSPITALS",
    "LABORATORIES",
    "LABS",
    "LIFESCIENCE",
  ];

  if (
    pharmaWords.some((word) =>
      name.includes(word)
    )
  ) {
    return {
      security_type: "PHARMA_HEALTHCARE",
      sector: "PHARMA & HEALTHCARE",
    };
  }


  // ====================================================
  // IT / TECHNOLOGY
  // ====================================================

  const technologyWords = [
    "SOFTWARE",
    "TECHNOLOG",
    "INFOTECH",
    "IT SERVICES",
    "SYSTEMS",
    "DIGITAL",
    "COMPUTER",
    "TECHNOLOGY",
  ];

  if (
    technologyWords.some((word) =>
      name.includes(word)
    )
  ) {
    return {
      security_type: "TECHNOLOGY",
      sector: "IT & TECHNOLOGY",
    };
  }


  // ====================================================
  // POWER / ENERGY
  // ====================================================

  const energyWords = [
    "POWER",
    "ENERGY",
    "ELECTRIC",
    "ELECTRICITY",
    "SOLAR",
    "RENEWABLE",
    "GREEN ENERGY",
    "GREENPOWER",
  ];

  if (
    energyWords.some((word) =>
      name.includes(word)
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

  const oilGasWords = [
    "GAS",
    "PETROLEUM",
    "OIL",
    "REFINER",
    "REFINERY",
  ];

  if (
    oilGasWords.some((word) =>
      name.includes(word)
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
    metalsWords.some((word) =>
      name.includes(word)
    )
  ) {
    return {
      security_type: "METALS_MINING",
      sector: "METALS & MINING",
    };
  }


  // ====================================================
  // CEMENT / CONSTRUCTION / INFRA
  // ====================================================

  const constructionWords = [
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
    constructionWords.some((word) =>
      name.includes(word)
    )
  ) {
    return {
      security_type: "CONSTRUCTION_INFRA",
      sector: "CONSTRUCTION & INFRASTRUCTURE",
    };
  }


  // ====================================================
  // AUTOMOBILE / AUTO COMPONENTS
  // ====================================================

  const autoWords = [
    "MOTOR",
    "MOTORS",
    "AUTOMOBILE",
    "AUTOMOTIVE",
    "AUTO",
    "MOBILITY",
    "MOTHERSON",
    "TYRE",
    "TIRES",
    "PRECISION",
  ];

  if (
    autoWords.some((word) =>
      name.includes(word)
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

  const chemicalWords = [
    "CHEMICAL",
    "FERTILIZER",
    "FERTILISER",
    "PETROCHEM",
    "CHEMICALS",
  ];

  if (
    chemicalWords.some((word) =>
      name.includes(word)
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

  const consumerWords = [
    "FOODS",
    "FOOD",
    "TEXTILE",
    "RETAIL",
    "JEWELLERS",
    "JEWELLERY",
    "HOTELS",
    "HOTEL",
    "BEVERAGE",
    "CONSUMER",
  ];

  if (
    consumerWords.some((word) =>
      name.includes(word)
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
    const supabase = getSupabase();


    // ==================================================
    // 1. GET HOLDINGS
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
        error: holdingsError.message,
      });
    }


    if (
      !holdings ||
      holdings.length === 0
    ) {
      return NextResponse.json({
        success: false,
        step: "holdings",
        error: "No holdings found.",
      });
    }


    // ==================================================
    // 2. UNIQUE INSTRUMENT IDs
    // ==================================================

    const instrumentIds = [
      ...new Set(
        holdings
          .map(
            (holding) =>
              holding.instrument_id
          )
          .filter(Boolean)
      ),
    ];


    // ==================================================
    // 3. GET INSTRUMENTS
    // ==================================================

    const {
      data: instruments,
      error: instrumentsError,
    } = await supabase
      .from("instruments")
      .select(
        "id, symbol, company_name, instrument_type, sector, security_type"
      )
      .in(
        "id",
        instrumentIds
      );


    if (instrumentsError) {
      return NextResponse.json({
        success: false,
        step: "instruments",
        error: instrumentsError.message,
      });
    }


    if (
      !instruments ||
      instruments.length === 0
    ) {
      return NextResponse.json({
        success: false,
        step: "instruments",
        error:
          "No instruments found for holdings.",
      });
    }


    // ==================================================
    // 4. CLASSIFY
    // ==================================================

    const results = [];
    const errors = [];

    let updated = 0;
    let unchanged = 0;


    for (
      const instrument of instruments
    ) {

      try {

        const classification =
          classifyInstrument(
            instrument.company_name,
            instrument.symbol,
            instrument.instrument_type
          );


        // ----------------------------------------------
        // SAVE
        // ----------------------------------------------

        const {
          data: saved,
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
          )
          .select(
            "id, symbol, company_name, instrument_type, sector, security_type"
          )
          .single();


        if (saveError) {

          errors.push({
            symbol:
              instrument.symbol,

            company_name:
              instrument.company_name,

            instrument_id:
              instrument.id,

            error:
              saveError.message,
          });

          continue;
        }


        const wasChanged =
          instrument.security_type !==
            classification.security_type ||
          instrument.sector !==
            classification.sector;


        if (wasChanged) {
          updated++;
        } else {
          unchanged++;
        }


        results.push({
          symbol:
            instrument.symbol,

          company_name:
            instrument.company_name,

          instrument_id:
            instrument.id,

          previous: {
            security_type:
              instrument.security_type,

            sector:
              instrument.sector,
          },

          classification,

          saved,
        });

      } catch (error) {

        errors.push({
          symbol:
            instrument.symbol,

          company_name:
            instrument.company_name,

          instrument_id:
            instrument.id,

          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }
    }


    // ==================================================
    // 5. CREATE CLASSIFICATION SUMMARY
    // ==================================================

    const summary = {};


    for (
      const result of results
    ) {

      const type =
        result.classification
          .security_type;

      summary[type] =
        (summary[type] || 0) + 1;
    }


    // ==================================================
    // 6. RESPONSE
    // ==================================================

    return NextResponse.json({

      success: true,

      message:
        "Portfolio classification completed successfully.",

      summary: {
        holdings:
          holdings.length,

        unique_instruments:
          instrumentIds.length,

        instruments_processed:
          results.length,

        updated,

        unchanged,

        errors:
          errors.length,

        by_security_type:
          summary,
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
