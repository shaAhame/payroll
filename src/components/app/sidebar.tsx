"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
    <div className="flex h-16 min-w-0 items-center gap-2.5 px-6">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/10">
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

export function MobileNav({ items, companyName, extra }: { items: NavItem[]; companyName: string; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  useEffect(() => setMounted(true), []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  return (
    <>
      <button className="-ml-1 shrink-0 rounded-md p-2 hover:bg-muted lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
        <Menu className="h-5 w-5" />
      </button>
      {/* Rendered into <body>: a fixed element inside the blurred sticky header would be clipped to the header's height */}
      {mounted && open && createPortal(
        <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-slate-950/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex h-dvh w-[min(18rem,85vw)] flex-col bg-sidebar shadow-xl">
            <div className="flex shrink-0 items-center justify-between pr-2">
              <div className="min-w-0 flex-1"><Brand companyName={companyName} /></div>
              <button className="shrink-0 rounded-md p-2 text-white/80 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
            </div>
            {extra && <div className="shrink-0 px-6 pb-3">{extra}</div>}
            <div className="flex-1 overflow-y-auto overscroll-contain pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              <NavList items={items} onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}
