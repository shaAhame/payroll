import { Wallet } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-10 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10"><Wallet className="h-5 w-5" /></div>
          <span className="font-semibold">Payroll Management</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Accurate monthly payroll, from attendance to payslip.</h2>
          <p className="mt-3 text-sm text-sidebar-foreground">
            Centralized salary calculation, approvals, payslips and automated delivery for every branch.
          </p>
        </div>
        <p className="text-xs text-sidebar-muted">Access is restricted to authorized staff.</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted-foreground">Use the email address your administrator registered.</p>
          {sp.error === "no_profile" && (
            <p className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
              Your account is not active or has no role assigned. Contact your administrator.
            </p>
          )}
          <LoginForm next={sp.next} />
        </div>
      </div>
    </div>
  );
}
