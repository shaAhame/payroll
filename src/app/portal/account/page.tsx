import { KV, PageHeader, Section } from "@/components/app/page-header";
import { PasswordForm } from "@/components/app/account-panel";
import { requirePageRole } from "@/lib/auth";

export const metadata = { title: "Account" };

export default async function PortalAccount() {
  const p = await requirePageRole(["employee"]);
  return (
    <>
      <PageHeader title="Account settings" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Sign-in"><div className="divide-y divide-border px-5 py-2"><KV label="Name" value={p.full_name} /><KV label="Email" value={p.email} /></div></Section>
        <Section title="Change password"><div className="p-5"><PasswordForm /></div></Section>
      </div>
    </>
  );
}
