import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";

export async function GET() {
  const profile = await getProfile();
  if (!profile || profile.role === "employee") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Attendance");
  ws.columns = [
    { header: "employee_id", key: "employee_id", width: 14 }, { header: "work_date", key: "work_date", width: 12 },
    { header: "status", key: "status", width: 16 }, { header: "check_in", key: "check_in", width: 10 },
    { header: "check_out", key: "check_out", width: 10 }, { header: "shift_start", key: "shift_start", width: 11 }, { header: "remarks", key: "remarks", width: 30 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.addRow({ employee_id: "EMP-00001", work_date: "2026-01-02", status: "Present", check_in: "08:58", check_out: "17:30", shift_start: "", remarks: "Example row - delete before import" });
  ws.addRow({ employee_id: "EMP-00001", work_date: "2026-01-03", status: "Weekly Off" });
  const notes = wb.addWorksheet("Help");
  notes.addRows([
    ["Column", "Notes"],
    ["employee_id", "Employee ID as shown in the system (e.g. EMP-00001)"],
    ["work_date", "YYYY-MM-DD or DD/MM/YYYY"],
    ["status", "Present, Absent, No-Pay Leave, Approved Leave, Weekly Off, Public Holiday"],
    ["check_in / check_out", "HH:MM (24h). Check-in is required for Present."],
    ["shift_start", "Optional. Defaults to the employee's allocated shift."],
  ]);
  notes.getRow(1).font = { bold: true };
  notes.getColumn(1).width = 20; notes.getColumn(2).width = 70;
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf), {
    headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="attendance-import-template.xlsx"' },
  });
}
