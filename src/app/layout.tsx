import "./globals.css";

export const metadata = {
  title: "IVR Console",
  description: "Outbound IVR + WhatsApp control panel",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
