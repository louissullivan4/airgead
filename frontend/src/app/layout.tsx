import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { BRAND, BRAND_PRIMARY } from "@/lib/brand";
import "@/styles/theme.scss";

export const metadata: Metadata = {
  title: BRAND,
  description: "Expense tracking and ledger management",
  manifest: "/manifest.json",
  applicationName: BRAND,
  appleWebApp: { capable: true, statusBarStyle: "default", title: BRAND },
};

export const viewport: Viewport = {
  themeColor: BRAND_PRIMARY,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
