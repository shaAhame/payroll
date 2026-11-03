import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const serverEnv = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  serviceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
  brevoApiKey: () => process.env.BREVO_API_KEY ?? "",
  brevoSenderEmail: () => process.env.BREVO_SENDER_EMAIL ?? "",
  brevoSenderName: () => process.env.BREVO_SENDER_NAME ?? "",
  brevoWebhookSecret: () => process.env.BREVO_WEBHOOK_SECRET ?? "",
  cronSecret: () => process.env.CRON_SECRET ?? "",
  appUrl: () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
};
