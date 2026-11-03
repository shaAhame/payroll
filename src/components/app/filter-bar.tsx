"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FilterDef {
  name: string;
  label: string;
  type: "select" | "month" | "text" | "date";
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** shown when the URL has no value (e.g. the selected payroll month) */
  defaultValue?: string;
}

/** Filters that live in the URL so pages stay server-rendered and shareable. */
export function FilterBar({ filters, className }: { filters: FilterDef[]; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(name, value); else next.delete(name);
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`));
  };
  const hasAny = filters.some((f) => params.get(f.name));

  return (
    <div className={cn("grid w-full grid-cols-2 items-end gap-2 sm:flex sm:w-auto sm:flex-wrap", pending && "opacity-70", className)}>
      {filters.map((f) => {
        const value = params.get(f.name) ?? f.defaultValue ?? "";
        const base = "h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 text-base shadow-xs outline-none focus:ring-2 focus:ring-ring sm:w-auto sm:text-sm";
        return (
          <label key={f.name} className={cn("flex min-w-0 flex-col gap-1", f.type === "text" && "col-span-2 sm:col-span-1")}>
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{f.label}</span>
            {f.type === "select" ? (
              <select className={cn(base, "sm:min-w-36")} value={value} onChange={(e) => set(f.name, e.target.value)}>
                <option value="">All</option>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === "text" ? (
              <div className="relative w-full sm:w-auto">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  defaultValue={value}
                  placeholder={f.placeholder ?? "Search…"}
                  className={cn(base, "pl-8 sm:w-56")}
                  onKeyDown={(e) => e.key === "Enter" && set(f.name, (e.target as HTMLInputElement).value)}
                  onBlur={(e) => e.target.value !== value && set(f.name, e.target.value)}
                />
              </div>
            ) : (
              <input
                type={f.type}
                className={base}
                value={f.type === "month" ? value.slice(0, 7) : value}
                onChange={(e) => set(f.name, e.target.value)}
              />
            )}
          </label>
        );
      })}
      {hasAny && (
        <Button variant="ghost" size="sm" className="col-span-2 h-9 sm:col-span-1" onClick={() => { const next = new URLSearchParams(params.toString()); filters.forEach((f) => next.delete(f.name)); next.delete("page"); start(() => router.replace(`${pathname}?${next.toString()}`)); }}>
          <X /> Clear
        </Button>
      )}
    </div>
  );
}

export function Pagination({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const go = (p: number) => {
    const next = new URLSearchParams(params.toString());
    next.set("page", String(p));
    router.push(`${pathname}?${next.toString()}`);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground">
      <span>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => go(page - 1)}>Previous</Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => go(page + 1)}>Next</Button>
      </div>
    </div>
  );
}
