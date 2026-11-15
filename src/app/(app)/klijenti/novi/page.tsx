import { ClientForm } from "@/components/client-form";
import { PageHeader } from "@/components/ui";
import { emptyClientForm } from "@/lib/schemas";
import { load } from "@/server/page";
import { requirePerm } from "@/server/context";
import { clientOptions } from "@/server/services/clients";
import { getLookups } from "@/server/services/lookups";
import { requireSession } from "@/server/session";

export const metadata = { title: "Novi klijent" };

export default async function NewClientPage() {
  const { ctx } = await requireSession();
  await load(Promise.resolve().then(() => requirePerm(ctx, "create")));
  const [lookups, persons] = [await getLookups(ctx), await load(clientOptions(ctx, "person"))];
  return (
    <>
      <PageHeader title="Novi klijent" />
      <ClientForm
        initial={{ ...emptyClientForm, responsibleUserId: ctx.userId }}
        lookups={lookups}
        persons={persons}
        canSensitive={ctx.perms.sensitive}
        hasJmbg={false}
      />
    </>
  );
}
