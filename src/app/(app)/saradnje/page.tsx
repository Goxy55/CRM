import { Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/data-table";
import { Button, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";
import { COLLABORATION_STATUSES } from "@/lib/domain";
import { load, one, type SearchParams } from "@/server/page";
import { listCollaborations } from "@/server/services/collaborations";
import { getLookups } from "@/server/services/lookups";
import { requireSession } from "@/server/session";
import { labels } from "@/i18n";

export const metadata = { title: "Saradnje" };

const COLUMNS: Column[] = [
  { key: "title", label: "Saradnja", kind: "link", href: "/saradnje/{id}" },
  { key: "clientName", label: "Klijent", kind: "link", href: "/klijenti/{clientId}" },
  { key: "serviceName", label: "Usluga" },
  { key: "status", label: "Status", kind: "collaborationStatus" },
  { key: "startDate", label: "Početak", kind: "date" },
  { key: "plannedEndDate", label: "Planirani završetak", kind: "date" },
  { key: "contractValue", label: "Ugovorena vrednost", kind: "money" },
  { key: "responsibleName", label: "Odgovorna osoba" },
];

export default async function CollaborationsPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await requireSession();
  const sp = await searchParams;
  const f = { q: one(sp.q).trim(), status: one(sp.status), serviceId: one(sp.serviceId), responsibleUserId: one(sp.responsibleUserId) };
  const rows = await load(listCollaborations(ctx, f));
  const lookups = await getLookups(ctx);
  const filtered = Object.values(f).some(Boolean);
  return (
    <>
      <PageHeader
        title="Saradnje"
        description={`${rows.length} ${filtered ? "pronađeno" : "ukupno"}`}
        actions={ctx.perms.create && <LinkButton href="/saradnje/nova"><Plus size={16} aria-hidden />Nova saradnja</LinkButton>}
      />
      <Card className="mb-4 p-4">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <Field label="Pretraga" htmlFor="q">
            <Input id="q" name="q" type="search" defaultValue={f.q} placeholder="Naziv saradnje ili klijent" />
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={f.status}>
              <option value="">Svi statusi</option>
              {COLLABORATION_STATUSES.map((s) => <option key={s} value={s}>{labels.collaborationStatus[s]}</option>)}
            </Select>
          </Field>
          <Field label="Usluga" htmlFor="serviceId">
            <Select id="serviceId" name="serviceId" defaultValue={f.serviceId}>
              <option value="">Sve usluge</option>
              {lookups.services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Odgovorna osoba" htmlFor="responsibleUserId">
            <Select id="responsibleUserId" name="responsibleUserId" defaultValue={f.responsibleUserId}>
              <option value="">Svi</option>
              {lookups.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit">Filtriraj</Button>
            {filtered && <LinkButton href="/saradnje" variant="ghost">Poništi filtere</LinkButton>}
          </div>
        </form>
      </Card>
      <Card>
        {rows.length ? (
          <DataTable caption="Saradnje" columns={COLUMNS} rows={rows} />
        ) : (
          <EmptyState
            title={filtered ? "Nema saradnji koje odgovaraju filterima" : "Još nema saradnji"}
            description={filtered ? undefined : "Saradnja povezuje klijenta sa uslugom iz kataloga organizacije."}
          />
        )}
      </Card>
    </>
  );
}
