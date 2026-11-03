import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { getProfile, ROLE_LABELS } from "@/lib/auth";
import { PORTAL_NAV } from "@/lib/nav";
import { loadShellData } from "@/lib/shell-data";
import { currentMonthStart } from "@/lib/format";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login?error=no_profile");
  if (profile.role !== "employee") redirect("/dashboard");
  const { companyName, notifications } = await loadShellData();
  return (
    <AppShell nav={PORTAL_NAV} companyName={companyName} month={currentMonthStart()} notifications={notifications} showSearch={false} showMonth={false}
      user={{ name: profile.full_name, email: profile.email, roleLabel: ROLE_LABELS[profile.role], accountHref: "/portal/account" }}>
      {children}
    </AppShell>
  );
}
