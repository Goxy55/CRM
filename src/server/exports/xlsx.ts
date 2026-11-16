import type { Report } from "../services/reports";

export type ExportMeta = { tenantName: string; filters: string; generatedAt: Date };

/** Tekst koji bi Excel protumačio kao formulu dobija apostrof ispred. */
const safe = (v: string | number | null) =>
  typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : (v ?? "");

export async function reportToXlsx(report: Report, meta: ExportMeta): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  book.creator = "CRM";
  book.created = meta.generatedAt;
  const sheet = book.addWorksheet("Izveštaj");
  sheet.addRow([safe(report.title)]).font = { bold: true, size: 14 };
  sheet.addRow([safe(meta.tenantName)]);
  sheet.addRow([safe(meta.filters)]);
  sheet.addRow([`Generisano: ${meta.generatedAt.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}`]);
  sheet.addRow([]);
  sheet.addRow(report.columns.map((c) => c.label)).font = { bold: true };
  for (const row of report.rows) sheet.addRow(report.columns.map((c) => safe(row[c.key] ?? null)));
  if (report.total) sheet.addRow(report.columns.map((c) => safe(report.total![c.key] ?? null))).font = { bold: true };
  if (report.note) {
    sheet.addRow([]);
    sheet.addRow([safe(report.note)]).font = { italic: true };
  }
  report.columns.forEach((c, i) => {
    const longest = Math.max(c.label.length, ...report.rows.map((r) => String(r[c.key] ?? "").length));
    sheet.getColumn(i + 1).width = Math.min(Math.max(longest + 2, 12), 50);
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}
