import "server-only";
import { ZodError } from "zod";
import { AuthorizationError } from "@/lib/auth";
import type { ActionResult } from "@/lib/types";

/** Turns database/validation/auth errors into user-facing messages (never leaks internals). */
export function toErrorMessage(e: unknown): string {
  if (e instanceof AuthorizationError) return e.message;
  if (e instanceof ZodError) return e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join("; ");
  const err = e as { message?: string; code?: string; details?: string };
  if (err?.code === "23505") return "A record with the same unique value already exists (duplicate).";
  if (err?.code === "23503") return "This record is referenced by other data and cannot be changed that way.";
  if (err?.code === "23514") return "A value is outside the allowed range: " + (err.message ?? "");
  if (err?.code === "42501") return err.message ?? "You do not have permission to perform this action.";
  if (err?.code === "P0001") return err.message ?? "The operation was rejected by a business rule.";
  if (err?.message) return err.message;
  return "Something went wrong. Please try again.";
}

export async function runAction<T>(fn: () => Promise<T | ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const r = await fn();
    if (r && typeof r === "object" && "ok" in (r as object)) return r as ActionResult<T>;
    return { ok: true, data: r as T };
  } catch (e) {
    console.error("[action]", (e as Error)?.message);
    return { ok: false, error: toErrorMessage(e) };
  }
}

/** Throw a Supabase error object so runAction formats it. */
export function check<T>(res: { data: T; error: unknown }): NonNullable<T> {
  if (res.error) throw res.error;
  return res.data as NonNullable<T>;
}
