import { Plus, Upload } from "lucide-react";
import { DataTable, type Column } from "@/components/data-table";
import { Alert, Button, Card, EmptyState, Field, Input, LinkButton, PageHeader, Pagination, Select } from "@/components/ui";
import { CLIENT_STATUSES, CLIENT_TYPES } from "@/lib/domain";
import { AppError } from "@/server/errors";
import { load, one, type SearchParams } from "@/server/page";
import { listClients } from "@/server/services/clients";
import { getLookups } from "@/server/services/lookups";
import { requireSession } from "@/server/session";
import { labels } from "@/i18n";

export const metadata = { title: "Klijenti" };

const COLUMNS: Column[] = [
  { key: "displayName", label: "Klijent", kind: "link", href: "/klijenti/{id}" },
  { key: "type", label: "Tip", kind: "clientType" },
  { key: "activityName", label: "Delatnost" },
  { key: "municipality", label: "Opština" },
  { key: "phone", label: "Telefon" },
  { key: "status", label: "Status", kind: "clientStatus" },
  { key: "responsibleName", label: "Odgovorna osoba" },
  { key: "updatedAt", label: "Poslednja izmena", kind: "datetime" },
];
const FILTERS = ["q", "type", "status", "activityId", "productionId", "municipality", "responsibleUserId", "jmbg"] as const;

export default async function ClientsPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await requireSession();
  const sp = await searchParams;
  const f = Object.fromEntries(FILTERS.map((k) => [k, one(sp[k]).trim()])) as Record<(typeof FILTERS)[number], string>;
  const page = Number(one(sp.page)) || 1;
  const lookups = await load(getLookups(ctx));
  let error = "";
  const result = await load(
    listClients(ctx, { ...f, page }).catch((e) => {
      // Neispravan JMBG u pretrazi je greška unosa, ne stranice.
      if (e instanceof AppError && e.code === "VALIDATION") {
        error = e.message;
        return { rows: [], total: 0, page: 1, pageSize: 50 };
      }
      throw e;
    }),
  );
  const filtered = FILTERS.some((k) => f[k]);
  const hrefFor = (p: number) => `/klijenti?${new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([k, v]) => v && k !== "jmbg")), page: String(p) })}`;

  return (
    <>
      <PageHeader
        title="Klijenti"
        description={`${result.total} ${filtered ? "pronađeno" : "ukupno"}`}
        actions={
          ctx.perms.create && (
            <>
              <LinkButton href="/klijenti/uvoz" variant="secondary"><Upload size={16} aria-hidden />Uvoz iz Excela</LinkButton>
              <LinkButton href="/klijenti/novi"><Plus size={16} aria-hidden />Novi klijent</LinkButton>
            </>
          )
        }
      />
      <Card className="mb-4 p-4">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" role="search">
          <Field label="Pretraga" htmlFor="q" className="sm:col-span-2">
            <Input id="q" name="q" type="search" defaultValue={f.q} placeholder="Ime, naziv, MB, PIB, BPG, telefon, email…" />
          </Field>
          <Field label="Tip klijenta" htmlFor="type">
            <Select id="type" name="type" defaultValue={f.type}>
              <option value="">Svi tipovi</option>
              {CLIENT_TYPES.map((v) => <option key={v} value={v}>{labels.clientType[v]}</option>)}
            </Select>
          </Field>
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={f.status}>
              <option value="">Svi osim arhiviranih</option>
              {CLIENT_STATUSES.map((v) => <option key={v} value={v}>{labels.clientStatus[v]}</option>)}
            </Select>
          </Field>
          <Field label="Delatnost" htmlFor="activityId">
            <Select id="activityId" name="activityId" defaultValue={f.activityId}>
              <option value="">Sve delatnosti</option>
              {lookups.activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Vrsta proizvodnje" htmlFor="productionId">
            <Select id="productionId" name="productionId" defaultValue={f.productionId}>
              <option value="">Sve vrste</option>
              {lookups.productions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Opština" htmlFor="municipality">
            <Input id="municipality" name="municipality" defaultValue={f.municipality} />
          </Field>
          <Field label="Odgovorna osoba" htmlFor="responsibleUserId">
            <Select id="responsibleUserId" name="responsibleUserId" defaultValue={f.responsibleUserId}>
              <option value="">Svi</option>
              {lookups.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          {ctx.perms.sensitive && (
            <Field label="JMBG (tačna vrednost)" htmlFor="jmbg" hint="Pretraga se evidentira.">
              <Input id="jmbg" name="jmbg" inputMode="numeric" autoComplete="off" defaultValue="" />
            </Field>
          )}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit">Pretraži</Button>
            {filtered && <LinkButton href="/klijenti" variant="ghost">Poništi filtere</LinkButton>}
          </div>
        </form>
      </Card>
      {error && <div className="mb-4"><Alert tone="error">{error}</Alert></div>}
      <Card>
        {result.rows.length ? (
          <>
            <DataTable caption="Klijenti" columns={COLUMNS} rows={result.rows} />
            <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={hrefFor} />
          </>
        ) : (
          <EmptyState
            title={filtered ? "Nema klijenata koji odgovaraju pretrazi" : "Još nema klijenata"}
            description={filtered ? "Promenite ili poništite filtere." : "Dodajte prvog klijenta ili uvezite postojeću evidenciju iz Excela."}
            action={!filtered && ctx.perms.create ? <LinkButton href="/klijenti/novi">Novi klijent</LinkButton> : undefined}
          />
        )}
      </Card>
    </>
  );
}
