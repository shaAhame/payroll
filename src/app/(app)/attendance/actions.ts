"use server";
import { revalidatePath } from "next/cache";
import ExcelJS from "exceljs";
import { ADMIN_ROLES, requireRole, STAFF_ROLES } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { createClient } from "@/lib/supabase/server";
import { allocationSchema, attendanceSchema } from "@/lib/validation/schemas";
import { logAudit } from "@/lib/audit";
import { recalcAfterChange, recalcNote } from "@/lib/recalc";
import { toMonthStart } from "@/lib/format";

async function employeeContext(supabase: Awaited<ReturnType<typeof createClient>>, employeeId: string) {
  const emp = check(await supabase.from("employees").select("id, branch_id, shift_id, shifts(start_time), branches(default_shift_id)").eq("id", employeeId).single()) as unknown as {
    id: string; branch_id: string; shift_id: string | null; shifts: { start_time: string } | null; branches: { default_shift_id: string | null } | null;
  };
  let shiftStart = emp.shifts?.start_time ?? null;
  if (!shiftStart && emp.branches?.default_shift_id) {
    const s = (await supabase.from("shifts").select("start_time").eq("id", emp.branches.default_shift_id).maybeSingle()).data;
    shiftStart = s?.start_time ?? null;
  }
  return { branchId: emp.branch_id, shiftStart };
}

export async function saveAttendance(input: unknown, id?: string) {
  return runAction(async () => {
    const profile = await requireRole(STAFF_ROLES);
    const v = attendanceSchema.parse(input);
    const supabase = await createClient();
    const ctx = await employeeContext(supabase, v.employee_id);
    const row = { ...v, branch_id: ctx.branchId, shift_start_time: v.shift_start_time ?? ctx.shiftStart, updated_by: profile.id };
    if (id) {
      const before = check(await supabase.from("attendance").select("*").eq("id", id).single());
      check(await supabase.from("attendance").update(row).eq("id", id));
      await logAudit({ actorId: profile.id, action: "attendance.updated", entityType: "attendance", entityId: id, oldValues: { status: before.status, check_in_time: before.check_in_time }, newValues: { status: v.status, check_in_time: v.check_in_time } });
    } else {
      const existing = (await supabase.from("attendance").select("id").eq("employee_id", v.employee_id).eq("work_date", v.work_date).maybeSingle()).data;
      if (existing) throw new Error("Attendance for this employee and date already exists. Edit the existing record instead.");
      check(await supabase.from("attendance").insert({ ...row, created_by: profile.id }));
    }
    const r = await recalcAfterChange(profile, supabase, [v.employee_id], [toMonthStart(v.work_date)]);
    revalidatePath("/attendance");
    return { ok: true as const, message: `Attendance saved${recalcNote(r)}` };
  });
}

export async function deleteAttendance(id: string) {
  return runAction(async () => {
    const profile = await requireRole(STAFF_ROLES);
    const supabase = await createClient();
    const before = check(await supabase.from("attendance").select("employee_id, work_date, status").eq("id", id).single());
    check(await supabase.from("attendance").delete().eq("id", id));
    await logAudit({ actorId: profile.id, action: "attendance.deleted", entityType: "attendance", entityId: id, oldValues: before });
    await recalcAfterChange(profile, supabase, [before.employee_id], [toMonthStart(before.work_date)]);
    revalidatePath("/attendance");
    return { ok: true as const, message: "Attendance deleted" };
  });
}

export async function setLateWaiver(id: string, waive: boolean, reason?: string) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    if (waive && (!reason || reason.trim().length < 3)) throw new Error("A reason is required to waive a late deduction.");
    const supabase = await createClient();
    const rec = check(await supabase.from("attendance").update({
      late_waived: waive, late_waiver_reason: waive ? reason!.trim() : null, late_waived_by: waive ? profile.id : null,
    }).eq("id", id).select("employee_id, work_date").single());
    await logAudit({ actorId: profile.id, action: waive ? "attendance.late_waived" : "attendance.late_waiver_removed", entityType: "attendance", entityId: id, summary: reason });
    const r = await recalcAfterChange(profile, supabase, [rec.employee_id], [toMonthStart(rec.work_date)]);
    revalidatePath("/attendance");
    return { ok: true as const, message: `${waive ? "Late deduction waived" : "Waiver removed"}${recalcNote(r)}` };
  });
}

