"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { saveCollaborationAction } from "@/app/actions";
import { COLLABORATION_STATUSES, CURRENCIES } from "@/lib/domain";
import { collaborationFormSchema, type CollaborationFormValues } from "@/lib/schemas";
import type { Lookups } from "@/server/services/lookups";
import { labels } from "@/i18n";
import { toast } from "./toast";
import { Alert, Button, Card, Field, Input, LinkButton, Select, Textarea } from "./ui";

type Props = {
  id?: string;
  initial: CollaborationFormValues;
  lookups: Lookups;
  clients: { id: string; name: string }[];
  readOnly?: boolean;
};

export function CollaborationForm({ id, initial, lookups, clients, readOnly }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState("");
  const { register, handleSubmit, setError, formState } = useForm<CollaborationFormValues>({
    resolver: zodResolver(collaborationFormSchema),
    defaultValues: initial,
  });
  const { errors, isSubmitting } = formState;

  async function save(values: CollaborationFormValues) {
    setFormError("");
    const result = await saveCollaborationAction(id ?? null, values);
    if (result.ok) {
      toast(id ? "Izmene su sačuvane." : "Saradnja je dodata.");
      router.push(`/klijenti/${values.clientId}?tab=saradnje`);
      router.refresh();
      return;
    }
    for (const [field, messages] of Object.entries(result.fieldErrors ?? {}))
      setError(field as keyof CollaborationFormValues, { message: messages[0] });
    setFormError(result.error);
  }
  const field = (name: keyof CollaborationFormValues) => ({
    id: name,
    disabled: readOnly,
    "aria-invalid": !!errors[name],
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
    ...register(name),
  });
  const error = (name: keyof CollaborationFormValues) => errors[name]?.message as string | undefined;
  const currencies = [...new Set([...CURRENCIES, initial.currency])];

  return (
    <form onSubmit={handleSubmit(save)} noValidate className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}
      <Card>
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Field label="Klijent" htmlFor="clientId" required error={error("clientId")}>
            <Select {...field("clientId")} disabled={readOnly || !!id}>
              <option value="">Izaberite klijenta</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Vrsta usluge" htmlFor="serviceId" required error={error("serviceId")}>
            <Select {...field("serviceId")}>
              <option value="">Izaberite uslugu</option>
              {lookups.services.filter((s) => s.active || s.id === initial.serviceId).map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.active ? "" : " (deaktivirana)"}</option>
              ))}
            </Select>
          </Field>
          <Field label="Naziv saradnje" htmlFor="title" required error={error("title")} className="sm:col-span-2">
            <Input {...field("title")} />
          </Field>
          <Field label="Kratak opis" htmlFor="description" error={error("description")} className="sm:col-span-2">
            <Textarea {...field("description")} rows={2} />
          </Field>
          <Field label="Datum početka" htmlFor="startDate" error={error("startDate")}>
            <Input {...field("startDate")} type="date" />
          </Field>
          <Field label="Planirani datum završetka" htmlFor="plannedEndDate" error={error("plannedEndDate")}>
            <Input {...field("plannedEndDate")} type="date" />
          </Field>
          <Field label="Status saradnje" htmlFor="status" required>
            <Select {...field("status")}>
              {COLLABORATION_STATUSES.map((s) => <option key={s} value={s}>{labels.collaborationStatus[s]}</option>)}
            </Select>
          </Field>
          <Field label="Odgovorna osoba" htmlFor="responsibleUserId" error={error("responsibleUserId")}>
            <Select {...field("responsibleUserId")}>
              <option value="">Nije dodeljeno</option>
              {lookups.members.filter((m) => m.active || m.id === initial.responsibleUserId).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Ugovorena vrednost" htmlFor="contractValue" hint="Iznos sa najviše dve decimale, npr. 125000,50" error={error("contractValue")}>
            <Input {...field("contractValue")} inputMode="decimal" />
          </Field>
          <Field label="Valuta" htmlFor="currency" error={error("currency")}>
            <Select {...field("currency")}>
              {currencies.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="Napomena" htmlFor="note" error={error("note")} className="sm:col-span-2">
            <Textarea {...field("note")} />
          </Field>
        </div>
      </Card>
      <div className="flex flex-wrap gap-2">
        {!readOnly && <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Čuvanje…" : "Sačuvaj"}</Button>}
        <LinkButton href={initial.clientId ? `/klijenti/${initial.clientId}?tab=saradnje` : "/saradnje"} variant="secondary">
          {readOnly ? "Nazad" : "Otkaži"}
        </LinkButton>
      </div>
    </form>
  );
}
