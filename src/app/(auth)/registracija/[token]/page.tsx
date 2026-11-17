import Link from "next/link";
import { SignupForm } from "@/components/auth-forms";
import { Alert } from "@/components/ui";
import { getSignupTenant } from "@/server/services/signup";

// Važenje linka se proverava pri svakom otvaranju.
export const dynamic = "force-dynamic";

export const metadata = { title: "Zahtev za pristup" };

export default async function SignupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tenant = await getSignupTenant(token);
  if (!tenant)
    return (
      <div className="space-y-4">
        <Alert tone="error" title="Link nije važeći">
          Link za prijavu je isključen ili zamenjen novim. Zatražite važeći link od administratora organizacije.
        </Alert>
        <Link href="/prijava" className="block text-center text-sm text-brand-700 hover:underline">
          Na prijavu
        </Link>
      </div>
    );
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Zahtev za pristup</h1>
        <p className="mt-1 text-sm text-slate-600">
          Organizacija <strong>{tenant.tenantName}</strong>. Pristup dobijate kada administrator odobri zahtev.
        </p>
      </div>
      <SignupForm token={token} tenantName={tenant.tenantName} />
    </div>
  );
}
