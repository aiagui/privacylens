import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PrivacyLens — Website privacy evidence",
  description:
    "Explore website privacy evidence with a sample report and controlled local fixtures. Public URL scanning is not available.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
