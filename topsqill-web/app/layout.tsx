import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Topsqill.ai | The real estate network", template: "%s | Topsqill.ai" },
  description: "Dealers, builders, buyers and owners doing real estate together. Verified listings, buyer requirements, leads and AI tools.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://topsqill.ai"),
  openGraph: { siteName: "Topsqill.ai", type: "website", locale: "en_IN" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F4F9" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0B22" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
