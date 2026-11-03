import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ADMIN_ROLES, getProfile } from "@/lib/auth";
import { mergePdfs } from "@/lib/payslip/pdf";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Bulk monthly download: every generated payslip for a month (optionally one branch) merged into one PDF. Admins only. */
export async function GET(request: NextRequest) {
  const profile = await getProfile();
  if (!profile || !ADMIN_ROLES.includes(profile.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const month = request.nextUrl.searchParams.get("month");
  const branch = request.nextUrl.searchParams.get("branch");
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month required (YYYY-MM)" }, { status: 400 });
  const supabase = await createClient();
  let q = supabase.from("payslips").select("storage_path, reference_number, payroll_records!inner(branch_id, employee_code)")
    .eq("payroll_month", `${month}-01`).eq("status", "generated").order("reference_number").limit(2000);
  if (branch) q = q.eq("payroll_records.branch_id", branch);
  const { data } = await q;
  if (!data?.length) return NextResponse.json({ error: "No generated payslips for this selection" }, { status: 404 });
  const admin = createAdminClient();
  const files: Uint8Array[] = [];
  for (const s of data) {
    const f = await admin.storage.from("payslips").download(s.storage_path!);
    if (f.data) files.push(new Uint8Array(await f.data.arrayBuffer()));
  }
  const merged = await mergePdfs(files);
  await logAudit({ actorId: profile.id, action: "payslips.bulk_download", entityType: "payslip", summary: `${files.length} payslips for ${month}${branch ? ` (branch ${branch})` : ""}` });
  return new NextResponse(Buffer.from(merged), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="payslips-${month}.pdf"`, "cache-control": "no-store" },
  });
}
