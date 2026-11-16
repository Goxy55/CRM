"use client";
import { useRef, useState } from "react";
import { createTenantAction, inviteTenantAdminAction, setLogoAction, setTenantStatusAction, switchTenantAction, updateOrganizationAction } from "@/app/actions";
import { CURRENCIES } from "@/lib/domain";
import { formatDateTime } from "@/lib/format";
import type { MembershipSummary } from "@/server/context";
import type { Organization, TenantRow } from "@/server/services/tenants";
import { labels } from "@/i18n";
import { InviteLink } from "./admin-panels";
import { useAction } from "./controls";
import { toast } from "./toast";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, TableWrap, Td, Th } from "./ui";

export function OrganizationPanel({ organization }: { organization: Organization }) {
  const { pending, run } = useAction();
  const [values, setValues] = useState({ name: organization.name, defaultCurrency: organization.defaultCurrency });
  const file = useRef<HTMLInputElement>(null);
  return (
    <Card>
      <CardHeader title="Organizacija" description="Naziv i logo se prikazuju u navigaciji i na izvezenim izveštajima." />
      <form className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => updateOrganizationAction(values), "Podešavanja su sačuvana."); }}>
        <Field label="Naziv organizacije" htmlFor="org-name" required><Input id="org-name" required value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} /></Field>
        <Field label="Podrazumevana valuta" htmlFor="org-currency" hint="Predlaže se pri unosu nove saradnje.">
          <Select id="org-currency" value={values.defaultCurrency} onChange={(e) => setValues({ ...values, defaultCurrency: e.target.value })}>
            {[...new Set([...CURRENCIES, organization.defaultCurrency])].map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2"><Button type="submit" disabled={pending}>Sačuvaj</Button></div>
      </form>
      <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 p-4">
        {organization.hasLogo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/logo?v=${Date.now()}`} alt="Trenutni logo" className="h-12 w-12 rounded border border-slate-200 object-contain" />
        )}
        <Field label="Logo" htmlFor="org-logo" hint="PNG, JPEG ili WebP, do 256 KB.">
          <Input id="org-logo" ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="py-1.5" />
        </Field>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            const chosen = file.current?.files?.[0];
            if (!chosen) return toast("Izaberite sliku.", "error");
            const form = new FormData();
            form.set("logo", chosen);
            run(() => setLogoAction(form), "Logo je postavljen.", () => { if (file.current) file.current.value = ""; });
          }}
        >
          Postavi logo
        </Button>
        {organization.hasLogo && <Button variant="danger" disabled={pending} onClick={() => run(() => setLogoAction(null), "Logo je uklonjen.")}>Ukloni logo</Button>}
      </div>
    </Card>
  );
}

export function PasswordPanel() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const next = String(data.get("next"));
    if (next.length < 12) return setError("Nova lozinka mora imati najmanje 12 znakova.");
    if (next !== data.get("confirm")) return setError("Lozinke se ne podudaraju.");
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: data.get("current"), newPassword: next, revokeOtherSessions: true }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      form.reset();
      toast("Lozinka je promenjena. Ostale sesije su odjavljene.");
    } else setError(res ? "Trenutna lozinka nije ispravna." : "Server trenutno nije dostupan.");
  }
  return (
    <Card>
      <CardHeader title="Promena lozinke" />
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        {error && <div className="sm:col-span-3"><Alert tone="error">{error}</Alert></div>}
        <Field label="Trenutna lozinka" htmlFor="current"><Input id="current" name="current" type="password" autoComplete="current-password" required /></Field>
        <Field label="Nova lozinka" htmlFor="next" hint="Najmanje 12 znakova."><Input id="next" name="next" type="password" autoComplete="new-password" minLength={12} required /></Field>
        <Field label="Ponovite novu lozinku" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required /></Field>
        <div className="sm:col-span-3"><Button type="submit" disabled={busy}>{busy ? "Čuvanje…" : "Promeni lozinku"}</Button></div>
      </form>
    </Card>
  );
}

export function TenantSwitcher({ memberships, current }: { memberships: MembershipSummary[]; current: string }) {
  const { pending, run } = useAction();
  if (memberships.length < 2) return null;
  return (
    <Card>
      <CardHeader title="Aktivna organizacija" description="Vaš nalog je član više organizacija. Podaci se prikazuju samo za izabranu." />
      <div className="p-4">
        <Select aria-label="Aktivna organizacija" className="sm:max-w-sm" value={current} disabled={pending} onChange={(e) => run(() => switchTenantAction(e.target.value), "Organizacija je promenjena.", () => window.location.assign("/"))}>
          {memberships.map((m) => <option key={m.tenantId} value={m.tenantId}>{m.tenantName} ({labels.role[m.role]})</option>)}
        </Select>
      </div>
    </Card>
  );
}

export function PlatformPanel({ tenants }: { tenants: TenantRow[] }) {
  const { pending, run } = useAction();
  const empty = { name: "", adminEmail: "", adminFirstName: "", adminLastName: "" };
  const [values, setValues] = useState(empty);
  const [link, setLink] = useState<{ link: string; mailed: boolean } | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const set = (key: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setValues({ ...values, [key]: e.target.value });
  const adminFields = (prefix: string) => (
    <>
      <Field label="Ime administratora" htmlFor={`${prefix}-first`} required><Input id={`${prefix}-first`} required value={values.adminFirstName} onChange={set("adminFirstName")} /></Field>
      <Field label="Prezime administratora" htmlFor={`${prefix}-last`} required><Input id={`${prefix}-last`} required value={values.adminLastName} onChange={set("adminLastName")} /></Field>
      <Field label="Email administratora" htmlFor={`${prefix}-email`} required><Input id={`${prefix}-email`} type="email" required value={values.adminEmail} onChange={set("adminEmail")} /></Field>
    </>
  );
  return (
    <div className="space-y-4">
      {link && <InviteLink {...link} />}
      <Card>
        <CardHeader title="Organizacije" description="Administrator platforme upravlja organizacijama i njihovim administratorskim nalozima. Klijenti i poslovni podaci organizacija ovde nisu dostupni." />
        {tenants.length ? (
          <TableWrap>
            <thead><tr><Th>Organizacija</Th><Th>Status</Th><Th className="text-right">Aktivnih korisnika</Th><Th>Administratori</Th><Th>Kreirana</Th><Th>Akcije</Th></tr></thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.name}</Td>
                  <Td><Badge tone={t.status === "active" ? "green" : "slate"}>{labels.tenantStatus[t.status]}</Badge></Td>
                  <Td className="text-right tabular-nums">{t.users}</Td>
                  <Td className="max-w-xs whitespace-normal">{t.admins ?? (t.pendingInvitations ? "Pozivnica na čekanju" : "—")}</Td>
                  <Td className="whitespace-nowrap">{formatDateTime(t.createdAt)}</Td>
                  <Td>
                    <span className="flex gap-2">
                      <Button variant="secondary" className="min-h-8 px-2 py-1 text-xs" onClick={() => { setInviting(t.id); setValues(empty); }}>Pozovi administratora</Button>
                      <Button
                        variant={t.status === "active" ? "danger" : "secondary"}
                        className="min-h-8 px-2 py-1 text-xs"
                        disabled={pending}
                        onClick={() => {
                          if (t.status === "active" && !window.confirm(`Deaktivirati organizaciju „${t.name}“? Njeni korisnici gube pristup dok se ponovo ne aktivira.`)) return;
                          run(() => setTenantStatusAction(t.id, t.status === "active" ? "inactive" : "active"), "Status organizacije je promenjen.");
                        }}
                      >
                        {t.status === "active" ? "Deaktiviraj" : "Aktiviraj"}
                      </Button>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState title="Još nema organizacija" description="Kreirajte prvu organizaciju i pozovite njenog administratora." />
        )}
        {inviting && (
          <form
            className="grid grid-cols-1 gap-3 border-t border-slate-200 bg-slate-50 p-4 sm:grid-cols-3"
            onSubmit={(e) => { e.preventDefault(); run(() => inviteTenantAdminAction(inviting, values), undefined, (data) => { setLink(data); setInviting(null); setValues(empty); }); }}
          >
            <p className="text-sm font-medium sm:col-span-3">Novi administrator: {tenants.find((t) => t.id === inviting)?.name}</p>
            {adminFields("invite")}
            <div className="flex gap-2 sm:col-span-3">
              <Button type="submit" disabled={pending}>Pošalji pozivnicu</Button>
              <Button type="button" variant="secondary" onClick={() => setInviting(null)}>Otkaži</Button>
            </div>
          </form>
        )}
      </Card>
      {!inviting && (
        <Card>
          <CardHeader title="Nova organizacija" description="Organizacija dobija početne šifarnike, a njen administrator pozivnicu za aktivaciju naloga." />
          <form className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => createTenantAction(values), "Organizacija je kreirana.", (data) => { setLink(data); setValues(empty); }); }}>
            <Field label="Naziv organizacije" htmlFor="tenant-name" required className="sm:col-span-2"><Input id="tenant-name" required value={values.name} onChange={set("name")} /></Field>
            {adminFields("new")}
            <div className="sm:col-span-2"><Button type="submit" disabled={pending}>Kreiraj organizaciju</Button></div>
          </form>
        </Card>
      )}
    </div>
  );
}
