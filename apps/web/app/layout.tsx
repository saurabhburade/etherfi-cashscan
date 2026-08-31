import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const fontMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Ether.fi Cash Scanner",
  description:
    "Scan Ether.fi Cash destination top-ups, settled spend, derived token balances, and verified token prices",
  icons: {
    icon: "/brand/etherfi-app-icon.svg",
    shortcut: "/brand/etherfi-app-icon.svg",
    apple: "/brand/etherfi-app-icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={cn("antialiased font-sans", fontMono.variable, inter.variable)} lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
