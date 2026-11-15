import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth-forms";
import { getSessionUser } from "@/server/session";

// Sadržaj zavisi od prijavljenog korisnika; nikada se ne generiše unapred.
export const dynamic = "force-dynamic";

export const metadata = { title: "Prijava" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; email?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { next, email } = await searchParams;
  // Samo lokalne putanje; spoljne adrese se ne prihvataju kao odredište.
  const safeNext = next && /^\/(?!\/|\\)/.test(next) ? next : "/";
  return <LoginForm next={safeNext} email={email ?? ""} />;
}
