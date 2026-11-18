import { Plus, Search } from "lucide-react";
import { DataTable, type Column } from "@/components/data-table";
import { Alert, Button, Card, CardHeader, EmptyState, Input, LinkButton, PageHeader } from "@/components/ui";
import { one, type SearchParams } from "@/server/page";
import { getDashboard } from "@/server/services/dashboard";
import { countAccessRequests } from "@/server/services/signup";
import { requireSession } from "@/server/session";

export const metadata = { title: "Početna" };

const RECENT: Column[] = [
  { key: "displayName", label: "Klijent", kind: "link", href: "/klijenti/{id}" },
  { key: "activityName", label: "Delatnost" },
  { key: "status", label: "Status", kind: "clientStatus" },
  { key: "responsibleName", label: "Odgovorna osoba" },
  { key: "updatedAt", label: "Poslednja izmena", kind: "datetime" },
  { key: "open", label: "Akcija", kind: "link", href: "/klijenti/{id}", sortable: false },
];

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await requireSession();
  const denied = one((await searchParams).zabranjeno);
  if (!ctx.perms.view)
    return (
      <>
        <PageHeader title="Početna" />
        <Alert tone="warning" title="Nemate dozvolu za pregled podataka">Obratite se administratoru svoje organizacije.</Alert>
      </>
    );
  const { kpis, recent } = await getDashboard(ctx);
  const requests = await countAccessRequests(ctx);
  const cards = [
    { label: "Ukupno klijenata", value: kpis.totalClients, hint: "bez arhiviranih" },
    { label: "Aktivni klijenti", value: kpis.activeClients, hint: "status „Aktivan“" },
    { label: "Novi klijenti ovog meseca", value: kpis.newThisMonth, hint: "po datumu unosa" },
    { label: "Aktivne saradnje", value: kpis.activeCollaborations, hint: "ugovorene i u toku" },
  ];
  return (
    <>
      <PageHeader title="Početna" description={`Dobro došli, ${ctx.userName}.`} />
      {denied && <div className="mb-4"><Alert tone="warning">Nemate dozvolu za traženu stranicu.</Alert></div>}
      {requests > 0 && (
        <div className="mb-4">
          <Alert tone="info" title={requests === 1 ? "Jedan zahtev za pristup čeka odobrenje" : `Zahteva za pristup koji čekaju odobrenje: ${requests}`}>
            <div className="mt-2"><LinkButton href="/administracija" variant="secondary">Pregledaj zahteve</LinkButton></div>
          </Alert>
        </div>
      )}

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <form action="/klijenti" role="search" className="flex flex-1 gap-2">
          <label htmlFor="q" className="sr-only">Pretraga klijenata</label>
          <div className="relative flex-1">
            <Search size={16} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <Input id="q" name="q" type="search" className="pl-9" placeholder="Ime, naziv, MB, PIB, BPG, telefon, email, delatnost…" />
          </div>
          <Button type="submit" variant="secondary">Pretraži</Button>
        </form>
        {ctx.perms.create && (
          <div className="flex gap-2">
            <LinkButton href="/klijenti/novi"><Plus size={16} aria-hidden />Novi klijent</LinkButton>
            <LinkButton href="/saradnje/nova" variant="secondary"><Plus size={16} aria-hidden />Nova saradnja</LinkButton>
          </div>
        )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label} className="px-4 py-3.5">
            <p className="text-xs font-medium text-slate-500 sm:text-sm">{card.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900 sm:text-3xl">{card.value}</p>
            <p className="mt-0.5 text-xs text-slate-400">{card.hint}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Poslednje izmene" description="Klijenti sa najskorijim promenama podataka ili saradnji." />
        {recent.length ? (
          <DataTable caption="Poslednje izmene" columns={RECENT} rows={recent.map((r) => ({ ...r, open: "Otvori" }))} />
        ) : (
          <EmptyState
            title="Još nema klijenata"
            description="Dodajte prvog klijenta ili uvezite postojeću evidenciju iz Excela."
            action={ctx.perms.create ? <LinkButton href="/klijenti/novi">Novi klijent</LinkButton> : undefined}
          />
        )}
      </Card>
    </>
  );
}
