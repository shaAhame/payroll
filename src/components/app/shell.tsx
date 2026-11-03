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
        <header className="no-print sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-card/95 px-4 backdrop-blur sm:px-6">
          <MobileNav items={nav} companyName={companyName} />
          {showSearch ? <GlobalSearch /> : <div className="flex-1" />}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {showMonth && <MonthSwitcher month={month} />}
            <NotificationsMenu items={notifications} />
            <UserMenu {...user} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
