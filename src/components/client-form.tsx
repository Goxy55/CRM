"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { saveClientAction } from "@/app/actions";
import { CLIENT_STATUSES, CLIENT_TYPES, hasBusiness, hasPersonName } from "@/lib/domain";
import { clientFormSchema, type ClientFormValues } from "@/lib/schemas";
import type { DuplicateMatch } from "@/server/services/clients";
import type { Lookups } from "@/server/services/lookups";
import { labels } from "@/i18n";
import { toast } from "./toast";
import { Alert, Button, Card, CardHeader, Field, Input, LinkButton, Select, Textarea } from "./ui";

type Props = {
  id?: string;
  initial: ClientFormValues;
  lookups: Lookups;
  persons: { id: string; name: string }[];
  canSensitive: boolean;
  hasJmbg: boolean;
};

export function ClientForm({ id, initial, lookups, persons, canSensitive, hasJmbg }: Props) {
  const router = useRouter();
  const [formError, setFormError] = useState("");
  const [duplicates, setDuplicates] = useState<{ blocking: boolean; matches: DuplicateMatch[] } | null>(null);
  const { register, handleSubmit, watch, setError, setValue, formState } = useForm<ClientFormValues>({
    resolver: zodResolver(clientFormSchema),
    defaultValues: initial,
  });
  const { errors, isSubmitting } = formState;
  const type = watch("type");
  const agricultural = type === "farm" || watch("agricultural");
  const productionIds = watch("productionIds");
  const person = hasPersonName(type);
  const business = hasBusiness(type);

  async function save(values: ClientFormValues, confirm: boolean) {
    setFormError("");
    const result = await saveClientAction(id ?? null, values, confirm);
    if (result.ok) {
      toast(id ? "Izmene su sačuvane." : "Klijent je dodat.");
      router.push(`/klijenti/${result.data.id}`);
      router.refresh();
      return;
    }
    if (result.code === "CONFLICT" && result.details) {
      setDuplicates(result.details as { blocking: boolean; matches: DuplicateMatch[] });
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setDuplicates(null);
    for (const [field, messages] of Object.entries(result.fieldErrors ?? {}))
      setError(field as keyof ClientFormValues, { message: messages[0] });
    setFormError(result.error);
  }

  const field = (name: keyof ClientFormValues) => ({
    id: name,
    "aria-invalid": !!errors[name],
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
    ...register(name),
  });
  const error = (name: keyof ClientFormValues) => errors[name]?.message as string | undefined;
  const activeOr = <T extends { id: string; active: boolean }>(list: T[], current: string) =>
    list.filter((x) => x.active || x.id === current);

  return (
    <form onSubmit={handleSubmit((v) => save(v, false))} noValidate className="space-y-5">
      {formError && <Alert tone="error">{formError}</Alert>}
      {duplicates && (
        <Alert
          tone={duplicates.blocking ? "error" : "warning"}
          title={duplicates.blocking ? "Klijent sa istim identifikatorom već postoji" : "Mogući duplikati"}
        >
          {duplicates.matches.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {duplicates.matches.map((m) => (
                <li key={m.field + m.clientId}>
                  {labels.duplicateField[m.field]}:{" "}
                  <Link href={`/klijenti/${m.clientId}`} target="_blank" className="font-medium underline">
                    {m.displayName}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {duplicates.blocking ? (
            <p className="mt-2">Matični broj, PIB, BPG i JMBG moraju biti jedinstveni u organizaciji. Otvorite postojećeg klijenta ili ispravite unos.</p>
          ) : (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p>Isti email ili telefon ne znači nužno da je reč o istom klijentu.</p>
              <Button type="button" variant="secondary" disabled={isSubmitting} onClick={handleSubmit((v) => save(v, true))}>
                Ipak sačuvaj
              </Button>
            </div>
          )}
        </Alert>
      )}

      <Card>
        <CardHeader title="Osnovni podaci" />
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Field label="Tip klijenta" htmlFor="type" required>
            <Select {...field("type")}>
              {CLIENT_TYPES.map((v) => (
                <option key={v} value={v}>{labels.clientType[v]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status klijenta" htmlFor="status" required>
            <Select {...field("status")}>
              {CLIENT_STATUSES.map((v) => (
                <option key={v} value={v}>{labels.clientStatus[v]}</option>
              ))}
            </Select>
          </Field>
          {business && (
            <Field label={type === "entrepreneur" ? "Naziv radnje" : "Naziv firme"} htmlFor="companyName" required error={error("companyName")} className="sm:col-span-2">
              <Input {...field("companyName")} />
            </Field>
          )}
          {person && (
            <>
              <Field label="Ime" htmlFor="firstName" required={!business} error={error("firstName")}>
                <Input {...field("firstName")} autoComplete="off" />
              </Field>
              <Field label="Prezime" htmlFor="lastName" required={!business} error={error("lastName")}>
                <Input {...field("lastName")} autoComplete="off" />
              </Field>
            </>
          )}
          {business && (
            <>
              <Field label="Matični broj" htmlFor="registrationNumber" hint="8 cifara" error={error("registrationNumber")}>
                <Input {...field("registrationNumber")} inputMode="numeric" />
              </Field>
              <Field label="PIB" htmlFor="taxNumber" hint="9 cifara" error={error("taxNumber")}>
                <Input {...field("taxNumber")} inputMode="numeric" />
              </Field>
            </>
          )}
          {person && canSensitive && (
            <Field
              label="JMBG"
              htmlFor="jmbg"
              error={error("jmbg")}
              hint={hasJmbg ? "JMBG je upisan. Ostavite prazno da ostane isti, ili unesite novi." : "Opciono. Unosi se samo kada postoji pravni osnov obrade; čuva se šifrovano."}
            >
              <Input {...field("jmbg")} inputMode="numeric" autoComplete="off" />
              {hasJmbg && (
                <label className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" {...register("removeJmbg")} className="h-4 w-4" />
                  Ukloni upisani JMBG
                </label>
              )}
            </Field>
          )}
          {(type === "farm" || type === "entrepreneur") && (
            <Field label="Povezano fizičko lice" htmlFor="linkedPersonId" error={error("linkedPersonId")} hint="Klijent – fizičko lice koje stoji iza gazdinstva ili radnje.">
              <Select {...field("linkedPersonId")}>
                <option value="">—</option>
                {persons.filter((p) => p.id !== id).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Kontakt i adresa" />
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Field label="Telefon" htmlFor="phone" error={error("phone")}>
            <Input {...field("phone")} type="tel" />
          </Field>
          <Field label="Email" htmlFor="email" error={error("email")}>
            <Input {...field("email")} type="email" />
          </Field>
          <Field label="Adresa" htmlFor="address" error={error("address")} className="sm:col-span-2">
            <Input {...field("address")} />
          </Field>
          <Field label="Mesto" htmlFor="city" error={error("city")}>
            <Input {...field("city")} />
          </Field>
          <Field label="Opština" htmlFor="municipality" error={error("municipality")}>
            <Input {...field("municipality")} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Poslovni odnos" />
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Field label="Delatnost" htmlFor="activityId" error={error("activityId")}>
            <Select {...field("activityId")}>
              <option value="">—</option>
              {activeOr(lookups.activities, initial.activityId).map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Odgovorna osoba" htmlFor="responsibleUserId" error={error("responsibleUserId")}>
            <Select {...field("responsibleUserId")}>
              <option value="">Nije dodeljeno</option>
              {activeOr(lookups.members, initial.responsibleUserId).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Datum prvog kontakta" htmlFor="firstContactDate" error={error("firstContactDate")}>
            <Input {...field("firstContactDate")} type="date" />
          </Field>
          <Field label="Napomena" htmlFor="note" error={error("note")} className="sm:col-span-2">
            <Textarea {...field("note")} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Poljoprivreda" description="Popunjava se samo za klijente koji se bave poljoprivrednom proizvodnjom." />
        <div className="space-y-4 p-4 sm:p-5">
          {type !== "farm" && (
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" {...register("agricultural")} className="h-4 w-4" />
              Klijent se bavi poljoprivrednom proizvodnjom
            </label>
          )}
          {agricultural && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Broj poljoprivrednog gazdinstva (BPG)" htmlFor="bpg" hint="12 cifara" error={error("bpg")}>
                <Input {...field("bpg")} inputMode="numeric" />
              </Field>
              <Field label="Primarna proizvodnja" htmlFor="primaryProductionId" error={error("primaryProductionId")}>
                <Select {...field("primaryProductionId")} disabled={!productionIds.length}>
                  <option value="">—</option>
                  {lookups.productions.filter((p) => productionIds.includes(p.id)).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
              <fieldset className="sm:col-span-2">
                <legend className="mb-1.5 text-sm font-medium text-slate-700">Vrste proizvodnje</legend>
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
                  {activeOr(lookups.productions, "").concat(lookups.productions.filter((p) => !p.active && initial.productionIds.includes(p.id))).map((p) => (
                    <label key={p.id} className="flex min-h-9 items-center gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        value={p.id}
                        {...register("productionIds", {
                          onChange: (e) => {
                            if (!e.target.checked && watch("primaryProductionId") === p.id) setValue("primaryProductionId", "");
                          },
                        })}
                        className="h-4 w-4"
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "Čuvanje…" : "Sačuvaj"}</Button>
        <LinkButton href={id ? `/klijenti/${id}` : "/klijenti"} variant="secondary">Otkaži</LinkButton>
      </div>
    </form>
  );
}
