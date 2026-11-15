import Link from "next/link";
import { AcceptInvitationForm } from "@/components/auth-forms";
import { Alert } from "@/components/ui";
import { getInvitation } from "@/server/services/users";

// Sadržaj zavisi od prijavljenog korisnika; nikada se ne generiše unapred.
export const dynamic = "force-dynamic";

export const metadata = { title: "Pozivnica" };

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await getInvitation(token);
  if (!invitation)
    return (
      <div className="space-y-4">
        <Alert tone="error" title="Pozivnica nije važeća">
          Pozivnica je istekla, povučena ili već iskorišćena. Zatražite novu od administratora svoje organizacije.
        </Alert>
        <Link href="/prijava" className="block text-center text-sm text-brand-700 hover:underline">
          Na prijavu
        </Link>
      </div>
    );
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Dobro došli, {invitation.firstName}</h1>
        <p className="mt-1 text-sm text-slate-600">
          Pozvani ste u organizaciju <strong>{invitation.tenantName}</strong>.
        </p>
      </div>
      <AcceptInvitationForm token={token} email={invitation.email} hasAccount={invitation.hasAccount} />
    </div>
  );
}
