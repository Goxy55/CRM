"use client";
import { useState } from "react";
import { commitImportAction, parseImportAction, previewImportAction } from "@/app/actions";
import type { ImportAnalysis, ImportField, ImportMapping, ImportReport, ImportRowResult } from "@/server/services/import";
import { Alert, Badge, Button, Card, CardHeader, Field, Input, LinkButton, Select, TableWrap, Td, Th } from "./ui";

type FieldDef = { key: ImportField; label: string };
type Parsed = { columns: string[]; rows: string[][] };

const STATUS = { ok: ["green", "Spreman"], warning: ["amber", "Moguć duplikat"], error: ["red", "Odbijen"] } as const;

function ResultTable({ rows }: { rows: ImportRowResult[] }) {
  return (
    <TableWrap>
      <thead><tr><Th>Red</Th><Th>Klijent</Th><Th>Ishod</Th><Th>Objašnjenje</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.line}>
            <Td className="tabular-nums">{r.line}</Td>
            <Td>{r.name}</Td>
            <Td><Badge tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Badge></Td>
            <Td className="max-w-xl whitespace-normal">{r.messages.join(" ") || "—"}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );
}

/** Uvoz u četiri koraka: datoteka → mapiranje kolona → pregled → izveštaj. */
export function ImportWizard({ fields }: { fields: FieldDef[] }) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [includeWarnings, setIncludeWarnings] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const step = report ? 4 : analysis ? 3 : parsed ? 2 : 1;

  async function call<T>(action: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, onData: (data: T) => void) {
    setBusy(true);
    setError("");
    const result = await action();
    setBusy(false);
    if (result.ok) onData(result.data);
    else setError(result.error);
  }
  const restart = () => { setParsed(null); setAnalysis(null); setReport(null); setMapping({}); setError(""); setIncludeWarnings(false); };
  const willImport = analysis ? analysis.ok + (includeWarnings ? analysis.warnings : 0) : 0;

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Koraci uvoza">
        {["Datoteka", "Mapiranje kolona", "Pregled", "Izveštaj"].map((label, i) => (
          <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={`rounded-full px-3 py-1 ${step === i + 1 ? "bg-brand-600 text-white" : step > i + 1 ? "bg-brand-100 text-brand-800" : "bg-slate-200 text-slate-600"}`}>
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      {error && <Alert tone="error">{error}</Alert>}

      {step === 1 && (
        <Card>
          <CardHeader title="Izaberite datoteku" description="Excel (.xlsx) ili CSV, do 5 MB i 2000 redova. Prvi red mora sadržati nazive kolona." />
          <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); void call(() => parseImportAction(form), (d) => { setParsed({ columns: d.columns, rows: d.rows }); setMapping(d.mapping); }); }}>
            <Field label="Datoteka" htmlFor="file">
              <Input id="file" name="file" type="file" accept=".xlsx,.csv" required className="py-1.5" />
            </Field>
            <p className="text-xs text-slate-500">Datoteka se obrađuje u memoriji i ne čuva se na serveru. Klijenti se uvoze isključivo u vašu organizaciju. JMBG se ne uvozi.</p>
            <Button type="submit" disabled={busy}>{busy ? "Čitanje…" : "Nastavi"}</Button>
          </form>
        </Card>
      )}

      {step === 2 && parsed && (
        <Card>
          <CardHeader title="Povežite kolone sa poljima" description={`Pronađeno ${parsed.rows.length} redova i ${parsed.columns.length} kolona. Proverite predloženo mapiranje.`} />
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={`map-${f.key}`} hint={mapping[f.key] != null ? `Primer: ${parsed.rows[0]?.[mapping[f.key]!] || "(prazno)"}` : undefined}>
                <Select
                  id={`map-${f.key}`}
                  value={mapping[f.key] ?? ""}
                  onChange={(e) => {
                    const next = { ...mapping };
                    if (e.target.value === "") delete next[f.key];
                    else next[f.key] = Number(e.target.value);
                    setMapping(next);
                  }}
                >
                  <option value="">Ne uvozi</option>
                  {parsed.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          <div className="flex gap-2 border-t border-slate-200 p-4">
            <Button disabled={busy} onClick={() => call(() => previewImportAction(mapping, parsed.rows), setAnalysis)}>{busy ? "Provera…" : "Proveri podatke"}</Button>
            <Button variant="secondary" onClick={restart}>Druga datoteka</Button>
          </div>
        </Card>
      )}

      {step === 3 && parsed && analysis && (
        <Card>
          <CardHeader title="Pregled pre uvoza" description="Ništa još nije upisano." />
          <div className="grid grid-cols-3 gap-3 p-4 text-center">
            {([["Spremno", analysis.ok, "text-emerald-700"], ["Mogući duplikati", analysis.warnings, "text-amber-700"], ["Odbijeno", analysis.errors, "text-red-700"]] as const).map(([label, value, color]) => (
              <div key={label} className="rounded-md border border-slate-200 px-2 py-3">
                <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
                <p className="text-xs text-slate-600">{label}</p>
              </div>
            ))}
          </div>
          <ResultTable rows={analysis.rows} />
          <div className="space-y-3 border-t border-slate-200 p-4">
            {analysis.warnings > 0 && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={includeWarnings} onChange={(e) => setIncludeWarnings(e.target.checked)} />
                Uvezi i redove sa mogućim duplikatom (isti email ili telefon kao postojeći klijent)
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || willImport === 0} onClick={() => { if (window.confirm(`Uvesti ${willImport} klijenata u vašu organizaciju?`)) void call(() => commitImportAction(mapping, parsed.rows, includeWarnings), setReport); }}>
                {busy ? "Uvoz…" : `Uvezi ${willImport} klijenata`}
              </Button>
              <Button variant="secondary" onClick={() => setAnalysis(null)}>Nazad na mapiranje</Button>
            </div>
          </div>
        </Card>
      )}

      {step === 4 && report && (
        <Card>
          <CardHeader title="Uvoz je završen" />
          <div className="space-y-3 p-4">
            <Alert tone={report.imported ? "success" : "warning"} title={`Uvezeno klijenata: ${report.imported}`}>
              {report.rejected.length ? `Odbijeno redova: ${report.rejected.length}. Razlozi su navedeni ispod.` : "Svi redovi su uvezeni."}
            </Alert>
          </div>
          {report.rejected.length > 0 && <ResultTable rows={report.rejected} />}
          <div className="flex gap-2 border-t border-slate-200 p-4">
            <LinkButton href="/klijenti">Na listu klijenata</LinkButton>
            <Button variant="secondary" onClick={restart}>Novi uvoz</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
