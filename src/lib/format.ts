const lkr = new Intl.NumberFormat("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "48,000.00" — amounts are stored as NUMERIC and arrive as strings or numbers. */
export function formatAmount(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "0.00";
  return lkr.format(Number(v));
}

export function formatLKR(v: string | number | null | undefined): string {
  return `LKR ${formatAmount(v)}`;
}

export function formatDays(v: string | number | null | undefined): string {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** "2026-01-01" → "January 2026" */
export function formatMonth(month: string | null | undefined): string {
  if (!month) return "—";
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  const date = d.length === 10 ? new Date(d + "T00:00:00Z") : new Date(d);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: d.length === 10 ? "UTC" : "Asia/Colombo" });
}

export function formatDateTime(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Colombo",
  });
}

/** "2026-01" or "2026-01-15" → "2026-01-01" */
export function toMonthStart(v: string): string {
  return `${v.slice(0, 7)}-01`;
}

export function currentMonthStart(): string {
  const now = new Date();
  const colombo = new Date(now.getTime() + 5.5 * 3600 * 1000);
  return `${colombo.getUTCFullYear()}-${String(colombo.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function monthEnd(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${monthStart.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

export function addMonths(monthStart: string, n: number): string {
  const [y, m] = monthStart.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function titleCase(v: string | null | undefined): string {
  if (!v) return "—";
  return v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
