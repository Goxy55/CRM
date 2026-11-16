import { FileSpreadsheet, FileText } from "lucide-react";
import { ReportChart } from "@/components/report-chart";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, LinkButton, PageHeader, Select, TableWrap, Td, Th, buttonClass } from "@/components/ui";
import { CLIENT_STATUSES } from "@/lib/domain";
import { cn } from "@/lib/format";
import { AppError } from "@/server/errors";
import { load, one, type SearchParams } from "@/server/page";
import { getLookups } from "@/server/services/lookups";
import { describeFilters, REPORT_KEYS, REPORT_TITLES, runReport, type Report, type ReportKey } from "@/server/services/reports";
import { requireSession } from "@/server/session";
import { labels } from "@/i18n";
import Link from "next/link";

export const metadata = { title: "Izveštaji" };

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { ctx } = await requireSession();
  const sp = await searchParams;
  const key = (REPORT_KEYS.includes(one(sp.report) as ReportKey) ? one(sp.report) : "total") as ReportKey;
  const filters = { from: one(sp.from), to: one(sp.to), status: one(sp.status), activityId: one(sp.activityId), responsibleUserId: one(sp.responsibleUserId) };
  const lookups = await load(getLookups(ctx));
  let error = "";
  let report: Report | null = null;
  try {
    report = await load(runReport(ctx, key, filters));
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    error = e.message;
  }
  const query = (extra: Record<string, string>) =>
    new URLSearchParams(Object.fromEntries(Object.entries({ report: key, ...filters, ...extra }).filter(([, v]) => v))).toString();
  const chart = report?.chart ? report.rows.map((r) => ({ label: String(r[report.chart!.category]), value: Number(r[report.chart!.value]) })) : [];

  return (
    <>
      <PageHeader title="Izveštaji" description="Pregledi iz evidencije klijenata i saradnji vaše organizacije." />
      <nav aria-label="Vrsta izveštaja" className="mb-4 flex flex-wrap gap-1.5">
        {REPORT_KEYS.map((k) => (
          <Link
            key={k}
            href={`/izvestaji?${new URLSearchParams(Object.fromEntries(Object.entries({ report: k, ...filters }).filter(([, v]) => v)))}`}
            aria-current={k === key ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1.5 text-sm", k === key ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}
          >
            {REPORT_TITLES[k]}
          </Link>
        ))}
      </nav>

      <Card className="mb-4 p-4">
        <form className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input type="hidden" name="report" value={key} />
          <Field label="Period od" htmlFor="from"><Input id="from" name="from" type="date" defaultValue={filters.from} /></Field>
          <Field label="Period do" htmlFor="to"><Input id="to" name="to" type="date" defaultValue={filters.to} /></Field>
          <Field label="Status klijenta" htmlFor="status">
            <Select id="status" name="status" defaultValue={filters.status} disabled={key === "activeClients"}>
              <option value="">Svi osim arhiviranih</option>
              {CLIENT_STATUSES.map((s) => <option key={s} value={s}>{labels.clientStatus[s]}</option>)}
            </Select>
          </Field>
          <Field label="Delatnost" htmlFor="activityId">
            <Select id="activityId" name="activityId" defaultValue={filters.activityId}>
              <option value="">Sve delatnosti</option>
              {lookups.activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Odgovorna osoba" htmlFor="responsibleUserId">
            <Select id="responsibleUserId" name="responsibleUserId" defaultValue={filters.responsibleUserId}>
              <option value="">Svi</option>
              {lookups.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-5">
            <Button type="submit">Primeni</Button>
            <LinkButton href={`/izvestaji?report=${key}`} variant="ghost">Poništi filtere</LinkButton>
          </div>
          <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-5">Period se odnosi na datum prvog kontakta, a ako on nije unet, na datum unosa klijenta.</p>
        </form>
      </Card>

      {error && <Alert tone="error">{error}</Alert>}
      {report && (
        <Card>
          <CardHeader
            title={report.title}
            description={describeFilters(report.filters)}
            action={
              ctx.perms.export ? (
                <div className="flex gap-2">
                  <a href={`/api/reports/export?${query({ format: "xlsx" })}`} className={buttonClass("secondary")}><FileSpreadsheet size={16} aria-hidden />Excel</a>
                  <a href={`/api/reports/export?${query({ format: "pdf" })}`} className={buttonClass("secondary")}><FileText size={16} aria-hidden />PDF</a>
                </div>
              ) : (
                <span className="text-xs text-slate-500">Izvoz zahteva dozvolu administratora.</span>
              )
            }
          />
          {report.rows.length === 0 ? (
            <EmptyState title="Nema podataka za izabrane filtere" description="Promenite period ili filtere." />
          ) : (
            <>
              {chart.length > 0 && chart.length <= 25 && (
                <div className="border-b border-slate-200 px-2 py-4 sm:px-5">
                  <ReportChart data={chart} label={report.columns.find((c) => c.key === report.chart!.value)?.label ?? ""} />
                </div>
              )}
              <TableWrap>
                <thead>
                  <tr>{report.columns.map((c) => <Th key={c.key} className={c.numeric ? "text-right" : undefined}>{c.label}</Th>)}</tr>
                </thead>
                <tbody>
                  {report.rows.map((row, i) => (
                    <tr key={i}>
                      {report.columns.map((c) => <Td key={c.key} className={c.numeric ? "text-right tabular-nums" : undefined}>{row[c.key] ?? "—"}</Td>)}
                    </tr>
                  ))}
                </tbody>
                {report.total && (
                  <tfoot>
                    <tr className="bg-slate-50 font-semibold">
                      {report.columns.map((c) => <Td key={c.key} className={c.numeric ? "text-right tabular-nums" : undefined}>{report.total![c.key] ?? ""}</Td>)}
                    </tr>
                  </tfoot>
                )}
              </TableWrap>
              {report.note && <p className="px-4 py-3 text-xs text-slate-500 sm:px-5">{report.note}</p>}
            </>
          )}
        </Card>
      )}
    </>
  );
}
