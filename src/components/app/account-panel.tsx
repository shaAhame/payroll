"use client";
import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/form";
import { changePassword } from "@/app/actions/session";

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="max-w-sm space-y-4" id="password">
      <Field label="New password" htmlFor="password-new" hint="At least 10 characters"><Input id="password-new" name="password" type="password" autoComplete="new-password" required /></Field>
      <Field label="Confirm new password" htmlFor="password-confirm"><Input id="password-confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
      {state && <p className={state.ok ? "text-sm text-success" : "text-sm text-destructive"}>{state.message}</p>}
      <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Update password</Button>
    </form>
  );
}
