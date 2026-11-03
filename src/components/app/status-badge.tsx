import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/format";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "primary";

const TONES: Record<string, Tone> = {
  // payroll
  draft: "neutral", processing: "info", pending_approval: "warning", approved: "primary", finalized: "success",
  // generic approvals
  pending: "warning", rejected: "danger", cancelled: "neutral",
  // commissions
  included_in_payroll: "primary", released: "success",
  // email
  queued: "info", sent: "primary", delivered: "success", failed: "danger", bounced: "danger",
  // queue/payslip
  completed: "success", generated: "success",
  // employment / plans
  active: "success", inactive: "neutral", resigned: "neutral", terminated: "danger", on_hold: "warning",
  // attendance
  present: "success", absent: "danger", no_pay_leave: "danger", approved_leave: "info", weekly_off: "neutral", public_holiday: "neutral",
  // verification
  verified: "success", unverified: "neutral", invalid: "danger",
};

export function StatusBadge({ status, label }: { status: string | null | undefined; label?: string }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return <Badge variant={TONES[status] ?? "neutral"}>{label ?? titleCase(status)}</Badge>;
}
