import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

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
// CLASSIFY STOCK
// ======================================================

function classifyStock(companyName, symbol) {

  const name =
    String(companyName || "")
      .toUpperCase()
      .trim();

  const sym =
    String(symbol || "")
      .toUpperCase()
      .trim();


  // ====================================================
  // BANKS
  // ====================================================

  const bankWords = [
    "BANK",
    "BANKING",
  ];

  if (
    bankWords.some(
      (word) =>
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
  ];

  if (
    financialWords.some(
      (word) =>
        name.includes(word)
    )
  ) {
    return {
      security_type:
        "FINANCIAL",
      sector:
        "FINANCIAL SERVICES",
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
  ];

  if (
    pharmaWords.some(
      (word) =>
        name.includes(word)
    )
  ) {
    return {
      security_type:
        "PHARMA_HEALTHCARE",
      sector:
        "PHARMA & HEALTHCARE",
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
  ];

  if (
    technologyWords.some(
      (word) =>
        name.includes(word)
    )
  ) {
    return {
      security_type:
        "TECHNOLOGY",
      sector:
        "IT & TECHNOLOGY",
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
  ];

  if (
    energyWords.some(
      (word) =>
        name.includes(word)
    )
  ) {
    return {
      security_type:
        "ENERGY",
      sector:
        "POWER & ENERGY",
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
  ];

  if (
    oilGasWords.some(
      (word) =>
        name.includes(word)
    )
  ) {
    return {
      security_type:
        "OIL_GAS",
      sector:
        "OIL & GAS",
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
    metalsWords.some(
      (word) =>
        name.includes(word)
    )
  ) {
    return {
      security_type:
        "METALS_MINING",
      sector:
        "METALS & MINING",
    };
  }


  // ====================================================
  // CEMENT / CONSTRUCTION
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
    constructionWords.some(
      (word) =>
        name.includes(word)
    )
  ) {
    return {
      security_type:
        "CONSTRUCTION_INFRA",
      sector:
        "CONSTRUCTION & INFRASTRUCTURE",
    };
  }


  // ====================================================
  // DEFENCE
  // ====================================================

  const defenceWords = [
    "DEFENCE",
    "DEFENSE",
    "AEROSPACE",
  ];

  if (
    defenceWords.some(
      (word) =>
        name.includes(word)
    )
  ) {
    return {
      security_type:
        "DEFENCE",
      sector:
        "DEFENCE & AEROSPACE",
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
  ];

  if (
    chemicalWords.some(
      (word) =>
        name.includes(word)
    )
  ) {
    return {
      security_type:
        "CHEMICALS",
      sector:
        "CHEMICALS & FERTILIZERS",
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
  ];

  if (
    autoWords.some(
      (word) =>
        name.includes(word)
    )
  ) {
    return {
      security_type:
        "AUTOMOBILE",
      sector:
        "AUTOMOBILE & AUTO COMPONENTS",
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
  ];

  if (
    consumerWords.some(
      (word) =>
        name.includes(word)
    )
  ) {
    return {
      security_type:
        "CONSUMER",
      sector:
        "CONSUMER",
    };
  }


  // ====================================================
  // DEFAULT
  // ====================================================

  return {
    security_type:
      "OTHER",

    sector:
      "OTHER",
  };
}


// ======================================================
// GET /api/classify-stock
// ======================================================

export async function GET(request) {

  try {

    const supabase =
      getSupabase();

    const { searchParams } =
      new URL(request.url);

    const symbol =
      searchParams.get(
        "symbol"
      );

    const instrumentId =
      searchParams.get(
        "instrument_id"
      );


    if (
      !symbol &&
      !instrumentId
    ) {
      return NextResponse.json({
        success: false,
        error:
          "Provide symbol or instrument_id.",
        example:
          "/api/classify-stock?symbol=INE263A01024",
      });
    }


    // ==================================================
    // FIND INSTRUMENT
    // ==================================================

    let query =
      supabase
        .from("instruments")
        .select(
          "id, symbol, company_name"
        )
        .limit(1);


    if (instrumentId) {

      query =
        query.eq(
          "id",
          instrumentId
        );

    } else {

      query =
        query.eq(
          "symbol",
          symbol
        );
    }


    const {
      data,
      error,
    } = await query;


    if (error) {

      return NextResponse.json({
        success: false,
        step:
          "find_instrument",
        error:
          error.message,
      });
    }


    const instrument =
      data?.[0];


    if (!instrument) {

      return NextResponse.json({
        success: false,
        step:
          "find_instrument",
        error:
          "Instrument not found.",
      });
    }


    // ==================================================
    // CLASSIFY
    // ==================================================

    const classification =
      classifyStock(
        instrument.company_name,
        instrument.symbol
      );


    // ==================================================
    // SAVE
    // ==================================================

    const {
      data: saved,
      error:
        saveError,
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
      .select()
      .single();


    if (saveError) {

      return NextResponse.json({
        success: false,
        step:
          "save_classification",
        error:
          saveError.message,
      });
    }


    return NextResponse.json({

      success: true,

      message:
        "Stock classified successfully.",

      stock: {
        symbol:
          instrument.symbol,

        company_name:
          instrument.company_name,

        instrument_id:
          instrument.id,
      },

      classification,

      saved,
    });


  } catch (error) {

    return NextResponse.json(
      {
        success: false,
        step:
          "server",
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
