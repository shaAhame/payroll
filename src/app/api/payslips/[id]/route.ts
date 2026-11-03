import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Payslip download. Access is decided by RLS on the user's own session
 * (admins: any; employees: only their own generated payslips); then a
 * 60-second signed URL to the private bucket is issued.
 */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const supabase = await createClient();
  const { data: slip } = await supabase.from("payslips").select("storage_path, status, reference_number").eq("id", id).maybeSingle();
  if (!slip || slip.status !== "generated" || !slip.storage_path) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { data, error } = await createAdminClient().storage.from("payslips").createSignedUrl(slip.storage_path, 60, { download: `${slip.reference_number}.pdf` });
  if (error || !data) return NextResponse.json({ error: "unavailable" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
