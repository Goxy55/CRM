import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Stranica nije pronađena</h1>
      <p className="max-w-sm text-sm text-slate-600">Traženi zapis ne postoji ili mu nemate pristup.</p>
      <Link href="/" className="text-sm font-medium text-brand-700 hover:underline">
        Nazad na početnu
      </Link>
    </main>
  );
}
