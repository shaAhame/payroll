import { ADMIN_ROLES, requirePageRole } from "@/lib/auth";
import { PlansView } from "../advances/plans-view";

export const metadata = { title: "Loan Management" };

export default async function LoansPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageRole(ADMIN_ROLES);
  return <PlansView kind="loan" params={await searchParams} />;
}
