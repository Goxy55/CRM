import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth-forms";
import { Alert, buttonClass } from "@/components/ui";
import { pendingOrganizations } from "@/server/services/signup";
import { getSessionUser } from "@/server/session";

// Sadržaj zavisi od prijavljenog korisnika; nikada se ne generiše unapred.
export const dynamic = "force-dynamic";

export const metadata = { title: "Nema pristupa" };

export default async function NoAccessPage() {
  const user = await getSessionUser();
  if (!user) redirect("/prijava");
  const pending = await pendingOrganizations(user.id);
  return (
    <div className="space-y-4">
      {pending.length > 0 ? (
        <Alert tone="info" title="Zahtev čeka odobrenje">
          Vaš zahtev za pristup organizaciji {pending.map((name) => `„${name}“`).join(", ")} još nije odobren. Kada ga administrator odobri, osvežite ovu stranicu ili se ponovo prijavite.
        </Alert>
      ) : (
      <Alert tone="warning" title="Nemate aktivan pristup">
        Nalog {user.email} trenutno nije član nijedne aktivne organizacije. Obratite se administratoru svoje organizacije.
      </Alert>
      )}
      <SignOutButton className={buttonClass("secondary", "w-full")}>Odjavi se</SignOutButton>
    </div>
  );
}
