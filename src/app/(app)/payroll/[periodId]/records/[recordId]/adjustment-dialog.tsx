"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/app/form";
import { createAdjustment } from "../../../actions";

const schema = z.object({
  kind: z.enum(["earning", "deduction"]),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount"),
  reason: z.string().trim().min(5, "Explain the correction"),
  target_month: z.string().regex(/^\d{4}-\d{2}$/, "Select a month"),
});

export function AdjustmentDialog({ recordId, defaultMonth, trigger }: { recordId: string; defaultMonth: string; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { kind: "earning", amount: "", reason: "", target_month: defaultMonth } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    const r = await createAdjustment(recordId, v);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message);
    setOpen(false);
    form.reset();
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Authorized payroll adjustment</DialogTitle>
          <DialogDescription>Finalized payroll is never edited. The correction is paid (arrears) or recovered in a later payroll and linked to this record in the audit trail.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" required>
              <NativeSelect {...form.register("kind")}>
                <option value="earning">Underpaid — add earning</option>
                <option value="deduction">Overpaid — recover as deduction</option>
              </NativeSelect>
            </Field>
            <Field label="Amount (LKR)" error={e.amount?.message} required><Input inputMode="decimal" {...form.register("amount")} /></Field>
            <Field label="Apply in payroll month" error={e.target_month?.message} required><Input type="month" {...form.register("target_month")} /></Field>
          </div>
          <Field label="Reason" error={e.reason?.message} required><Textarea {...form.register("reason")} /></Field>
          <DialogFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting && <Loader2 className="animate-spin" />} Record adjustment</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
