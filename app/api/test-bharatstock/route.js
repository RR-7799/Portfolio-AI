import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch(
      "https://bharatstockapi.com/v1/stocks/BEL/shareholding",
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

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return NextResponse.json({
      status: response.status,
      success: response.ok,
      data,
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
