import "./globals.css";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";

/**
 * Applies the saved theme before first paint so there is no flash of the wrong
 * one. Light is the default; "system" follows the device setting.
 */
const THEME_INIT = `try{var t=localStorage.getItem("ivr.theme")||"light";if(t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)}catch(e){document.documentElement.setAttribute("data-theme","light")}`;

import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F5F8" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0D14" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "IVR Console",
    template: "%s · IVR Console",
  },
  description: "Outbound IVR + WhatsApp control panel",
  applicationName: "IVR Console",
  icons: {
    icon: "/favicon.ico",
    apple: "/icon-180x180.png",
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "IVR Console",
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
    <html lang="en" data-theme="light" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
