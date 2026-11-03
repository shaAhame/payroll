"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/app/form";
import { updatePlan } from "./actions";

const schema = z.object({
  status: z.enum(["active", "on_hold", "cancelled"]),
  monthly_repayment: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid amount").refine((v) => Number(v) > 0, "Must be greater than zero"),
  remarks: z.string().max(500),
});

export function PlanEditDialog({ table, id, status, monthly, remarks }: { table: "salary_advances" | "employee_loans"; id: string; status: string; monthly: string; remarks: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { status: status as "active", monthly_repayment: monthly, remarks } });
  const submit = form.handleSubmit(async (v) => {
    const r = await updatePlan(table, id, v);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message); setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Manage</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage repayment plan</DialogTitle>
          <DialogDescription>Outstanding balances change only when payroll is finalized. A plan on hold or cancelled is skipped in open payroll.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status"><NativeSelect {...form.register("status")}><option value="active">Active</option><option value="on_hold">On hold</option><option value="cancelled">Cancelled</option></NativeSelect></Field>
            <Field label="Monthly repayment (LKR)" error={form.formState.errors.monthly_repayment?.message}><Input inputMode="decimal" {...form.register("monthly_repayment")} /></Field>
          </div>
          <Field label="Remarks"><Textarea {...form.register("remarks")} /></Field>
          <DialogFooter><Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting && <Loader2 className="animate-spin" />} Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
