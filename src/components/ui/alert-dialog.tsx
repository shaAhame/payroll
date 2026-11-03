"use client";
import * as React from "react";
import * as AD from "@radix-ui/react-alert-dialog";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export const AlertDialog = AD.Root;
export const AlertDialogTrigger = AD.Trigger;

export function AlertDialogContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof AD.Content>) {
  return (
    <AD.Portal>
      <AD.Overlay className="fixed inset-0 z-50 bg-slate-950/40" />
      <AD.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-border bg-card p-6 shadow-xl",
          className,
        )}
        {...props}
      />
    </AD.Portal>
  );
}
export const AlertDialogTitle = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof AD.Title>) => (
  <AD.Title className={cn("text-lg font-semibold", className)} {...p} />
);
export const AlertDialogDescription = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof AD.Description>) => (
  <AD.Description className={cn("text-sm text-muted-foreground", className)} {...p} />
);
export const AlertDialogCancel = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof AD.Cancel>) => (
  <AD.Cancel className={cn(buttonVariants({ variant: "outline" }), className)} {...p} />
);
export const AlertDialogAction = AD.Action;
