"use client";
import { useState } from "react";
import {
  approveAccessRequestAction, inviteUserAction, rejectAccessRequestAction, revokeInvitationAction, saveLookupAction,
  saveServiceAction, setServiceActiveAction, setSignupLinkAction, updateMemberAction,
} from "@/app/actions";
import type { AccessRequest } from "@/server/services/signup";
import { toast } from "./toast";
import { formatDateTime } from "@/lib/format";
import type { LookupKind, ServiceRow } from "@/server/services/catalog";
import type { Option } from "@/server/services/lookups";
import type { Member, PendingInvitation } from "@/server/services/users";
import { labels } from "@/i18n";
import { useAction } from "./controls";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select, TableWrap, Td, Textarea, Th } from "./ui";

const PERMISSIONS = ["canView", "canCreate", "canEdit", "canExport", "canViewSensitive"] as const;
type PermissionKey = (typeof PERMISSIONS)[number];
type Access = { role: "admin" | "user" } & Record<PermissionKey, boolean>;

/** Polja za ulogu i dozvole. Administrator uvek ima pregled, unos, izmenu i izvoz. */
function AccessFields({ value, onChange, idPrefix }: { value: Access; onChange: (next: Access) => void; idPrefix: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
      <Field label="Uloga" htmlFor={`${idPrefix}-role`}>
        <Select id={`${idPrefix}-role`} value={value.role} onChange={(e) => onChange({ ...value, role: e.target.value as Access["role"] })}>
          <option value="user">{labels.role.user}</option>
          <option value="admin">{labels.role.admin}</option>
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-slate-700">Dozvole</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {PERMISSIONS.map((key) => {
            const implied = value.role === "admin" && key !== "canViewSensitive";
            return (
              <label key={key} className="flex min-h-9 items-center gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={implied || value[key]}
                  disabled={implied}
                  onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
                />
                {labels.permission[key]}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

const DEFAULT_ACCESS: Access = { role: "user", canView: true, canCreate: true, canEdit: true, canExport: false, canViewSensitive: false };

export function InviteLink({ link, mailed }: { link: string; mailed: boolean }) {
  return (
    <Alert tone={mailed ? "success" : "warning"} title={mailed ? "Pozivnica je poslata emailom" : "Pozivnica je kreirana, ali email nije poslat"}>
      <p>{mailed ? "Link možete i sami proslediti korisniku:" : "Slanje pošte nije podešeno ili nije uspelo. Prosledite korisniku ovaj link bezbednim kanalom:"}</p>
      <p className="mt-1 font-mono text-xs break-all select-all">{link}</p>
      <p className="mt-1 text-xs">Link važi 7 dana i može se iskoristiti jednom.</p>
    </Alert>
  );
}

/** Link za samostalnu prijavu i zahtevi koji čekaju odobrenje. */
export function AccessRequestsPanel({ requests, signupLink }: { requests: AccessRequest[]; signupLink: string | null }) {
  const { pending, run } = useAction();
  const [grants, setGrants] = useState<Record<string, Access>>({});
  const grantFor = (id: string) => grants[id] ?? DEFAULT_ACCESS;
  return (
    <div className="space-y-4">
      {requests.length > 0 && (
        <Card>
          <CardHeader title={`Zahtevi za pristup (${requests.length})`} description="Osobe koje su se prijavile preko linka. Do odobrenja nemaju pristup nijednom podatku." />
          <ul className="divide-y divide-slate-200">
            {requests.map((r) => (
              <li key={r.userId} className="space-y-3 p-4">
                <div>
                  <p className="font-medium">{r.firstName} {r.lastName}</p>
                  <p className="text-sm text-slate-600">{r.email} · zahtev poslat {formatDateTime(r.requestedAt)}</p>
                </div>
                <AccessFields idPrefix={`req-${r.userId}`} value={grantFor(r.userId)} onChange={(next) => setGrants({ ...grants, [r.userId]: next })} />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={pending} onClick={() => run(() => approveAccessRequestAction(r.userId, grantFor(r.userId)), `Pristup je odobren: ${r.firstName} ${r.lastName}.`)}>
                    Odobri
                  </Button>
                  <Button
                    variant="danger"
                    disabled={pending}
                    onClick={() => {
                      if (window.confirm(`Odbiti zahtev: ${r.firstName} ${r.lastName}?`)) run(() => rejectAccessRequestAction(r.userId), "Zahtev je odbijen.");
                    }}
                  >
                    Odbij
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <CardHeader
          title="Link za prijavu"
          description="Ko ima ovaj link može da napravi nalog i zatraži pristup vašoj organizaciji. Pristup dobija tek kada ga odobrite."
        />
        <div className="space-y-3 p-4">
          {signupLink ? (
            <>
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs break-all select-all">{signupLink}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => navigator.clipboard?.writeText(signupLink).then(() => toast("Link je kopiran."), () => toast("Kopirajte link ručno.", "error"))}
                >
                  Kopiraj link
                </Button>
                <Button
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm("Napraviti novi link? Prethodni link odmah prestaje da važi.")) run(() => setSignupLinkAction("regenerate"), "Napravljen je novi link.");
                  }}
                >
                  Novi link
                </Button>
                <Button variant="danger" disabled={pending} onClick={() => run(() => setSignupLinkAction("disable"), "Link za prijavu je isključen.")}>
                  Isključi link za prijavu
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600">Link je isključen. Novi korisnici mogu da dobiju pristup samo pozivnicom.</p>
              <Button disabled={pending} onClick={() => run(() => setSignupLinkAction("enable"), "Link za prijavu je uključen.")}>
                Uključi link za prijavu
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

export function UsersPanel({ members, invitations, currentUserId }: { members: Member[]; invitations: PendingInvitation[]; currentUserId: string }) {
  const { pending, run } = useAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Access & { status: "active" | "inactive" }>({ ...DEFAULT_ACCESS, status: "active" });
  const [invite, setInvite] = useState({ email: "", firstName: "", lastName: "", ...DEFAULT_ACCESS });
  const [link, setLink] = useState<{ link: string; mailed: boolean } | null>(null);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Korisnici" description="Uloge i dozvole važe samo u ovoj organizaciji." />
        <TableWrap>
          <thead>
            <tr><Th>Korisnik</Th><Th>Uloga</Th><Th>Dozvole</Th><Th>Status</Th><Th>Poslednja prijava</Th><Th>Član od</Th><Th>Akcije</Th></tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId}>
                <Td>
                  <div className="font-medium">{m.firstName} {m.lastName}{m.userId === currentUserId ? " (vi)" : ""}</div>
                  <div className="text-xs text-slate-500">{m.email}</div>
                </Td>
                <Td>{labels.role[m.role]}</Td>
                <Td className="max-w-xs whitespace-normal">
                  <span className="flex flex-wrap gap-1">
                    {PERMISSIONS.filter((k) => (m.role === "admin" && k !== "canViewSensitive") || m[k]).map((k) => <Badge key={k}>{labels.permission[k]}</Badge>)}
                  </span>
                </Td>
                <Td><Badge tone={m.status === "active" ? "green" : "slate"}>{labels.memberStatus[m.status]}</Badge></Td>
                <Td className="whitespace-nowrap">{formatDateTime(m.lastLoginAt)}</Td>
                <Td className="whitespace-nowrap">{formatDateTime(m.createdAt)}</Td>
                <Td>
                  <Button variant="secondary" className="min-h-8 px-2 py-1 text-xs" onClick={() => { setEditing(m.userId); setDraft({ role: m.role, status: m.status, canView: m.canView, canCreate: m.canCreate, canEdit: m.canEdit, canExport: m.canExport, canViewSensitive: m.canViewSensitive }); }}>
                    Izmeni pristup
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        {editing && (
          <form
            className="space-y-3 border-t border-slate-200 bg-slate-50 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.status === "inactive" && !window.confirm("Deaktivirati korisnika? Izgubiće pristup podacima organizacije.")) return;
              run(() => updateMemberAction(editing, draft), "Pristup je izmenjen.", () => setEditing(null));
            }}
          >
            <p className="text-sm font-medium">Pristup: {members.find((m) => m.userId === editing)?.firstName} {members.find((m) => m.userId === editing)?.lastName}</p>
            <AccessFields idPrefix="edit" value={draft} onChange={(next) => setDraft({ ...draft, ...next })} />
            <Field label="Status naloga" htmlFor="edit-status" className="sm:max-w-48">
              <Select id="edit-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as "active" | "inactive" })}>
                <option value="active">{labels.memberStatus.active}</option>
                <option value="inactive">{labels.memberStatus.inactive}</option>
              </Select>
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={pending}>Sačuvaj</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Otkaži</Button>
            </div>
          </form>
        )}
      </Card>

      <Card>
        <CardHeader title="Pozovi novog korisnika" description="Korisnik dobija link na kojem sam postavlja lozinku." />
        <form
          className="space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => inviteUserAction(invite), undefined, (data) => { setLink(data); setInvite({ email: "", firstName: "", lastName: "", ...DEFAULT_ACCESS }); });
          }}
        >
          {link && <InviteLink {...link} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Ime" htmlFor="invite-first" required><Input id="invite-first" required value={invite.firstName} onChange={(e) => setInvite({ ...invite, firstName: e.target.value })} /></Field>
            <Field label="Prezime" htmlFor="invite-last" required><Input id="invite-last" required value={invite.lastName} onChange={(e) => setInvite({ ...invite, lastName: e.target.value })} /></Field>
            <Field label="Email" htmlFor="invite-email" required><Input id="invite-email" type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} /></Field>
          </div>
          <AccessFields idPrefix="invite" value={invite} onChange={(next) => setInvite({ ...invite, ...next })} />
          <Button type="submit" disabled={pending}>Pošalji pozivnicu</Button>
        </form>
        {invitations.length > 0 && (
          <div className="border-t border-slate-200">
            <TableWrap>
              <thead><tr><Th>Pozivnice na čekanju</Th><Th>Uloga</Th><Th>Važi do</Th><Th>Akcije</Th></tr></thead>
              <tbody>
                {invitations.map((i) => (
                  <tr key={i.id}>
                    <Td>{i.firstName} {i.lastName} <span className="text-slate-500">· {i.email}</span></Td>
                    <Td>{labels.role[i.role]}</Td>
                    <Td>{i.expired ? <Badge tone="red">Istekla</Badge> : formatDateTime(i.expiresAt)}</Td>
                    <Td><Button variant="danger" className="min-h-8 px-2 py-1 text-xs" disabled={pending} onClick={() => run(() => revokeInvitationAction(i.id), "Pozivnica je povučena.")}>Povuci</Button></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}
      </Card>
    </div>
  );
}

export function ServicesPanel({ services }: { services: ServiceRow[] }) {
  const { pending, run } = useAction();
  const empty = { name: "", description: "", category: "" };
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState(empty);
  const open = (id: string | "new", values = empty) => { setEditing(id); setDraft(values); };

  return (
    <Card>
      <CardHeader
        title="Katalog usluga"
        description="Usluge se ne brišu: deaktivirana usluga ostaje na postojećim saradnjama, ali se ne nudi za nove."
        action={<Button onClick={() => open("new")}>Dodaj uslugu</Button>}
      />
      {editing && (
        <form
          className="grid grid-cols-1 gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"
          onSubmit={(e) => { e.preventDefault(); run(() => saveServiceAction(editing === "new" ? null : editing, draft), "Usluga je sačuvana.", () => setEditing(null)); }}
        >
          <Field label="Naziv usluge" htmlFor="service-name" required><Input id="service-name" required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Kategorija" htmlFor="service-category"><Input id="service-category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></Field>
          <Field label="Opis" htmlFor="service-description" className="sm:col-span-2"><Textarea id="service-description" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" disabled={pending}>Sačuvaj</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Otkaži</Button>
          </div>
        </form>
      )}
      {services.length ? (
        <TableWrap>
          <thead><tr><Th>Usluga</Th><Th>Kategorija</Th><Th className="text-right">Saradnji</Th><Th>Status</Th><Th>Akcije</Th></tr></thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id}>
                <Td className="max-w-md whitespace-normal"><div className="font-medium">{s.name}</div>{s.description && <div className="text-xs text-slate-500">{s.description}</div>}</Td>
                <Td>{s.category ?? "—"}</Td>
                <Td className="text-right tabular-nums">{s.collaborations}</Td>
                <Td><Badge tone={s.active ? "green" : "slate"}>{s.active ? "Aktivna" : "Deaktivirana"}</Badge></Td>
                <Td>
                  <span className="flex gap-2">
                    <Button variant="secondary" className="min-h-8 px-2 py-1 text-xs" onClick={() => open(s.id, { name: s.name, description: s.description ?? "", category: s.category ?? "" })}>Izmeni</Button>
                    <Button variant={s.active ? "danger" : "secondary"} className="min-h-8 px-2 py-1 text-xs" disabled={pending} onClick={() => run(() => setServiceActiveAction(s.id, !s.active), s.active ? "Usluga je deaktivirana." : "Usluga je aktivirana.")}>
                      {s.active ? "Deaktiviraj" : "Aktiviraj"}
                    </Button>
                  </span>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <EmptyState title="Katalog je prazan" description="Dodajte usluge koje vaša organizacija pruža; saradnje se vezuju za njih." />
      )}
    </Card>
  );
}

export function LookupPanel({ kind, title, description, items }: { kind: LookupKind; title: string; description: string; items: Option[] }) {
  const { pending, run } = useAction();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <ul className="divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
            {editing?.id === item.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveLookupAction(kind, item.id, { name: editing.name }), "Sačuvano.", () => setEditing(null)); }}>
                <Input aria-label="Naziv" value={editing.name} onChange={(e) => setEditing({ id: item.id, name: e.target.value })} required />
                <Button type="submit" disabled={pending}>Sačuvaj</Button>
                <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Otkaži</Button>
              </form>
            ) : (
              <>
                <span className="text-sm">{item.name} {!item.active && <Badge tone="slate">Deaktivirano</Badge>}</span>
                <span className="flex gap-2">
                  <Button variant="secondary" className="min-h-8 px-2 py-1 text-xs" onClick={() => setEditing({ id: item.id, name: item.name })}>Preimenuj</Button>
                  <Button variant="secondary" className="min-h-8 px-2 py-1 text-xs" disabled={pending} onClick={() => run(() => saveLookupAction(kind, item.id, { active: !item.active }), "Sačuvano.")}>
                    {item.active ? "Deaktiviraj" : "Aktiviraj"}
                  </Button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="flex gap-2 border-t border-slate-200 p-4" onSubmit={(e) => { e.preventDefault(); run(() => saveLookupAction(kind, null, { name }), "Dodato.", () => setName("")); }}>
        <Input aria-label={`Nova stavka: ${title}`} placeholder="Nova stavka" value={name} onChange={(e) => setName(e.target.value)} required />
        <Button type="submit" disabled={pending}>Dodaj</Button>
      </form>
    </Card>
  );
}

