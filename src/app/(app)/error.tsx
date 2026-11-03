"use client";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-destructive/20 bg-destructive-soft p-6">
      <h2 className="font-semibold text-destructive">Something went wrong loading this page</h2>
      <p className="mt-1 text-sm text-muted-foreground">{error.digest ? `Reference: ${error.digest}. ` : ""}Please try again. If it keeps happening, contact your administrator.</p>
      <Button className="mt-4" variant="outline" onClick={reset}>Try again</Button>
    </div>
  );
}
