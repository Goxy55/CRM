import { ClientForm } from "@/components/client-form";
import { PageHeader } from "@/components/ui";
import { load } from "@/server/page";
import { requirePerm } from "@/server/context";
import { clientOptions, getClient } from "@/server/services/clients";
import { getLookups } from "@/server/services/lookups";
import { requireSession } from "@/server/session";

export const metadata = { title: "Izmena klijenta" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ctx } = await requireSession();
  await load(Promise.resolve().then(() => requirePerm(ctx, "edit")));
  const client = await load(getClient(ctx, id));
  const lookups = await getLookups(ctx);
  const persons = await clientOptions(ctx, "person");
  return (
    <>
      <PageHeader title={`Izmena: ${client.displayName}`} />
      <ClientForm
        id={id}
        lookups={lookups}
        persons={persons}
        canSensitive={ctx.perms.sensitive}
        hasJmbg={client.hasJmbg}
        initial={{
          type: client.type,
          status: client.status,
          firstName: client.firstName ?? "",
          lastName: client.lastName ?? "",
          companyName: client.companyName ?? "",
          jmbg: "",
          removeJmbg: false,
          registrationNumber: client.registrationNumber ?? "",
          taxNumber: client.taxNumber ?? "",
          bpg: client.bpg ?? "",
          phone: client.phone ?? "",
          email: client.email ?? "",
          address: client.address ?? "",
          city: client.city ?? "",
          municipality: client.municipality ?? "",
          activityId: client.activityId ?? "",
          responsibleUserId: client.responsibleUserId ?? "",
          linkedPersonId: client.linkedPersonId ?? "",
          firstContactDate: client.firstContactDate ?? "",
          note: client.note ?? "",
          agricultural: client.type !== "farm" && (!!client.bpg || client.productions.length > 0),
          productionIds: client.productions.map((p) => p.id),
          primaryProductionId: client.productions.find((p) => p.isPrimary)?.id ?? "",
        }}
      />
    </>
  );
}
