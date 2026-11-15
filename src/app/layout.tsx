import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/toast";
import "./globals.css";

export const metadata: Metadata = { title: { default: "CRM", template: "%s · CRM" }, robots: { index: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sr-Latn">
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
