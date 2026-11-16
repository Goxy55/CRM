import path from "node:path";
import type { Report } from "../services/reports";
import type { ExportMeta } from "./xlsx";

// Font sa srpskim slovima (č, ć, đ, š, ž); ugrađeni PDF fontovi ih nemaju.
const FONT = path.join(process.cwd(), "public", "fonts", "DejaVuSans.ttf");

export async function reportToPdf(report: Report, meta: ExportMeta): Promise<Buffer> {
  const { default: PDFDocument } = await import("pdfkit");
  const wide = report.columns.length > 4;
  const doc = new PDFDocument({ size: "A4", layout: wide ? "landscape" : "portrait", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.registerFont("body", FONT);
  doc.font("body");

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  doc.fontSize(15).text(report.title, left, doc.y, { width });
  doc.moveDown(0.3).fontSize(9).fillColor("#555");
  doc.text(meta.tenantName, { width });
  doc.text(meta.filters, { width });
  doc.text(`Generisano: ${meta.generatedAt.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}`, { width });
  doc.fillColor("#000").moveDown(0.8);

  // Prva kolona je šira; brojčane su uske i poravnate desno.
  const weights = report.columns.map((c, i) => (c.numeric ? 1 : i === 0 ? 2.4 : 1.6));
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / sum) * width);

  const drawRow = (cells: string[], bold: boolean) => {
    doc.fontSize(bold ? 9 : 8.5);
    const height = Math.max(...cells.map((cell, i) => doc.heightOfString(cell, { width: widths[i] - 8 }))) + 8;
    if (doc.y + height > bottom()) doc.addPage();
    const y = doc.y;
    if (bold) doc.rect(left, y, width, height).fill("#f1f3f5").fillColor("#000");
    let x = left;
    cells.forEach((cell, i) => {
      doc.text(cell, x + 4, y + 4, { width: widths[i] - 8, align: report.columns[i].numeric ? "right" : "left" });
      x += widths[i];
    });
    doc.moveTo(left, y + height).lineTo(left + width, y + height).strokeColor("#d9dde2").lineWidth(0.5).stroke();
    doc.y = y + height;
  };

  drawRow(report.columns.map((c) => c.label), true);
  if (!report.rows.length) {
    doc.moveDown(0.6).fontSize(9).text("Nema podataka za izabrane filtere.", left, doc.y, { width });
  }
  for (const row of report.rows) drawRow(report.columns.map((c) => String(row[c.key] ?? "")), false);
  if (report.total) drawRow(report.columns.map((c) => String(report.total![c.key] ?? "")), true);
  if (report.note) doc.moveDown(0.8).fontSize(8).fillColor("#555").text(report.note, left, doc.y, { width });

  doc.end();
  return done;
}
