"use client";

import { useSearchParams } from "next/navigation";

export function EmailFromParams() {
  const email = useSearchParams().get("email");
  return (
    <>
      We sent a 6-digit code to{" "}
      {email ? <span className="font-medium wrap-anywhere text-foreground">{email}</span> : "your inbox"}. It expires in
      10 minutes.
    </>
  );
}
