import { AppShell } from "@/components/app-shell";
import { getOrganization } from "@/server/services/tenants";
import { requireSession } from "@/server/session";
import { labels } from "@/i18n";

// Sadržaj zavisi od prijavljenog korisnika; nikada se ne generiše unapred.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, platformAdmin } = await requireSession();
  const organization = await getOrganization(ctx);
  return (
    <AppShell
      tenantName={organization.name}
      hasLogo={organization.hasLogo}
      userName={ctx.userName}
      roleLabel={labels.role[ctx.role]}
      isAdmin={ctx.role === "admin"}
      platformAdmin={platformAdmin}
    >
      {children}
    </AppShell>
  );
}
