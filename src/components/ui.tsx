import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { ClientStatus, CollaborationStatus } from "@/lib/domain";
import { cn } from "@/lib/format";
import { labels } from "@/i18n";

/** Osnovne komponente interfejsa (u duhu shadcn/ui: male, bez stanja, Tailwind klase). */
type Variant = "primary" | "secondary" | "ghost" | "danger";
const BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 min-h-10";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-100",
  danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
};
export const buttonClass = (variant: Variant = "primary", className?: string) => cn(BUTTON, VARIANTS[variant], className);

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button {...props} className={buttonClass(variant, className)} />;
}

export function LinkButton({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

const CONTROL =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:bg-slate-100 aria-[invalid=true]:border-red-500 min-h-10";
export const Input = ({ className, ...props }: ComponentProps<"input">) => <input {...props} className={cn(CONTROL, className)} />;
export const Select = ({ className, ...props }: ComponentProps<"select">) => <select {...props} className={cn(CONTROL, className)} />;
export const Textarea = ({ className, ...props }: ComponentProps<"textarea">) => (
  <textarea rows={3} {...props} className={cn(CONTROL, className)} />
);

/** Polje sa oznakom, pomoćnim tekstom i porukom o grešci povezanim sa kontrolom. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required && <span aria-hidden className="text-red-600"> *</span>}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="mt-1 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

export const Card = ({ className, ...props }: ComponentProps<"section">) => (
  <section {...props} className={cn("rounded-lg border border-slate-200 bg-white shadow-xs", className)} />
);

export function CardHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-5">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "slate";
const TONES: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  slate: "bg-slate-100 text-slate-500 ring-slate-200",
  blue: "bg-blue-50 text-blue-800 ring-blue-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
};
export const Badge = ({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) => (
  <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", TONES[tone])}>
    {children}
  </span>
);

const CLIENT_TONE: Record<ClientStatus, Tone> = {
  potential: "neutral", contacted: "blue", negotiation: "amber", active: "green", inactive: "slate", archived: "slate",
};
const COLLABORATION_TONE: Record<CollaborationStatus, Tone> = {
  planned: "neutral", negotiation: "amber", contracted: "blue", in_progress: "green", completed: "slate", cancelled: "red",
};
export const ClientStatusBadge = ({ status }: { status: ClientStatus }) => (
  <Badge tone={CLIENT_TONE[status]}>{labels.clientStatus[status]}</Badge>
);
export const CollaborationStatusBadge = ({ status }: { status: CollaborationStatus }) => (
  <Badge tone={COLLABORATION_TONE[status]}>{labels.collaborationStatus[status]}</Badge>
);

export function Alert({ tone = "info", title, children }: { tone?: "info" | "error" | "warning" | "success"; title?: string; children?: ReactNode }) {
  const styles = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    error: "border-red-200 bg-red-50 text-red-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-md border px-4 py-3 text-sm", styles)}>
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Tabela u okviru koji se na uskom ekranu pomera vodoravno, bez širenja stranice. */
export const TableWrap = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-max border-collapse text-left text-sm">{children}</table>
  </div>
);
export const Th = ({ className, ...props }: ComponentProps<"th">) => (
  <th scope="col" {...props} className={cn("border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-xs font-semibold tracking-wide text-slate-600 uppercase", className)} />
);
export const Td = ({ className, ...props }: ComponentProps<"td">) => (
  <td {...props} className={cn("border-b border-slate-100 px-4 py-2.5 align-top text-slate-800", className)} />
);

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <nav aria-label="Odeljci" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.key === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap",
            tab.key === active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-600 hover:text-slate-900",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-slate-600">
      <span>
        Strana {page} od {pages} · ukupno {total}
      </span>
      <div className="flex gap-2">
        {page > 1 && <LinkButton variant="secondary" href={hrefFor(page - 1)}>Prethodna</LinkButton>}
        {page < pages && <LinkButton variant="secondary" href={hrefFor(page + 1)}>Sledeća</LinkButton>}
      </div>
    </div>
  );
}

export const DefinitionList = ({ items }: { items: [string, ReactNode][] }) => (
  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
    {items.map(([term, value]) => (
      <div key={term}>
        <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{term}</dt>
        <dd className="mt-0.5 text-sm break-words text-slate-900">{value || "—"}</dd>
      </div>
    ))}
  </dl>
);
