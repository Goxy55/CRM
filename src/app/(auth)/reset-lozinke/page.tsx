import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth-forms";
import { Alert } from "@/components/ui";

export const metadata = { title: "Nova lozinka" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  if (!token || error)
    return (
      <div className="space-y-4">
        <Alert tone="error" title="Link nije važeći">Link za promenu lozinke je istekao ili je već iskorišćen.</Alert>
        <Link href="/zaboravljena-lozinka" className="block text-center text-sm text-brand-700 hover:underline">
          Zatraži novi link
        </Link>
      </div>
    );
  return <ResetPasswordForm token={token} />;
}
