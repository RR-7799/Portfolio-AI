import { NextResponse } from "next/server";

function hasPipelineSecret(request) {
  const secret = process.env.PIPELINE_SECRET || "";
  if (!secret) return false;
  const header = request.headers.get("x-pipeline-secret") || "";
  const auth = request.headers.get("authorization") || "";
  return header === secret || auth === `Bearer ${secret}`;
}

export function middleware(request) {
  const path = request.nextUrl.pathname;
  if (["/api/calculate-score", "/api/sync-upstox-fundamentals"].includes(path)) {
    if (!hasPipelineSecret(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/calculate-score", "/api/sync-upstox-fundamentals"] };
