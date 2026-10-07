import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth-guards";

export default function AdminIndexPage() {
  return (
    <Suspense>
      <RedirectToUsers />
    </Suspense>
  );
}

async function RedirectToUsers() {
  await requireAdmin();
  return redirect("/admin/users");
}
