import { ImportWizard } from "@/components/import-wizard";
import { PageHeader } from "@/components/ui";
import { requirePerm } from "@/server/context";
import { load } from "@/server/page";
import { IMPORT_FIELDS } from "@/server/services/import";
import { requireSession } from "@/server/session";

export const metadata = { title: "Uvoz klijenata" };

export default async function ImportPage() {
  const { ctx } = await requireSession();
  await load(Promise.resolve().then(() => requirePerm(ctx, "create")));
  return (
    <>
      <PageHeader title="Uvoz klijenata" description="Uvezite postojeću evidenciju iz Excela ili CSV datoteke." />
      <ImportWizard fields={IMPORT_FIELDS.map(({ key, label }) => ({ key, label }))} />
    </>
  );
}
