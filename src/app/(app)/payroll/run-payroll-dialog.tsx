"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/app/form";
import { runPayroll } from "./actions";

const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "Select a month"), branch_id: z.string() });

export function RunPayrollDialog({ branches, defaultMonth }: { branches: { id: string; name: string }[]; defaultMonth: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { month: defaultMonth.slice(0, 7), branch_id: "" } });
  const submit = form.handleSubmit(async (v) => {
    const r = await runPayroll(v);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message);
    setOpen(false);
    router.push(`/payroll/${(r.data as { id: string }).id}`);
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Play /> Process payroll</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Process monthly payroll</DialogTitle>
          <DialogDescription>
            Loads active employees, their salary structures, allocated working days, attendance, incentives, earnings, commissions,
            advances, loans and deductions, then calculates every employee with the central engine. Nothing is paid or emailed until the payroll is finalized.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payroll month" error={form.formState.errors.month?.message} required>
              <Input type="month" {...form.register("month")} />
            </Field>
            <Field label="Branch">
              <NativeSelect {...form.register("branch_id")}>
                <option value="">All branches</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </NativeSelect>
            </Field>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="animate-spin" />} Calculate payroll
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
