"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

/**
 * Reads URL search params on mount and fires toast messages for known values.
 * Keeps the account page as a Server Component while still showing one-shot
 * toasts triggered by server-side redirects (e.g., after email verification).
 */
export function SearchParamToast() {
  const params = useSearchParams();

  useEffect(() => {
    if (params.get("emailChanged") === "1") {
      toast.success("Email address updated successfully.");
    }
  }, [params]);

  return null;
}
