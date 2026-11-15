import { CollaborationForm } from "@/components/collaboration-form";
import { Alert, LinkButton, PageHeader } from "@/components/ui";
import { requirePerm } from "@/server/context";
import { load, one, type SearchParams } from "@/server/page";
import { clientOptions } from "@/server/services/clients";
import { getLookups } from "@/server/services/lookups";
import { requireSession } from "@/server/session";

export const metadata = { title: "Nova saradnja" };

export default async function NewCollaborationPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await requireSession();
  await load(Promise.resolve().then(() => requirePerm(ctx, "create")));
  const clients = await load(clientOptions(ctx));
  const lookups = await getLookups(ctx);
  const chosen = one((await searchParams).klijent);
  const noServices = !lookups.services.some((s) => s.active);
  return (
    <>
      <PageHeader title="Nova saradnja" />
      {noServices ? (
        <Alert tone="warning" title="Katalog usluga je prazan">
          <p>Saradnja se vezuje za uslugu iz kataloga. {ctx.role === "admin" ? "Dodajte prvu uslugu u administraciji." : "Zamolite administratora da doda usluge."}</p>
          {ctx.role === "admin" && <div className="mt-3"><LinkButton href="/administracija?tab=usluge">Katalog usluga</LinkButton></div>}
        </Alert>
      ) : !clients.length ? (
        <Alert tone="warning" title="Još nema klijenata">
          <div className="mt-3"><LinkButton href="/klijenti/novi">Novi klijent</LinkButton></div>
        </Alert>
      ) : (
        <CollaborationForm
          lookups={lookups}
          clients={clients}
          initial={{
            clientId: clients.some((c) => c.id === chosen) ? chosen : "",
            serviceId: "", title: "", description: "", startDate: "", plannedEndDate: "", status: "planned",
            contractValue: "", currency: lookups.defaultCurrency, responsibleUserId: ctx.userId, note: "",
          }}
        />
      )}
    </>
  );
}
