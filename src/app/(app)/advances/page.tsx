import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { PlansView } from "./plans-view";

export const metadata = { title: "Salary Advances" };

export default async function AdvancesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageRole(ADMIN_ROLES);
  return <PlansView kind="advance" params={await searchParams} />;
}
