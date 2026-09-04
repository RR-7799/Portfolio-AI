import { NextResponse } from "next/server";
import { calculateMarketRegime, ENGINE_VERSION } from "../../lib/market-regime";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const result = await calculateMarketRegime();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { success: false, engine_version: ENGINE_VERSION, error: error?.message || "Market regime calculation failed." },
      { status: 500 }
    );
  }
}
