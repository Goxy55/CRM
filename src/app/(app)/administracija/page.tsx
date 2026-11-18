import Link from "next/link";
import { AccessRequestsPanel, LookupPanel, ServicesPanel, UsersPanel } from "@/components/admin-panels";
import { Card, CardHeader, EmptyState, PageHeader, Pagination, Tabs, TableWrap, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireAdmin } from "@/server/context";
import { load, one, type SearchParams } from "@/server/page";
import { listServices } from "@/server/services/catalog";
import { listAudit } from "@/server/services/dashboard";
import { getLookups } from "@/server/services/lookups";
import { getSignupLink, listAccessRequests } from "@/server/services/signup";
import { listInvitations, listMembers } from "@/server/services/users";
import { requireSession } from "@/server/session";

export const metadata = { title: "Administracija" };
const TABS = ["korisnici", "usluge", "sifarnici", "aktivnosti"] as const;

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await requireSession();
  await load(Promise.resolve().then(() => requireAdmin(ctx)));
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(one(sp.tab)) ? one(sp.tab) : "korisnici";
  const page = Number(one(sp.page)) || 1;
  const requests = await listAccessRequests(ctx);
  return (
    <>
      <PageHeader title="Administracija" description={ctx.tenantName} />
      <Tabs
        active={tab}
        tabs={[
          { key: "korisnici", label: requests.length ? `Korisnici (${requests.length})` : "Korisnici", href: "/administracija" },
          { key: "usluge", label: "Katalog usluga", href: "/administracija?tab=usluge" },
          { key: "sifarnici", label: "Šifarnici", href: "/administracija?tab=sifarnici" },
          { key: "aktivnosti", label: "Evidencija aktivnosti", href: "/administracija?tab=aktivnosti" },
        ]}
      />
      {tab === "korisnici" && (
        <div className="space-y-4">
          <AccessRequestsPanel requests={requests} signupLink={await getSignupLink(ctx)} />
          <UsersPanel members={await listMembers(ctx)} invitations={await listInvitations(ctx)} currentUserId={ctx.userId} />
        </div>
      )}
      {tab === "usluge" && <ServicesPanel services={await listServices(ctx)} />}
      {tab === "sifarnici" && <Lookups ctx={ctx} />}
      {tab === "aktivnosti" && <Audit ctx={ctx} page={page} />}
    </>
  );
}

type Ctx = Awaited<ReturnType<typeof requireSession>>["ctx"];

async function Lookups({ ctx }: { ctx: Ctx }) {
  const lookups = await getLookups(ctx);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <LookupPanel kind="activity" title="Delatnosti" description="Nudi se pri unosu klijenta." items={lookups.activities} />
      <LookupPanel kind="production" title="Vrste poljoprivredne proizvodnje" description="Klijent može imati više vrsta." items={lookups.productions} />
    </div>
  );
}

async function Audit({ ctx, page }: { ctx: Ctx; page: number }) {
  const pageSize = 50;
  const { rows, total } = await listAudit(ctx, { page, pageSize });
  return (
    <Card>
      <CardHeader title="Evidencija aktivnosti" description="Izmene podataka, promene ovlašćenja, izvozi i pristup osetljivim podacima. Zapisi se ne mogu menjati." />
      {rows.length ? (
        <>
          <TableWrap>
            <thead><tr><Th>Datum i vreme</Th><Th>Korisnik</Th><Th>Aktivnost</Th><Th>Klijent</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{formatDateTime(r.createdAt)}</Td>
                  <Td className="whitespace-nowrap">{r.userName ?? "—"}</Td>
                  <Td className="max-w-xl whitespace-normal">{r.summary}</Td>
                  <Td>{r.clientId && r.clientName ? <Link href={`/klijenti/${r.clientId}`} className="text-brand-700 hover:underline">{r.clientName}</Link> : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/administracija?tab=aktivnosti&page=${p}`} />
        </>
      ) : (
        <EmptyState title="Nema zabeleženih aktivnosti" />
      )}
    </Card>
  );
}
