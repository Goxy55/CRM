import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth-forms";
import { Alert, buttonClass } from "@/components/ui";
import { getSessionUser } from "@/server/session";

// Sadržaj zavisi od prijavljenog korisnika; nikada se ne generiše unapred.
export const dynamic = "force-dynamic";

export const metadata = { title: "Nema pristupa" };

export default async function NoAccessPage() {
  const user = await getSessionUser();
  if (!user) redirect("/prijava");
  return (
    <div className="space-y-4">
      <Alert tone="warning" title="Nemate aktivan pristup">
        Nalog {user.email} trenutno nije član nijedne aktivne organizacije. Obratite se administratoru svoje organizacije.
      </Alert>
      <SignOutButton className={buttonClass("secondary", "w-full")}>Odjavi se</SignOutButton>
    </div>
  );
}
