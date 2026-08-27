import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch(
      "https://bharatstockapi.com/v1/stocks/BEL/financials?period_type=annual&page=1&page_size=5",
      {
        method: "GET",
        headers: {
          "X-API-Key": process.env.BHARATSTOCK_API_KEY,
          "Accept": "application/json",
        },
        cache: "no-store",
      }
    );

    const text = await response.text();

    return NextResponse.json({
      success: response.ok,
      status: response.status,
      raw_response: text,
    });

  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
