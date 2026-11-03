import { NextResponse, type NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";
import { processJobs } from "@/lib/jobs/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Called by Vercel Cron every 5 minutes (vercel.json). Authenticated with CRON_SECRET. */
export async function GET(request: NextRequest) {
  const secret = serverEnv.cronSecret();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await processJobs({ timeBudgetMs: 240_000 });
  return NextResponse.json({ ok: true, ...summary });
}
