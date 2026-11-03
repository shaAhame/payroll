"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarOff, FileSpreadsheet, Loader2, Pencil, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/app/form";
import { SchemaForm, type Option } from "@/components/app/schema-form";
import { ATTENDANCE_STATUS } from "@/lib/options";
import { bulkMarkStatus, importAttendance, saveAttendance } from "./actions";

export function AttendanceDialog({ employees, initial, id, triggerLabel, icon }: {
  employees: Option[]; initial: Record<string, unknown>; id?: string; triggerLabel?: string; icon?: "edit" | "add";
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {icon === "edit" ? <Button variant="ghost" size="icon" aria-label="Edit attendance"><Pencil /></Button>
          : <Button size={triggerLabel ? "sm" : "default"} variant={triggerLabel ? "outline" : "default"}><Plus /> {triggerLabel ?? "Add attendance"}</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{id ? "Edit attendance" : "Add attendance"}</DialogTitle>
          <DialogDescription>Late minutes and working hours are calculated from the shift start and check-in/out times.</DialogDescription>
        </DialogHeader>
        {open && (
          <SchemaForm
            schema="attendance"
            action={(v) => saveAttendance(v, id)}
            onSuccess={() => setOpen(false)}
            fields={[
              { name: "employee_id", label: "Employee", type: "select", options: employees, required: true, full: true, disabled: !!id },
              { name: "work_date", label: "Working date", type: "date", required: true, disabled: !!id },
              { name: "status", label: "Status", type: "select", options: ATTENDANCE_STATUS, required: true },
              { name: "shift_start_time", label: "Shift start", type: "time", hint: "Blank = employee's allocated shift", showWhen: { field: "status", in: ["present"] } },
              { name: "check_in_time", label: "Check-in", type: "time", required: true, showWhen: { field: "status", in: ["present"] } },
              { name: "check_out_time", label: "Check-out", type: "time", showWhen: { field: "status", in: ["present"] } },
              { name: "is_additional_working_day", label: "Worked on an off day", type: "switch", showWhen: { field: "status", in: ["present"] } },
              { name: "remarks", label: "Remarks", type: "textarea" },
            ]}
            defaultValues={{ shift_start_time: "", check_in_time: "", check_out_time: "", remarks: "", is_additional_working_day: false, status: "present", ...initial }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ImportPanel({ isBranchManager }: { isBranchManager: boolean }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ written: number; skipped: number; errors: string[] } | null>(null);
  const router = useRouter();
  return (
    <form
      className="space-y-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await importAttendance(fd);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          setResult(r.data as { written: number; skipped: number; errors: string[] });
          router.refresh();
        });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Upload an Excel (.xlsx) or CSV file with columns <code>employee_id, work_date, status, check_in, check_out, shift_start, remarks</code>.
        Each employee can have only one record per date. {isBranchManager && "Only employees of your branch are accepted."}
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="File" required className="sm:col-span-2"><Input type="file" name="file" accept=".xlsx,.csv" required /></Field>
        <Field label="Existing records">
          <NativeSelect name="mode" defaultValue="skip">
            <option value="skip">Skip (keep existing)</option>
            <option value="update">Update existing</option>
          </NativeSelect>
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Upload />} Import attendance</Button>
        <Button type="button" variant="outline" asChild><a href="/api/attendance/template"><FileSpreadsheet /> Download template</a></Button>
      </div>
      {result && (
        <div className="rounded-lg border border-border p-4 text-sm">
          <div className="font-medium">{result.written} imported · {result.skipped} unchanged · {result.errors.length} error(s)</div>
          {result.errors.length > 0 && <ul className="mt-2 max-h-60 list-disc space-y-0.5 overflow-y-auto pl-5 text-destructive">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
        </div>
      )}
    </form>
  );
}

export function BulkMarkDialog({ branches, defaultDate }: { branches: Option[]; defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline"><CalendarOff /> Mark holiday / off day</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark a date for all employees</DialogTitle>
          <DialogDescription>Adds Weekly Off or Public Holiday for active employees who don&apos;t already have attendance on that date. Neither counts as an absence.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await bulkMarkStatus({ work_date: String(fd.get("work_date")), status: String(fd.get("status")), branch_id: String(fd.get("branch_id") || "") || undefined });
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message); setOpen(false); router.refresh();
          });
        }}>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Date" required><Input type="date" name="work_date" defaultValue={defaultDate} required /></Field>
            <Field label="Status" required>
              <NativeSelect name="status"><option value="public_holiday">Public Holiday</option><option value="weekly_off">Weekly Off</option></NativeSelect>
            </Field>
            {branches.length > 0 && (
              <Field label="Branch">
                <NativeSelect name="branch_id"><option value="">All branches</option>{branches.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}</NativeSelect>
              </Field>
            )}
          </div>
          <DialogFooter><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Mark date</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
