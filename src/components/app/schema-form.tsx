"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, type FieldValues, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/app/form";
import { SCHEMAS, type SchemaKey } from "@/lib/validation/schemas";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/types";

export type Option = { value: string; label: string; group?: string };

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "money" | "number" | "date" | "month" | "time" | "select" | "textarea" | "switch" | "section";
  options?: Option[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
  full?: boolean;
  /** show only when another field has one of these values */
  showWhen?: { field: string; in: string[] };
  disabled?: boolean;
}

function getError(errors: Record<string, unknown>, path: string): string | undefined {
  const e = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], errors) as { message?: string } | undefined;
  return e?.message;
}

function groupOptions(options: Option[]) {
  const groups = new Map<string, Option[]>();
  for (const o of options) groups.set(o.group ?? "", [...(groups.get(o.group ?? "") ?? []), o]);
  return groups;
}

/**
 * Fill other fields from a lookup when one field changes, e.g. picking an employee
 * fills their shift start. On first render only empty fields are filled; on a later
 * change of the source field the looked-up values replace what is there.
 */
export interface AutoFill {
  field: string;
  values: Record<string, Record<string, string>>;
}

export function SchemaForm({ schema, fields, defaultValues, action, submitLabel = "Save", onSuccess, redirectTo, resetOnSuccess, extraData, className, autoFill }: {
  schema: SchemaKey;
  fields: FieldDef[];
  defaultValues: Record<string, unknown>;
  action: (values: unknown) => Promise<ActionResult<unknown>>;
  submitLabel?: string;
  onSuccess?: () => void;
  redirectTo?: string;
  resetOnSuccess?: boolean;
  extraData?: Record<string, unknown>;
  className?: string;
  autoFill?: AutoFill;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FieldValues>({
    // raw: validate in the browser but submit the values as typed. The server action
    // parses them again with the same schema; parsing already-converted values
    // (blank → null, percent → fraction) a second time would reject or change them.
    resolver: zodResolver(SCHEMAS[schema] as never, undefined, { raw: true }) as Resolver<FieldValues>,
    defaultValues,
  });
  const { register, handleSubmit, control, formState, watch, reset, setValue, getValues } = form;
  const values = watch();

  const autoSource = autoFill ? String(values[autoFill.field] ?? "") : "";
  const lastSource = useRef<string | null>(null);
  useEffect(() => {
    if (!autoFill) return;
    const firstRun = lastSource.current === null;
    if (!firstRun && lastSource.current === autoSource) return;
    lastSource.current = autoSource;
    const fill = autoFill.values[autoSource] ?? {};
    for (const [name, value] of Object.entries(fill)) {
      if (firstRun && getValues(name)) continue; // keep a value that is already there (editing)
      setValue(name, value, { shouldDirty: !firstRun, shouldValidate: false });
    }
    if (!firstRun && !autoFill.values[autoSource]) {
      // new choice with nothing to look up: clear what the previous choice filled
      for (const name of new Set(Object.values(autoFill.values).flatMap((v) => Object.keys(v)))) setValue(name, "");
    }
  }, [autoFill, autoSource, getValues, setValue]);

  const onSubmit = handleSubmit(async (data) => {
    setServerError(null);
    const r = await action({ ...data, ...extraData });
    if (!r.ok) {
      setServerError(r.error);
      toast.error(r.error);
      return;
    }
    toast.success(r.message ?? "Saved");
    if (resetOnSuccess) reset(defaultValues);
    onSuccess?.();
    if (redirectTo) router.push(redirectTo);
    else router.refresh();
  });

  return (
    <form onSubmit={onSubmit} className={cn("space-y-5", className)} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((f) => {
          if (f.showWhen && !f.showWhen.in.includes(String(f.showWhen.field.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], values) ?? ""))) return null;
          if (f.type === "section") {
            return <h3 key={f.name} className="border-b border-border pb-2 pt-2 text-sm font-semibold text-foreground sm:col-span-2">{f.label}</h3>;
          }
          const error = getError(formState.errors as Record<string, unknown>, f.name);
          const common = { id: f.name, "aria-invalid": !!error, disabled: f.disabled || formState.isSubmitting, placeholder: f.placeholder };
          let control_: React.ReactNode;
          switch (f.type) {
            case "select":
              control_ = (
                <NativeSelect {...common} {...register(f.name)}>
                  <option value="">{f.placeholder ?? "Select…"}</option>
                  {[...groupOptions(f.options ?? []).entries()].map(([g, opts]) =>
                    g ? (
                      <optgroup key={g} label={g}>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
                    ) : (
                      opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)
                    ),
                  )}
                </NativeSelect>
              );
              break;
            case "textarea":
              control_ = <Textarea {...common} {...register(f.name)} />;
              break;
            case "switch":
              control_ = (
                <Controller
                  control={control}
                  name={f.name}
                  render={({ field }) => (
                    <div className="flex h-9 items-center">
                      <Switch id={f.name} checked={!!field.value} onCheckedChange={field.onChange} disabled={common.disabled} />
                    </div>
                  )}
                />
              );
              break;
            case "money":
              control_ = <Input {...common} inputMode="decimal" className="text-right tabular-nums" {...register(f.name)} />;
              break;
            case "number":
              control_ = <Input {...common} type="number" step="any" {...register(f.name)} />;
              break;
            default:
              control_ = <Input {...common} type={f.type} {...register(f.name)} />;
          }
          return (
            <Field key={f.name} label={f.label} error={error} hint={f.hint} required={f.required} htmlFor={f.name} className={f.full || f.type === "textarea" ? "sm:col-span-2" : undefined}>
              {control_}
            </Field>
          );
        })}
      </div>
      {serverError && <div className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive">{serverError}</div>}
      <div className="flex justify-end gap-2">
        <Button type="submit" disabled={formState.isSubmitting}>
          {formState.isSubmitting && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function FormDialog({ trigger, title, description, wide, ...form }: Omit<Parameters<typeof SchemaForm>[0], "onSuccess"> & {
  trigger: React.ReactNode; title: string; description?: string; wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent wide={wide}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {open && <SchemaForm {...form} onSuccess={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
