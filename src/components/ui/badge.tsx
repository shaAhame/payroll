import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", {
  variants: {
    variant: {
      neutral: "bg-muted text-muted-foreground ring-border",
      info: "bg-info-soft text-info ring-info/20",
      success: "bg-success-soft text-success ring-success/20",
      warning: "bg-warning-soft text-warning ring-warning/25",
      danger: "bg-destructive-soft text-destructive ring-destructive/20",
      primary: "bg-primary/10 text-primary ring-primary/20",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
