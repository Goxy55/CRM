"use client";
import { BarChart3, Briefcase, Building2, Home, LogOut, Menu, Settings, ShieldCheck, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/format";
import { t } from "@/i18n";
import { SignOutButton } from "./auth-forms";

type Props = {
  tenantName: string;
  hasLogo: boolean;
  userName: string;
  roleLabel: string;
  isAdmin: boolean;
  platformAdmin: boolean;
  children: React.ReactNode;
};

export function AppShell({ tenantName, hasLogo, userName, roleLabel, isAdmin, platformAdmin, children }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const items = [
    { href: "/", label: t.nav.home, icon: Home, show: true },
    { href: "/klijenti", label: t.nav.clients, icon: Users, show: true },
    { href: "/saradnje", label: t.nav.collaborations, icon: Briefcase, show: true },
    { href: "/izvestaji", label: t.nav.reports, icon: BarChart3, show: true },
    { href: "/administracija", label: t.nav.admin, icon: ShieldCheck, show: isAdmin },
    { href: "/podesavanja", label: t.nav.settings, icon: Settings, show: true },
    { href: "/platforma", label: t.nav.platform, icon: Building2, show: platformAdmin },
  ].filter((i) => i.show);
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const brand = (
    <div className="flex min-w-0 items-center gap-2.5">
      {hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/api/logo" alt="" className="h-8 w-8 shrink-0 rounded object-contain" />
      ) : (
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-brand-600 text-sm font-semibold text-white">
          {tenantName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="truncate text-sm font-semibold text-slate-900">{tenantName}</span>
    </div>
  );

  return (
    <div className="min-h-dvh lg:flex">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
        {brand}
        <button
          type="button"
          aria-label={t.nav.menu}
          aria-expanded={open}
          aria-controls="glavni-meni"
          onClick={() => setOpen((v) => !v)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>

      <aside
        id="glavni-meni"
        className={cn(
          "z-20 w-full shrink-0 border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:flex-col lg:border-r lg:border-b-0",
          open ? "block" : "hidden lg:flex",
        )}
      >
        <div className="hidden border-b border-slate-200 px-4 py-4 lg:block">{brand}</div>
        <nav aria-label="Glavna navigacija" className="flex-1 space-y-0.5 p-2">
          {items.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={active(href) ? "page" : undefined}
              className={cn(
                "flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium",
                active(href) ? "bg-brand-50 text-brand-800" : "text-slate-700 hover:bg-slate-100",
              )}
            >
              <Icon size={17} aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <p className="truncate text-sm font-medium text-slate-900">{userName}</p>
          <p className="text-xs text-slate-500">{roleLabel}</p>
          <SignOutButton className="mt-2 flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-slate-700 hover:bg-slate-100">
            <LogOut size={16} aria-hidden />
            {t.nav.signOut}
          </SignOutButton>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
