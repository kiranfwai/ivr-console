import "./globals.css";
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: {
    default: "IVR Console",
    template: "%s · IVR Console",
  },
  description: "Outbound IVR + WhatsApp control panel",
  applicationName: "IVR Console",
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "IVR Console",
    description: "Outbound IVR + WhatsApp control panel",
    siteName: "IVR Console",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "IVR Console",
    description: "Outbound IVR + WhatsApp control panel",
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
