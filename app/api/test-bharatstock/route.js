import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch(
      "https://api.bharatstockapi.com/api/v1/stock/financials?symbol=BEL",
      {
        headers: {
          "X-API-Key": process.env.BHARATSTOCK_API_KEY,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );

    const data = await response.json();

    return NextResponse.json({
      status: response.status,
      success: response.ok,
      data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
