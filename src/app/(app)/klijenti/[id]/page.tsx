import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { JmbgValue, StatusSelect } from "@/components/controls";
import { DataTable, type Column } from "@/components/data-table";
import { Badge, Card, CardHeader, ClientStatusBadge, DefinitionList, EmptyState, LinkButton, PageHeader, Tabs, TableWrap, Td, Th } from "@/components/ui";
import { CLIENT_STATUSES } from "@/lib/domain";
import { formatDate, formatDateTime } from "@/lib/format";
import { load, one, type SearchParams } from "@/server/page";
import { getClient } from "@/server/services/clients";
import { listCollaborations } from "@/server/services/collaborations";
import { listAudit } from "@/server/services/dashboard";
import { requireSession } from "@/server/session";
import { labels } from "@/i18n";

export const metadata = { title: "Klijent" };

const COLLABORATIONS: Column[] = [
  { key: "title", label: "Saradnja", kind: "link", href: "/saradnje/{id}" },
  { key: "serviceName", label: "Usluga" },
  { key: "status", label: "Status", kind: "collaborationStatus" },
  { key: "startDate", label: "Početak", kind: "date" },
  { key: "plannedEndDate", label: "Planirani završetak", kind: "date" },
  { key: "contractValue", label: "Ugovorena vrednost", kind: "money" },
  { key: "responsibleName", label: "Odgovorna osoba" },
];

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { ctx } = await requireSession();
  const client = await load(getClient(ctx, id));
  const tab = ["saradnje", "aktivnosti", "dokumentacija"].includes(one((await searchParams).tab)) ? one((await searchParams).tab) : "osnovni";
  const base = `/klijenti/${id}`;

  return (
    <>
      <PageHeader
        title={client.displayName}
        description={labels.clientType[client.type]}
        actions={
          <>
            {ctx.perms.edit ? (
              <StatusSelect kind="client" id={id} value={client.status} options={CLIENT_STATUSES.map((s) => ({ value: s, label: labels.clientStatus[s] }))} />
            ) : (
              <ClientStatusBadge status={client.status} />
            )}
            {ctx.perms.edit && <LinkButton href={`${base}/izmena`} variant="secondary"><Pencil size={15} aria-hidden />Izmeni</LinkButton>}
          </>
        }
      />
      <Tabs
        active={tab}
        tabs={[
          { key: "osnovni", label: "Osnovni podaci", href: base },
          { key: "saradnje", label: "Saradnje", href: `${base}?tab=saradnje` },
          { key: "aktivnosti", label: "Aktivnosti", href: `${base}?tab=aktivnosti` },
          { key: "dokumentacija", label: "Dokumentacija", href: `${base}?tab=dokumentacija` },
        ]}
      />

      {tab === "osnovni" && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Identitet" />
            <div className="p-4 sm:p-5">
              <DefinitionList
                items={[
                  ["Tip klijenta", labels.clientType[client.type]],
                  ...(client.companyName ? ([["Naziv", client.companyName], ["Matični broj", client.registrationNumber], ["PIB", client.taxNumber]] as [string, React.ReactNode][]) : []),
                  ...(client.firstName ? ([["Ime i prezime", `${client.firstName} ${client.lastName}`]] as [string, React.ReactNode][]) : []),
                  ...(client.firstName ? ([["JMBG", client.hasJmbg ? <JmbgValue key="j" clientId={id} canReveal={ctx.perms.sensitive} /> : "Nije upisan"]] as [string, React.ReactNode][]) : []),
                  ...(client.linkedPersonId ? ([["Povezano fizičko lice", <Link key="l" href={`/klijenti/${client.linkedPersonId}`} className="text-brand-700 hover:underline">{client.linkedPersonName}</Link>]] as [string, React.ReactNode][]) : []),
                ]}
              />
              {client.linkedClients.length > 0 && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Povezana gazdinstva i radnje</p>
                  <ul className="mt-1 space-y-0.5 text-sm">
                    {client.linkedClients.map((c) => (
                      <li key={c.id}>
                        <Link href={`/klijenti/${c.id}`} className="text-brand-700 hover:underline">{c.displayName}</Link>{" "}
                        <span className="text-slate-500">({labels.clientType[c.type]})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Kontakt i poslovni odnos" />
            <div className="p-4 sm:p-5">
              <DefinitionList
                items={[
                  ["Telefon", client.phone],
                  ["Email", client.email],
                  ["Adresa", client.address],
                  ["Mesto", client.city],
                  ["Opština", client.municipality],
                  ["Delatnost", client.activityName],
                  ["Odgovorna osoba", client.responsibleName ?? "Nije dodeljeno"],
                  ["Datum prvog kontakta", formatDate(client.firstContactDate)],
                  ["Kreiran", formatDateTime(client.createdAt)],
                  ["Poslednja izmena", formatDateTime(client.updatedAt)],
                ]}
              />
              {client.note && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Napomena</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-slate-800">{client.note}</p>
                </div>
              )}
            </div>
          </Card>
          {(client.bpg || client.productions.length > 0) && (
            <Card>
              <CardHeader title="Poljoprivreda" />
              <div className="p-4 sm:p-5">
                <DefinitionList
                  items={[
                    ["Broj poljoprivrednog gazdinstva", client.bpg],
                    [
                      "Vrste proizvodnje",
                      <span key="p" className="flex flex-wrap gap-1.5">
                        {client.productions.map((p) => (
                          <Badge key={p.id} tone={p.isPrimary ? "green" : "neutral"}>{p.name}{p.isPrimary ? " · primarna" : ""}</Badge>
                        ))}
                      </span>,
                    ],
                  ]}
                />
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "saradnje" && <CollaborationsTab clientId={id} canCreate={ctx.perms.create} ctx={ctx} />}
      {tab === "aktivnosti" && <ActivityTab clientId={id} ctx={ctx} />}
      {tab === "dokumentacija" && (
        <Card>
          <EmptyState
            title="Dokumentacija je planirana za narednu fazu"
            description="Čuvanje i pregled dokumenata klijenta nisu deo ove verzije aplikacije."
          />
        </Card>
      )}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireSession>>["ctx"];

async function CollaborationsTab({ clientId, canCreate, ctx }: { clientId: string; canCreate: boolean; ctx: Ctx }) {
  const rows = await listCollaborations(ctx, { clientId });
  return (
    <Card>
      <CardHeader
        title="Saradnje"
        description={`${rows.length} ukupno`}
        action={canCreate && <LinkButton href={`/saradnje/nova?klijent=${clientId}`}><Plus size={16} aria-hidden />Nova saradnja</LinkButton>}
      />
      {rows.length ? (
        <DataTable caption="Saradnje klijenta" columns={COLLABORATIONS} rows={rows} />
      ) : (
        <EmptyState title="Klijent još nema saradnji" description="Saradnja povezuje klijenta sa uslugom iz kataloga i prati njen status." />
      )}
    </Card>
  );
}

async function ActivityTab({ clientId, ctx }: { clientId: string; ctx: Ctx }) {
  const { rows, total } = await listAudit(ctx, { clientId, pageSize: 100 });
  return (
    <Card>
      <CardHeader title="Istorija aktivnosti" description={total > rows.length ? `Prikazano poslednjih ${rows.length} od ${total}` : `${total} zapisa`} />
      {rows.length ? (
        <TableWrap>
          <thead>
            <tr><Th>Datum i vreme</Th><Th>Korisnik</Th><Th>Aktivnost</Th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{formatDateTime(r.createdAt)}</Td>
                <Td className="whitespace-nowrap">{r.userName ?? "—"}</Td>
                <Td className="max-w-xl whitespace-normal">{r.summary}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <EmptyState title="Nema zabeleženih aktivnosti" />
      )}
    </Card>
  );
}
