import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/shell";
import { getProfile, ROLE_LABELS } from "@/lib/auth";
import { getSelectedMonth } from "@/lib/month";
import { NAV } from "@/lib/nav";
import { loadShellData } from "@/lib/shell-data";

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile();
  if (!profile) redirect("/login?error=no_profile");
  if (profile.role === "employee") redirect("/portal");
  const [{ companyName, notifications }, month] = await Promise.all([loadShellData(), getSelectedMonth()]);
  return (
    <AppShell
      nav={NAV.filter((n) => n.roles.includes(profile.role))}
      companyName={companyName}
      month={month}
      notifications={notifications}
      user={{ name: profile.full_name, email: profile.email, roleLabel: ROLE_LABELS[profile.role] }}
    >
      {children}
    </AppShell>
  );
}
