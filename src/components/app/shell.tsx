import { MobileNav, Sidebar } from "@/components/app/sidebar";
import { GlobalSearch, MonthSwitcher, NotificationsMenu, UserMenu, type TopbarNotification } from "@/components/app/topbar";
import type { NavItem } from "@/lib/nav";

export function AppShell({ nav, companyName, month, notifications, user, showSearch = true, showMonth = true, children }: {
  nav: NavItem[]; companyName: string; month: string; notifications: TopbarNotification[];
  user: { name: string; email: string; roleLabel: string; accountHref?: string }; showSearch?: boolean; showMonth?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <Sidebar items={nav} companyName={companyName} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-card/95 px-3 backdrop-blur sm:h-16 sm:gap-3 sm:px-6">
          <MobileNav items={nav} companyName={companyName} extra={showMonth ? <MonthSwitcher month={month} dark /> : undefined} />
          <span className="min-w-0 truncate text-sm font-semibold lg:hidden">{companyName}</span>
          {showSearch ? <GlobalSearch /> : <div className="flex-1" />}
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
            {showMonth && <div className="hidden sm:block"><MonthSwitcher month={month} /></div>}
            <NotificationsMenu items={notifications} />
            <UserMenu {...user} />
          </div>
        </header>
        <main className="mx-auto w-full min-w-0 max-w-[1500px] flex-1 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
