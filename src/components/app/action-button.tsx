"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/types";

/**
 * Runs a server action with loading state, optional confirmation (and optional
 * required reason), then toasts and refreshes the page data.
 */
export function ActionButton<T>({
  action, children, confirm, reason, successMessage, onDone, redirectTo, ...props
}: Omit<ButtonProps, "onClick" | "action"> & {
  action: (reason?: string) => Promise<ActionResult<T>>;
  confirm?: { title: string; description: React.ReactNode; confirmLabel?: string; destructive?: boolean };
  reason?: { label: string; placeholder?: string };
  successMessage?: string;
  onDone?: (r: ActionResult<T>) => void;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const run = () =>
    start(async () => {
      const r = await action(reason ? text : undefined);
      if (r.ok) {
        toast.success(r.message ?? successMessage ?? "Done");
        setOpen(false);
        setText("");
        if (redirectTo) router.push(redirectTo); else router.refresh();
      } else {
        toast.error(r.error);
      }
      onDone?.(r);
    });

  if (!confirm) {
    return (
      <Button {...props} disabled={pending || props.disabled} onClick={run}>
        {pending && <Loader2 className="animate-spin" />}
        {children}
      </Button>
    );
  }

  return (
    <>
      <Button {...props} disabled={pending || props.disabled} onClick={() => setOpen(true)}>
        {pending && <Loader2 className="animate-spin" />}
        {children}
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">{confirm.description}</div>
          </AlertDialogDescription>
          {reason && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="action-reason">{reason.label}</label>
              <Textarea id="action-reason" value={text} onChange={(e) => setText(e.target.value)} placeholder={reason.placeholder} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant={confirm.destructive ? "destructive" : "default"}
                disabled={pending || (!!reason && text.trim().length < 3)}
                onClick={(e) => { e.preventDefault(); run(); }}
              >
                {pending && <Loader2 className="animate-spin" />}
                {confirm.confirmLabel ?? "Confirm"}
              </Button>
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
