import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getReport } from "@/lib/reports/definitions";
import { parseReportFilters } from "@/lib/reports/filters";
import { toCsv, toPdf, toXlsx } from "@/lib/reports/export";
import { logAudit } from "@/lib/audit";
import { currentMonthStart, formatMonth } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Report exports run on the user's own session, so RLS limits rows exactly as on screen. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const profile = await getProfile();
  const { key } = await params;
  const report = getReport(key);
  if (!report) return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  if (!profile || !report.roles.includes(profile.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const filters = parseReportFilters((k) => sp.get(k));
  if (report.filters.includes("month") && !filters.month && !filters.year && !filters.period) filters.month = currentMonthStart();
  if (profile.role === "branch_manager") filters.branch = profile.branch_id ?? undefined;
  const supabase = await createClient();
  const rows = await report.load(supabase, filters);
  const subtitle = [filters.month ? formatMonth(filters.month) : filters.year, `${rows.length} rows`, `Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Colombo" })}`].filter(Boolean).join(" · ");
  const base = `${report.key}-${(filters.month ?? filters.year ?? "all").slice(0, 7)}`;
  const format = sp.get("format") ?? "xlsx";
  await logAudit({ actorId: profile.id, action: "report.exported", entityType: "report", summary: `${report.title} (${format}, ${rows.length} rows)` });

  if (format === "csv") {
    return new NextResponse(toCsv(report.columns, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"`, "cache-control": "no-store" } });
  }
  if (format === "pdf") {
    return new NextResponse(await toPdf(report.title, subtitle, report.columns, rows), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${base}.pdf"`, "cache-control": "no-store" } });
  }
  return new NextResponse(await toXlsx(report.title, subtitle, report.columns, rows), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${base}.xlsx"`, "cache-control": "no-store" },
  });
}
