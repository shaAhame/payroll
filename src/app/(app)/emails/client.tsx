"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { resendPayslips, sendTestEmail } from "./actions";

export function TestEmailForm() {
  const [pending, start] = useTransition();
  const [to, setTo] = useState("");
  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => {
      e.preventDefault();
      start(async () => { const r = await sendTestEmail(to); if (r.ok) toast.success(r.message); else toast.error(r.error); });
    }}>
      <Input type="email" placeholder="you@company.lk" value={to} onChange={(e) => setTo(e.target.value)} required className="sm:max-w-xs" />
      <Button type="submit" variant="outline" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Mail />} Send test email</Button>
    </form>
  );
}

export function ResendSelected({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button size="sm" variant="outline" disabled={!ids.length} onClick={() => setOpen(true)}><Send /> Resend selected ({ids.length})</Button>
      <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogTitle>Resend {ids.length} payslip email(s)?</AlertDialogTitle>
          <AlertDialogDescription>Each employee receives only their own payslip. Payslips with an email still in progress or sent in the last 10 minutes are skipped to prevent duplicates. No payroll data changes.</AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button disabled={pending} onClick={(e) => {
                e.preventDefault();
                start(async () => {
                  const r = await resendPayslips(ids);
                  if (r.ok) { toast.success(r.message); onDone(); setOpen(false); router.refresh(); } else toast.error(r.error);
                });
              }}>{pending && <Loader2 className="animate-spin" />} Resend</Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function SelectCheckbox(props: React.ComponentProps<typeof Checkbox>) {
  return <Checkbox {...props} />;
}
