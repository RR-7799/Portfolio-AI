import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
const ENGINE_VERSION = "copilot_memory_v1_0";
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function authenticate(request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

export async function GET(request) {
  try {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Invalid sign-in session." }, { status:401 });
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(Number(searchParams.get("limit") || 20), 1), 100);
    const { data, error } = await supabase.from("copilot_memory").select("id,created_at,question,answer,market_regime,portfolio_value,metadata").eq("user_id", user.id).order("created_at", { ascending:false }).limit(limit);
    if (error) throw new Error(error.message);
    return NextResponse.json({ success:true, engine_version:ENGINE_VERSION, items:data || [] });
  } catch (error) {
    return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:error?.message || "Unable to load Copilot memory." }, { status:500 });
  }
}

export async function POST(request) {
  try {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Invalid sign-in session." }, { status:401 });
    const body = await request.json();
    const question = String(body?.question || "").trim();
    const answer = String(body?.answer || "").trim();
    if (!question || !answer) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Question and answer are required." }, { status:400 });
    const record = {
      user_id:user.id,
      question,
      answer,
      market_regime:body?.market_regime ? String(body.market_regime) : null,
      portfolio_value:Number.isFinite(Number(body?.portfolio_value)) ? Number(body.portfolio_value) : null,
      metadata:body?.metadata && typeof body.metadata === "object" ? body.metadata : {},
    };
    const { data, error } = await supabase.from("copilot_memory").insert(record).select("id,created_at,question,answer,market_regime,portfolio_value,metadata").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ success:true, engine_version:ENGINE_VERSION, item:data });
  } catch (error) {
    return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:error?.message || "Unable to save Copilot memory." }, { status:500 });
  }
}

export async function DELETE(request) {
  try {
    const user = await authenticate(request);
    if (!user) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Invalid sign-in session." }, { status:401 });
    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get("id") || "").trim();
    if (!id) return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:"Memory id is required." }, { status:400 });
    const { error } = await supabase.from("copilot_memory").delete().eq("id", id).eq("user_id", user.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ success:true, engine_version:ENGINE_VERSION, deleted:id });
  } catch (error) {
    return NextResponse.json({ success:false, engine_version:ENGINE_VERSION, error:error?.message || "Unable to delete memory." }, { status:500 });
  }
}
