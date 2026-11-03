"use client";
import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadEmployeePhoto } from "../actions";

export function PhotoUpload({ employeeId }: { employeeId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const fd = new FormData();
          fd.set("photo", f);
          start(async () => {
            const r = await uploadEmployeePhoto(employeeId, fd);
            if (r.ok) { toast.success("Photo updated"); router.refresh(); } else toast.error(r.error);
          });
        }} />
      <Button variant="outline" size="sm" disabled={pending} onClick={() => ref.current?.click()}><Upload /> {pending ? "Uploading…" : "Upload photo"}</Button>
    </>
  );
}
