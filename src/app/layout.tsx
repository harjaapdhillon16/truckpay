import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "@/components/arc/foundation.css";
import "./globals.css";
import { Appearance } from "@/components/appearance";

const geistSans = Geist({ variable: "--font-geist", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LoadWallet · Pay-on-Delivery",
  description: "One Agent Connect wallet per load. Carriers get paid when the truck is unloaded.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-accent="green" className={`${geistSans.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col"><Appearance />{children}</body>
    </html>
  );
}
