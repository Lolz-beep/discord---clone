import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Discord Clone",
  description: "Minimal Discord-style chat + voice/video/screen share",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full overflow-hidden bg-[#1e1f22] text-gray-100 antialiased">
        {children}
      </body>
    </html>
  );
}
