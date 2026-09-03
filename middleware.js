import { NextResponse } from "next/server";

export function middleware(request) {
  if (request.nextUrl.pathname === "/api/calculate-score") {
    const secret = process.env.PIPELINE_SECRET || "";
    const header = request.headers.get("x-pipeline-secret") || "";
    const auth = request.headers.get("authorization") || "";
    const authorized = secret && (header === secret || auth === `Bearer ${secret}`);
    if (!authorized) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/calculate-score"] };
