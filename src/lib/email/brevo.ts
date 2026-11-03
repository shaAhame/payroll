import "server-only";
import { serverEnv } from "@/lib/env";

const ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export interface BrevoSendInput {
  to: { email: string; name?: string };
  sender: { email: string; name: string };
  subject: string;
  htmlContent: string;
  textContent?: string;
  attachment?: { name: string; content: string }[];
  /** our notification id — echoed back in webhooks as X-Mailin-custom */
  reference?: string;
  tags?: string[];
}

export type BrevoSendResult =
  | { ok: true; messageId: string }
  | { ok: false; retryable: boolean; status: number; error: string };

/** Server-side only. The API key never leaves the server. */
export async function sendBrevoEmail(input: BrevoSendInput): Promise<BrevoSendResult> {
  const apiKey = serverEnv.brevoApiKey();
  if (!apiKey) return { ok: false, retryable: false, status: 0, error: "BREVO_API_KEY is not configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: input.sender,
        to: [input.to],
        subject: input.subject,
        htmlContent: input.htmlContent,
        textContent: input.textContent,
        attachment: input.attachment,
        tags: input.tags,
        headers: input.reference ? { "X-Mailin-custom": input.reference, "Idempotency-Key": input.reference } : undefined,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string; code?: string };
    if (res.ok && body.messageId) return { ok: true, messageId: body.messageId };
    // 429 / 5xx are temporary; most 4xx (bad address, validation) are permanent. 401/403 = configuration problem, retry later.
    const retryable = res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 403;
    return { ok: false, retryable, status: res.status, error: body.message ?? body.code ?? `Brevo responded ${res.status}` };
  } catch (e) {
    return { ok: false, retryable: true, status: 0, error: (e as Error).name === "AbortError" ? "Brevo request timed out" : (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/** Lightweight connection check for the settings page (GET /v3/account). */
export async function checkBrevoConnection(): Promise<{ ok: boolean; message: string }> {
  const apiKey = serverEnv.brevoApiKey();
  if (!apiKey) return { ok: false, message: "BREVO_API_KEY is not set" };
  try {
    const res = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": apiKey, accept: "application/json" }, cache: "no-store" });
    if (!res.ok) return { ok: false, message: `Brevo responded ${res.status}` };
    const a = (await res.json()) as { email?: string; companyName?: string };
    return { ok: true, message: `Connected${a.companyName ? ` to ${a.companyName}` : ""}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
