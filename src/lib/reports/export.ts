import "server-only";
import ExcelJS from "exceljs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import type { Column } from "@/lib/reports/definitions";

const numeric = (c: Column) => c.type === "money" || c.type === "number";
const cell = (c: Column, v: unknown) => {
  if (v === null || v === undefined || v === "") return "";
  if (c.type === "money") return Number(v);
  if (c.type === "number") return Number(v);
  if (c.type === "date") return String(v).slice(0, 10);
  return String(v);
};

export async function toXlsx(title: string, subtitle: string, columns: Column[], rows: Record<string, unknown>[]) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Payroll Management System";
  const ws = wb.addWorksheet(title.slice(0, 31));
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([subtitle]).font = { color: { argb: "FF5B6474" } };
  ws.addRow([]);
  const header = ws.addRow(columns.map((c) => c.label));
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F1B2D" } }; });
  for (const r of rows) ws.addRow(columns.map((c) => cell(c, r[c.key])));
  if (rows.length) {
    const total = ws.addRow(columns.map((c, i) => (i === 0 ? "Total" : c.type === "money" ? rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0) : "")));
    total.font = { bold: true };
  }
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(40, Math.max(12, c.label.length + 2));
    if (c.type === "money") col.numFmt = "#,##0.00";
    if (numeric(c)) col.alignment = { horizontal: "right" };
  });
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toCsv(columns: Column[], rows: Record<string, unknown>[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // neutralise spreadsheet formula injection
    const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [columns.map((c) => esc(c.label)).join(","), ...rows.map((r) => columns.map((c) => esc(cell(c, r[c.key]))).join(","))].join("\r\n");
}

const safe = (t: string) => t.replace(/[−–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
const fmt = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function toPdf(title: string, subtitle: string, columns: Column[], rows: Record<string, unknown>[]) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 841.89, H = 595.28, M = 28; // A4 landscape
  const size = columns.length > 14 ? 6 : columns.length > 10 ? 7 : 8;
  const widths = columns.map((c) => Math.max(font.widthOfTextAtSize(safe(c.label), size), ...rows.slice(0, 200).map((r) => {
    const v = r[c.key]; return font.widthOfTextAtSize(safe(c.type === "money" ? fmt.format(Number(v ?? 0)) : String(v ?? "")), size);
  })) + 8);
  const scale = Math.min(1, (W - 2 * M) / widths.reduce((s, w) => s + w, 0));
  const cw = widths.map((w) => w * scale);
  const rowH = size + 6;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const fit = (s: string, w: number) => { let t = safe(s); while (t.length > 1 && font.widthOfTextAtSize(t, size) > w - 4) t = t.slice(0, -1); return t; };
  const header = () => {
    page.drawRectangle({ x: M, y: y - rowH + 3, width: W - 2 * M, height: rowH, color: rgb(0.06, 0.106, 0.176) });
    let x = M;
    columns.forEach((c, i) => { page.drawText(fit(c.label, cw[i]), { x: x + 2, y: y - size + 1, size, font: bold, color: rgb(1, 1, 1) }); x += cw[i]; });
    y -= rowH;
  };
  page.drawText(safe(title), { x: M, y, size: 13, font: bold });
  y -= 14;
  page.drawText(safe(subtitle), { x: M, y, size: 8, font, color: rgb(0.36, 0.39, 0.45) });
  y -= 14;
  header();
  rows.forEach((r, ri) => {
    if (y < M + rowH) {
      page = pdf.addPage([W, H]); y = H - M; header();
    }
    if (ri % 2) page.drawRectangle({ x: M, y: y - rowH + 3, width: W - 2 * M, height: rowH, color: rgb(0.96, 0.965, 0.975) });
    let x = M;
    columns.forEach((c, i) => {
      const v = r[c.key];
      const s = c.type === "money" ? fmt.format(Number(v ?? 0)) : v === null || v === undefined ? "" : c.type === "date" ? String(v).slice(0, 10) : String(v);
      const t = fit(s, cw[i]);
      const tx = numeric(c) ? x + cw[i] - 2 - font.widthOfTextAtSize(t, size) : x + 2;
      page.drawText(t, { x: tx, y: y - size + 1, size, font });
      x += cw[i];
    });
    y -= rowH;
  });
  const pages = pdf.getPages();
  pages.forEach((p, i) => p.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 60, y: 14, size: 7, font, color: rgb(0.5, 0.5, 0.5) }));
  return Buffer.from(await pdf.save());
}
