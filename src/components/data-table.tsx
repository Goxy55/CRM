"use client";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { ClientStatus, CollaborationStatus } from "@/lib/domain";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { labels } from "@/i18n";
import { ClientStatusBadge, CollaborationStatusBadge, Td, Th } from "./ui";

type Row = Record<string, unknown>;

/** Opis kolone koji se može proslediti sa servera (bez funkcija). */
export type Column = {
  key: string;
  label: string;
  kind?: "text" | "number" | "date" | "datetime" | "clientStatus" | "collaborationStatus" | "clientType" | "money" | "link";
  /** Za `link`: šablon adrese, npr. "/klijenti/{id}". Za `money`: ključ valute. */
  href?: string;
  currencyKey?: string;
  sortable?: boolean;
};

function cell(column: Column, row: Row) {
  const value = row[column.key];
  switch (column.kind) {
    case "date":
      return formatDate(value as string | null);
    case "datetime":
      return formatDateTime(value as Date | null);
    case "clientStatus":
      return <ClientStatusBadge status={value as ClientStatus} />;
    case "collaborationStatus":
      return <CollaborationStatusBadge status={value as CollaborationStatus} />;
    case "clientType":
      return labels.clientType[value as keyof typeof labels.clientType];
    case "money":
      return formatMoney(value as string | null, String(row[column.currencyKey ?? "currency"] ?? ""));
    case "link":
      return (
        <Link
          href={(column.href ?? "").replace(/\{(\w+)\}/g, (_, k) => String(row[k] ?? ""))}
          className="font-medium text-brand-700 hover:underline"
        >
          {String(value ?? "Otvori")}
        </Link>
      );
    default:
      return value == null || value === "" ? "—" : String(value);
  }
}

/** Tabela sa sortiranjem po kolonama (TanStack Table). Sortira redove koji su učitani. */
export function DataTable({ columns, rows, caption }: { columns: Column[]; rows: Row[]; caption: string }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const defs = useMemo<ColumnDef<Row>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        accessorFn: (row) => {
          const value = row[column.key];
          if (value instanceof Date) return value.getTime();
          if (column.kind === "number" || column.kind === "money") return value == null ? null : Number(value);
          return typeof value === "string" ? value.toLocaleLowerCase("sr-Latn") : value;
        },
        header: column.label,
        enableSorting: column.sortable !== false,
        sortUndefined: "last",
        cell: (info) => cell(column, info.row.original),
        meta: column,
      })),
    [columns],
  );
  const table = useReactTable({
    data: rows,
    columns: defs,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const numeric = ["number", "money"].includes((header.column.columnDef.meta as Column).kind ?? "");
                return (
                  <Th key={header.id} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"} className={numeric ? "text-right" : undefined}>
                    {header.column.getCanSort() ? (
                      <button type="button" onClick={header.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 uppercase hover:text-slate-900">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sorted === "asc" ? <ArrowUp size={13} /> : sorted === "desc" ? <ArrowDown size={13} /> : <ArrowUpDown size={13} className="opacity-40" />}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </Th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="hover:bg-slate-50">
              {row.getVisibleCells().map((c) => (
                <Td key={c.id} className={["number", "money"].includes((c.column.columnDef.meta as Column).kind ?? "") ? "text-right tabular-nums" : undefined}>
                  {flexRender(c.column.columnDef.cell, c.getContext())}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
