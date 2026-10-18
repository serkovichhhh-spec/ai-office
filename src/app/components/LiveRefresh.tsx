"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server page while work is in progress. Stops as soon as nothing is active. */
export function LiveRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return active ? <span className="sr-only" aria-live="polite">Оновлюється автоматично</span> : null;
}
