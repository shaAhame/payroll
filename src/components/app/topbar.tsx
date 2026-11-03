"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bell, CalendarDays, KeyRound, LogOut, Search, UserRound } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { markNotificationsRead, setSelectedMonth, signOut } from "@/app/actions/session";
import { formatDateTime } from "@/lib/format";

export interface TopbarNotification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export function GlobalSearch() {
  const router = useRouter();
  return (
    <form
      className="relative hidden w-full max-w-sm md:block"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new FormData(e.currentTarget).get("q");
        if (q) router.push(`/search?q=${encodeURIComponent(String(q))}`);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        name="q"
        placeholder="Search employees, EPF no., payslip ref…"
        className="h-9 w-full rounded-md border border-input bg-muted/50 pl-9 pr-3 text-sm outline-none focus:bg-card focus:ring-2 focus:ring-ring"
      />
    </form>
  );
}

export function MonthSwitcher({ month }: { month: string }) {
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 rounded-md border border-input bg-card px-2.5 text-sm shadow-xs">
      <CalendarDays className="h-4 w-4 text-muted-foreground" />
      <span className="sr-only">Payroll month</span>
      <input
        type="month"
        className="h-9 bg-transparent text-sm outline-none disabled:opacity-50"
        defaultValue={month.slice(0, 7)}
        disabled={pending}
        onChange={(e) => e.target.value && start(() => setSelectedMonth(e.target.value))}
        aria-label="Selected payroll month"
      />
    </label>
  );
}

export function NotificationsMenu({ items }: { items: TopbarNotification[] }) {
  const unread = items.filter((i) => !i.is_read).length;
  const [, start] = useTransition();
  return (
    <DropdownMenu onOpenChange={(open) => !open && unread > 0 && start(() => markNotificationsRead())}>
      <DropdownMenuTrigger className="relative rounded-md p-2 hover:bg-muted" aria-label="Notifications">
        <Bell className="h-5 w-5 text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 && <div className="px-2 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>}
        {items.map((n) => (
          <DropdownMenuItem key={n.id} asChild>
            <Link href={n.link ?? "#"} className="flex flex-col items-start gap-0.5">
              <span className="flex w-full items-center gap-2 font-medium">
                {!n.is_read && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                {n.title}
              </span>
              {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
              <span className="text-[11px] text-muted-foreground">{formatDateTime(n.created_at)}</span>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function UserMenu({ name, email, roleLabel, accountHref = "/account" }: { name: string; email: string; roleLabel: string; accountHref?: string }) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md p-1 pr-2 hover:bg-muted" aria-label="Account menu">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-white">{initials}</span>
        <span className="hidden text-left leading-tight sm:block">
          <span className="block text-sm font-medium">{name}</span>
          <span className="block text-[11px] text-muted-foreground">{roleLabel}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium text-foreground">{name}</div>
          <div className="text-xs">{email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={accountHref}><UserRound /> Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`${accountHref}#password`}><KeyRound /> Account settings</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut()} className="text-destructive">
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
