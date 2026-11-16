import Link from "next/link";
import { SignOutButton } from "@/components/auth-forms";
import { PlatformPanel } from "@/components/settings-panels";
import { PageHeader, buttonClass } from "@/components/ui";
import { listTenants } from "@/server/services/tenants";
import { requirePlatformAdmin } from "@/server/session";

// Sadržaj zavisi od prijavljenog korisnika; nikada se ne generiše unapred.
export const dynamic = "force-dynamic";

export const metadata = { title: "Platforma" };

export default async function PlatformPage() {
  const { userId, hasTenant } = await requirePlatformAdmin();
  const tenants = await listTenants(userId);
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Administracija platforme"
        actions={
          <>
            {hasTenant && <Link href="/" className={buttonClass("secondary")}>Nazad u CRM</Link>}
            <SignOutButton className={buttonClass("ghost")}>Odjavi se</SignOutButton>
          </>
        }
      />
      <PlatformPanel tenants={tenants} />
    </main>
  );
}
