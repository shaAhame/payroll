"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, Wallet, X } from "lucide-react";
import { NavIcon } from "@/components/app/icon";
import { cn } from "@/lib/utils";
import type { NavItem } from "@/lib/nav";

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-3">
      {items.map((item) => {
        const active = item.href === "/portal" ? pathname === "/portal" : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors",
              active ? "bg-sidebar-active text-white" : "text-sidebar-foreground hover:bg-sidebar-active/60 hover:text-white",
            )}
          >
            <NavIcon name={item.icon} className={cn("h-4 w-4 shrink-0", active ? "text-white" : "text-sidebar-muted")} />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Brand({ companyName }: { companyName: string }) {
  return (
    <div className="flex h-16 items-center gap-2.5 px-6">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white/10">
        <Wallet className="h-4 w-4 text-white" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-white">{companyName}</div>
        <div className="text-[11px] uppercase tracking-wider text-sidebar-muted">Payroll</div>
      </div>
    </div>
  );
}

export function Sidebar({ items, companyName }: { items: NavItem[]; companyName: string }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-sidebar lg:flex">
      <Brand companyName={companyName} />
      <div className="flex-1 overflow-y-auto pb-6 pt-2">
        <NavList items={items} />
      </div>
    </aside>
  );
}

export function MobileNav({ items, companyName }: { items: NavItem[]; companyName: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <button className="rounded-md p-2 hover:bg-muted lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
        <Menu className="h-5 w-5" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-sidebar">
            <div className="flex items-center justify-between pr-3">
              <Brand companyName={companyName} />
              <button className="rounded-md p-2 text-white/80 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pb-6">
              <NavList items={items} onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
