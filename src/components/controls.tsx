"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { revealJmbgAction, setClientStatusAction, setCollaborationStatusAction } from "@/app/actions";
import type { ActionResult } from "@/server/session";
import { toast } from "./toast";
import { Button, Select } from "./ui";

/** Poziva server akciju, prikazuje ishod i osvežava podatke stranice. */
export function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = <T,>(action: () => Promise<ActionResult<T>>, success?: string, onDone?: (data: T) => void) =>
    start(async () => {
      const result = await action();
      if (!result.ok) return toast(result.error, "error");
      if (success) toast(success);
      onDone?.(result.data);
      router.refresh();
    });
  return { pending, run };
}

/** Brza promena statusa klijenta ili saradnje. Arhiviranje i otkazivanje traže potvrdu. */
export function StatusSelect({
  kind,
  id,
  value,
  options,
}: {
  kind: "client" | "collaboration";
  id: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  const { pending, run } = useAction();
  return (
    <Select
      aria-label="Promena statusa"
      value={value}
      disabled={pending}
      className="!w-auto min-w-36"
      onChange={(e) => {
        const next = e.target.value;
        const risky = next === "archived" ? "Arhivirati klijenta? Neće se prikazivati u listama i izveštajima." : next === "cancelled" ? "Označiti saradnju kao otkazanu?" : "";
        if (risky && !window.confirm(risky)) return;
        run(() => (kind === "client" ? setClientStatusAction(id, next) : setCollaborationStatusAction(id, next)), "Status je promenjen.");
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </Select>
  );
}

/** JMBG je podrazumevano maskiran; prikaz pune vrednosti se evidentira. */
export function JmbgValue({ clientId, canReveal }: { clientId: string; canReveal: boolean }) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (value)
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono">{value}</span>
        <button type="button" className="text-xs text-brand-700 underline" onClick={() => setValue(null)}>Sakrij</button>
      </span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono tracking-wider" aria-label="JMBG je sakriven">•••••••••••••</span>
      {canReveal && (
        <Button
          type="button"
          variant="secondary"
          className="min-h-8 px-2 py-1 text-xs"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const result = await revealJmbgAction(clientId);
            setBusy(false);
            if (result.ok) setValue(result.data);
            else toast(result.error, "error");
          }}
        >
          Prikaži
        </Button>
      )}
    </span>
  );
}
