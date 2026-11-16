"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/format";

type Toast = { id: number; message: string; tone: "success" | "error" };
const EVENT = "crm-toast";

/** Kratko obaveštenje (npr. potvrda čuvanja). Može se pozvati iz bilo koje klijentske komponente. */
export function toast(message: string, tone: Toast["tone"] = "success") {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { message, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const onToast = (e: Event) => {
      const item = { id: Date.now() + Math.random(), ...(e as CustomEvent).detail } as Toast;
      setItems((list) => [...list, item]);
      setTimeout(() => setItems((list) => list.filter((x) => x.id !== item.id)), 4500);
    };
    window.addEventListener(EVENT, onToast);
    return () => window.removeEventListener(EVENT, onToast);
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {items.map((item) => (
        <div
          key={item.id}
          role="status"
          className={cn(
            "pointer-events-auto max-w-md rounded-md px-4 py-2.5 text-sm font-medium text-white shadow-lg",
            item.tone === "success" ? "bg-emerald-700" : "bg-red-700",
          )}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
