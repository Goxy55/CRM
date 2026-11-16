export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-2xl font-semibold tracking-tight text-brand-700">CRM</p>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs">{children}</div>
      </div>
    </main>
  );
}
