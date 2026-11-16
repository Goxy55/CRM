import { OrganizationPanel, PasswordPanel, TenantSwitcher } from "@/components/settings-panels";
import { Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui";
import { getOrganization } from "@/server/services/tenants";
import { requireSession } from "@/server/session";
import { labels } from "@/i18n";

export const metadata = { title: "Podešavanja" };

export default async function SettingsPage() {
  const { ctx, memberships } = await requireSession();
  const organization = await getOrganization(ctx);
  const granted = [
    ctx.perms.view && labels.permission.canView,
    ctx.perms.create && labels.permission.canCreate,
    ctx.perms.edit && labels.permission.canEdit,
    ctx.perms.export && labels.permission.canExport,
    ctx.perms.sensitive && labels.permission.canViewSensitive,
  ].filter(Boolean);
  return (
    <>
      <PageHeader title="Podešavanja" />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Moj nalog" />
          <div className="p-4 sm:p-5">
            <DefinitionList
              items={[
                ["Ime i prezime", ctx.userName],
                ["Email", ctx.email],
                ["Organizacija", organization.name],
                ["Uloga", labels.role[ctx.role]],
                ["Dozvole", granted.join(", ") || "Nema"],
              ]}
            />
          </div>
        </Card>
        <TenantSwitcher memberships={memberships} current={ctx.tenantId} />
        {ctx.role === "admin" && <OrganizationPanel organization={organization} />}
        <PasswordPanel />
      </div>
    </>
  );
}
