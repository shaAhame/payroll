"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadLogo } from "../actions";

export function LogoForm() {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      start(async () => { const r = await uploadLogo(fd); if (r.ok) { toast.success(r.message); router.refresh(); } else toast.error(r.error); });
    }}>
      <Input type="file" name="logo" accept="image/png,image/jpeg" required className="sm:max-w-xs" />
      <Button type="submit" variant="outline" disabled={pending}><Upload /> {pending ? "Uploading…" : "Upload logo"}</Button>
    </form>
  );
}