/** Mark the same status for many employees on one date (e.g. a public holiday or weekly off). */
export async function bulkMarkStatus(input: { work_date: string; status: string; branch_id?: string }) {
  return runAction(async () => {
    const profile = await requireRole(STAFF_ROLES);
    if (!["weekly_off", "public_holiday"].includes(input.status)) throw new Error("Bulk marking supports Weekly Off and Public Holiday.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.work_date)) throw new Error("Select a date.");
    const supabase = await createClient();
    let q = supabase.from("employees").select("id, branch_id").eq("employment_status", "active");
    if (input.branch_id) q = q.eq("branch_id", input.branch_id);
    const emps = check(await q) as { id: string; branch_id: string }[];
    const existing = new Set((check(await supabase.from("attendance").select("employee_id").eq("work_date", input.work_date)) as { employee_id: string }[]).map((r) => r.employee_id));
    const rows = emps.filter((e) => !existing.has(e.id)).map((e) => ({ employee_id: e.id, branch_id: e.branch_id, work_date: input.work_date, status: input.status, created_by: profile.id }));
    if (rows.length) check(await supabase.from("attendance").insert(rows));
    await recalcAfterChange(profile, supabase, rows.map((r) => r.employee_id));
    revalidatePath("/attendance");
    return { ok: true as const, message: `${rows.length} marked, ${emps.length - rows.length} already had attendance for that date` };
  });
}

// ---------------------------------------------------------------- import
const STATUS_ALIASES: Record<string, string> = {
  present: "present", p: "present", absent: "absent", a: "absent", "no pay leave": "no_pay_leave", "no-pay leave": "no_pay_leave", no_pay_leave: "no_pay_leave", npl: "no_pay_leave",
  "approved leave": "approved_leave", approved_leave: "approved_leave", leave: "approved_leave", al: "approved_leave",
  "weekly off": "weekly_off", weekly_off: "weekly_off", off: "weekly_off", wo: "weekly_off", "public holiday": "public_holiday", public_holiday: "public_holiday", ph: "public_holiday", holiday: "public_holiday",
};

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "text" in v) return String((v as { text: string }).text);
  if (typeof v === "object" && "result" in v) return String((v as { result: unknown }).result ?? "");
  return String(v).trim();
}
function toDate(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = cellText(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
function toTime(v: ExcelJS.CellValue): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
  if (typeof v === "number" && v < 1) { const mins = Math.round(v * 24 * 60); return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`; }
  const s = cellText(v);
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

export async function importAttendance(form: FormData) {
  return runAction(async () => {
    const profile = await requireRole(STAFF_ROLES);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Choose an Excel (.xlsx) or CSV file.");
    if (file.size > 5 * 1024 * 1024) throw new Error("The file must be 5 MB or smaller.");
    const wb = new ExcelJS.Workbook();
    const buf = Buffer.from(await file.arrayBuffer());
    let ws: ExcelJS.Worksheet | undefined;
    if (/\.csv$/i.test(file.name)) {
      const { Readable } = await import("node:stream");
      ws = await wb.csv.read(Readable.from(buf));
    } else {
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      ws = wb.worksheets[0];
    }
    if (!ws) throw new Error("The file has no worksheet.");

    const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((h) => cellText(h).toLowerCase().replace(/[^a-z_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, ""));
    const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
    const c = {
      code: col("employee_id", "employee_code", "emp_id", "code"), date: col("work_date", "date", "working_date"), status: col("status", "attendance_status"),
      in: col("check_in", "check_in_time", "in"), out: col("check_out", "check_out_time", "out"), shift: col("shift_start", "shift_start_time"), remarks: col("remarks", "note", "notes"),
    };
    if (c.code < 0 || c.date < 0 || c.status < 0) throw new Error("Required columns: employee_id, work_date, status (optional: check_in, check_out, shift_start, remarks). Download the template.");

    const supabase = await createClient();
    const emps = check(await supabase.from("employees").select("id, employee_code, branch_id, shifts(start_time)").limit(10000)) as unknown as { id: string; employee_code: string; branch_id: string; shifts: { start_time: string } | null }[];
    const byCode = new Map(emps.map((e) => [e.employee_code.toUpperCase(), e]));
    const errors: string[] = [];
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const vals = row.values as ExcelJS.CellValue[];
      const code = cellText(vals[c.code]).toUpperCase();
      if (!code) return;
      const emp = byCode.get(code);
      const date = toDate(vals[c.date]);
      const status = STATUS_ALIASES[cellText(vals[c.status]).toLowerCase()];
      if (!emp) return void errors.push(`Row ${n}: unknown employee ${code}${profile.role === "branch_manager" ? " (or not in your branch)" : ""}`);
      if (!date) return void errors.push(`Row ${n}: invalid date`);
      if (!status) return void errors.push(`Row ${n}: unknown status "${cellText(vals[c.status])}"`);
      const key = `${emp.id}|${date}`;
      if (seen.has(key)) return void errors.push(`Row ${n}: duplicate of an earlier row for ${code} on ${date}`);
      seen.add(key);
      const checkIn = c.in >= 0 ? toTime(vals[c.in]) : null;
      if (status === "present" && !checkIn) return void errors.push(`Row ${n}: check-in time required for Present`);
      rows.push({
        employee_id: emp.id, branch_id: emp.branch_id, work_date: date, status,
        check_in_time: checkIn, check_out_time: c.out >= 0 ? toTime(vals[c.out]) : null,
        shift_start_time: (c.shift >= 0 ? toTime(vals[c.shift]) : null) ?? emp.shifts?.start_time ?? null,
        remarks: c.remarks >= 0 ? cellText(vals[c.remarks]) || null : null, created_by: profile.id, updated_by: profile.id,
      });
    });
    if (rows.length > 10000) throw new Error("Import at most 10,000 rows at a time.");

    const mode = String(form.get("mode") ?? "skip");
    let written = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const res = mode === "update"
        ? await supabase.from("attendance").upsert(chunk, { onConflict: "employee_id,work_date" }).select("id")
        : await supabase.from("attendance").upsert(chunk, { onConflict: "employee_id,work_date", ignoreDuplicates: true }).select("id");
      if (res.error) { errors.push(`Rows ${i + 2}–${i + chunk.length + 1}: ${res.error.message}`); continue; }
      written += res.data?.length ?? 0;
    }
    await logAudit({ actorId: profile.id, action: "attendance.imported", entityType: "attendance", summary: `${file.name}: ${written} written, ${errors.length} errors (${mode})` });
    await recalcAfterChange(profile, supabase, [...new Set(rows.map((r) => r.employee_id as string))]);
    revalidatePath("/attendance");
    return {
      ok: true as const, data: { written, skipped: rows.length - written, errors: errors.slice(0, 200) },
      message: `${written} row(s) imported${rows.length - written ? `, ${rows.length - written} duplicate(s) ${mode === "update" ? "unchanged" : "skipped"}` : ""}${errors.length ? `, ${errors.length} error(s)` : ""}`,
    };
  });
}

// ---------------------------------------------------------------- working-day allocations
export async function saveAllocation(input: unknown) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const v = allocationSchema.parse(input);
    const supabase = await createClient();
    const row = {
      payroll_month: v.payroll_month, allocated_days: v.allocated_days, notes: v.notes, created_by: profile.id,
      branch_id: v.scope === "branch" ? v.branch_id : null, employee_id: v.scope === "employee" ? v.employee_id : null,
    };
    let q = supabase.from("working_day_allocations").select("id").eq("payroll_month", v.payroll_month);
    q = v.scope === "employee" ? q.eq("employee_id", v.employee_id!) : q.eq("branch_id", v.branch_id!).is("employee_id", null);
    const existing = (await q.maybeSingle()).data;
    if (existing) check(await supabase.from("working_day_allocations").update(row).eq("id", existing.id));
    else check(await supabase.from("working_day_allocations").insert(row));
    await logAudit({ actorId: profile.id, action: "allocation.saved", entityType: "working_day_allocation", summary: `${v.scope} ${v.payroll_month}: ${v.allocated_days} days` });
    // branch allocations affect many employees: recalc everyone flagged stale
    const ids = v.scope === "employee" ? [v.employee_id!]
      : ((check(await supabase.from("employees").select("id").eq("branch_id", v.branch_id!)) as { id: string }[]).map((e) => e.id));
    await recalcAfterChange(profile, supabase, ids);
    revalidatePath("/attendance");
    return { ok: true as const, message: "Working-day allocation saved" };
  });
}

export async function deleteAllocation(id: string) {
  return runAction(async () => {
    const profile = await requireRole(ADMIN_ROLES);
    const supabase = await createClient();
    const a = check(await supabase.from("working_day_allocations").select("*").eq("id", id).single());
    check(await supabase.from("working_day_allocations").delete().eq("id", id));
    await logAudit({ actorId: profile.id, action: "allocation.deleted", entityType: "working_day_allocation", entityId: id, oldValues: a });
    const ids = a.employee_id ? [a.employee_id] : ((check(await supabase.from("employees").select("id").eq("branch_id", a.branch_id)) as { id: string }[]).map((e) => e.id));
    await recalcAfterChange(profile, supabase, ids);
    revalidatePath("/attendance");
    return { ok: true as const, message: "Allocation removed" };
  });
}
