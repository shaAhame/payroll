"use client";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/app/form";
import { releaseCommission } from "./actions";

const schema = z.object({ released_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date"), release_deduction_month: z.string() });

export function ReleaseDialog({ id, includedInPayroll, defaultMonth, label }: { id: string; includedInPayroll: boolean; defaultMonth: string; label: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { released_date: new Date().toISOString().slice(0, 10), release_deduction_month: defaultMonth } });
  const submit = form.handleSubmit(async (v) => {
    const r = await releaseCommission(id, v);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message); setOpen(false); router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="ghost">Release</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record separate release · {label}</DialogTitle>
          <DialogDescription>
            {includedInPayroll
              ? "This commission was already paid as a payroll earning. Recording a separate release recovers it as a deduction in the payroll month you choose, so it is not paid twice."
              : "This commission has not been paid through payroll. Releasing it separately removes it from payroll earnings; nothing is deducted."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Released (paid) date" error={form.formState.errors.released_date?.message} required><Input type="date" {...form.register("released_date")} /></Field>
            {includedInPayroll && <Field label="Recover in payroll month" required hint="Must be an open (not finalized) month"><Input type="month" {...form.register("release_deduction_month")} /></Field>}
          </div>
          <DialogFooter><Button type="submit" disabled={form.formState.isSubmitting}>{form.formState.isSubmitting && <Loader2 className="animate-spin" />} Confirm release</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
