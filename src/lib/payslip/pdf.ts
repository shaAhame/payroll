import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

export interface PayslipData {
  company: { name: string; address: string | null; phone: string | null; email: string | null; employerEpfNumber: string | null };
  logo?: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  referenceNumber: string;
  monthLabel: string;
  employee: { code: string; name: string; designation: string; epfNumber: string | null; branch: string };
  earnings: { label: string; amount: string }[];
  deductions: { label: string; amount: string }[];
  totalEarnings: string;
  totalDeductions: string;
  netSalary: string;
  basis: {
    epfSalaryBasis: string; dailySalaryBasis: string; dailySalaryRate: string;
    allocatedDays: string; actualDays: string; additionalDays: string; offDays: string;
  };
  employer: { epf: string; etf: string };
  generatedAt: string;
}

const NAVY = rgb(0.06, 0.106, 0.176);
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.36, 0.39, 0.45);
const LINE = rgb(0.86, 0.88, 0.91);
const SOFT = rgb(0.955, 0.962, 0.972);
const ACCENT = rgb(0.14, 0.29, 0.72);

const money = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt = (v: string | number) => money.format(Number(v));

/** pdf-lib standard fonts only support WinAnsi — strip anything else. */
const safe = (t: string) => t.replace(/[−–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

function text(page: PDFPage, s: string, x: number, y: number, font: PDFFont, size: number, color = INK) {
  page.drawText(safe(s), { x, y, size, font, color });
}
function right(page: PDFPage, s: string, xRight: number, y: number, font: PDFFont, size: number, color = INK) {
  const w = font.widthOfTextAtSize(safe(s), size);
  page.drawText(safe(s), { x: xRight - w, y, size, font, color });
}
function fit(s: string, font: PDFFont, size: number, max: number) {
  let out = safe(s);
  while (out.length > 3 && font.widthOfTextAtSize(out, size) > max) out = out.slice(0, -2);
  return out === safe(s) ? out : out + "…".replace("…", "..");
}

export async function renderPayslipPdf(d: PayslipData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Payslip ${d.referenceNumber}`);
  pdf.setAuthor(d.company.name);
  pdf.setSubject(`Salary payslip - ${d.monthLabel}`);
  pdf.setCreator("Payroll Management System");
  const page = pdf.addPage([595.28, 841.89]); // A4
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = page.getWidth();
  const M = 40;
  let y = 800;

  // Header band
  page.drawRectangle({ x: 0, y: 760, width: W, height: 82, color: NAVY });
  let logo: PDFImage | null = null;
  try {
    if (d.logo) logo = d.logo.type === "png" ? await pdf.embedPng(d.logo.bytes) : await pdf.embedJpg(d.logo.bytes);
  } catch {
    logo = null;
  }
  let tx = M;
  if (logo) {
    const h = 44;
    const w = Math.min(120, (logo.width / logo.height) * h);
    page.drawImage(logo, { x: M, y: 779, width: w, height: h });
    tx = M + w + 12;
  }
  text(page, d.company.name, tx, 811, bold, 15, rgb(1, 1, 1));
  const addr = [d.company.address, d.company.phone, d.company.email].filter(Boolean).join("  |  ");
  if (addr) text(page, fit(addr, regular, 8.5, 300), tx, 795, regular, 8.5, rgb(0.8, 0.84, 0.9));
  right(page, "SALARY PAYSLIP", W - M, 811, bold, 13, rgb(1, 1, 1));
  right(page, d.monthLabel, W - M, 795, regular, 10, rgb(0.8, 0.84, 0.9));
  right(page, `Ref: ${d.referenceNumber}`, W - M, 781, regular, 8.5, rgb(0.8, 0.84, 0.9));

  // Employee block
  y = 735;
  const col2 = W / 2 + 10;
  const info: [string, string][] = [
    ["Employee ID", d.employee.code], ["Designation", d.employee.designation],
    ["Employee Name", d.employee.name], ["EPF Number", d.employee.epfNumber ?? "-"],
    ["Branch", d.employee.branch], ["Payroll Month", d.monthLabel],
  ];
  page.drawRectangle({ x: M, y: y - 62, width: W - 2 * M, height: 72, color: SOFT });
  info.forEach(([k, v], i) => {
    const x = i % 2 === 0 ? M + 12 : col2;
    const yy = y - Math.floor(i / 2) * 21;
    text(page, k, x, yy - 4, regular, 8, MUTED);
    text(page, fit(v, bold, 9.5, 150), x + 85, yy - 4, bold, 9.5);
  });

  // Earnings / deductions tables
  y = 640;
  const tableW = (W - 2 * M - 16) / 2;
  const drawTable = (x: number, title: string, rows: { label: string; amount: string }[], totalLabel: string, total: string) => {
    page.drawRectangle({ x, y: y - 4, width: tableW, height: 20, color: NAVY });
    text(page, title, x + 8, y + 2, bold, 9.5, rgb(1, 1, 1));
    right(page, "LKR", x + tableW - 8, y + 2, bold, 9.5, rgb(1, 1, 1));
    let yy = y - 20;
    rows.forEach((r, i) => {
      if (i % 2 === 1) page.drawRectangle({ x, y: yy - 4, width: tableW, height: 16, color: SOFT });
      const zero = Number(r.amount) === 0;
      text(page, fit(r.label, regular, 8.8, tableW - 90), x + 8, yy, regular, 8.8, zero ? MUTED : INK);
      right(page, fmt(r.amount), x + tableW - 8, yy, regular, 8.8, zero ? MUTED : INK);
      yy -= 16;
    });
    page.drawLine({ start: { x, y: yy + 10 }, end: { x: x + tableW, y: yy + 10 }, thickness: 0.8, color: LINE });
    text(page, totalLabel, x + 8, yy - 3, bold, 9.5);
    right(page, fmt(total), x + tableW - 8, yy - 3, bold, 9.5);
    return yy - 3;
  };
  const yE = drawTable(M, "EARNINGS", d.earnings, "Total Earnings", d.totalEarnings);
  const yD = drawTable(M + tableW + 16, "DEDUCTIONS", d.deductions, "Total Deductions", d.totalDeductions);
  y = Math.min(yE, yD) - 30;

  // Net salary
  page.drawRectangle({ x: M, y: y - 14, width: W - 2 * M, height: 38, color: rgb(0.93, 0.95, 1), borderColor: ACCENT, borderWidth: 1 });
  text(page, "NET SALARY PAYABLE", M + 14, y, bold, 12, ACCENT);
  right(page, `LKR ${fmt(d.netSalary)}`, W - M - 14, y, bold, 15, ACCENT);
  y -= 50;

  // Calculation basis
  text(page, "Calculation details", M, y, bold, 10);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: LINE });
  y -= 16;
  const basis: [string, string][] = [
    ["EPF Salary Basis (Basic + BRA 2 + BRA 1)", `LKR ${fmt(d.basis.epfSalaryBasis)}`],
    ["Daily Salary Basis (Basic + BRA 2 + BRA 1)", `LKR ${fmt(d.basis.dailySalaryBasis)}`],
    ["Daily Salary Rate", `LKR ${fmt(d.basis.dailySalaryRate)}`],
    ["Allocated Working Days", d.basis.allocatedDays],
    ["Actual Working Days", d.basis.actualDays],
    ["Additional Working Days", d.basis.additionalDays],
    ["Additional Off Days", d.basis.offDays],
  ];
  basis.forEach(([k, v], i) => {
    const x = i % 2 === 0 ? M : col2;
    const yy = y - Math.floor(i / 2) * 16;
    text(page, k, x, yy, regular, 8.5, MUTED);
    right(page, v, x + (W / 2 - M - 20), yy, bold, 8.5);
  });
  y -= Math.ceil(basis.length / 2) * 16 + 12;
  text(page, `Employer contributions (not deducted from salary): EPF LKR ${fmt(d.employer.epf)}  |  ETF LKR ${fmt(d.employer.etf)}`, M, y, regular, 8, MUTED);
  if (d.company.employerEpfNumber) text(page, `Employer EPF No: ${d.company.employerEpfNumber}`, M, y - 12, regular, 8, MUTED);

  // Footer
  page.drawLine({ start: { x: M, y: 60 }, end: { x: W - M, y: 60 }, thickness: 0.5, color: LINE });
  text(page, "This is a computer-generated payslip and does not require a signature. It is confidential to the named employee.", M, 46, regular, 7.5, MUTED);
  text(page, `Generated ${d.generatedAt}  |  ${d.referenceNumber}`, M, 34, regular, 7.5, MUTED);

  return pdf.save();
}

/** Combine several payslip PDFs into one document (bulk download). */
export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle("Payslips");
  for (const f of files) {
    const src = await PDFDocument.load(f);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}
