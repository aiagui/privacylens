import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const manrope = localFont({
  src: "../../public/fonts/manrope-latin.ttf",
  variable: "--font-manrope",
  display: "swap",
});
export const metadata: Metadata = {
  // Loopback until a public origin is chosen; absolute preview URLs (og:image)
  // therefore only resolve locally. Set a real origin before any deployment.
  metadataBase: new URL("http://127.0.0.1:3000"),
  title: "PrivacyLens — A clearer view of what follows you",
  description:
    "Open-source privacy inspection. Bring tracking technologies, cookies and third-party requests into focus through evidence. Explore the sample report.",
  icons: { icon: "/icon.svg" },
  openGraph: {
    title: "PrivacyLens — A clearer view of what follows you",
    description:
      "Follow the signals. Understand the evidence. Open-source privacy inspection.",
    images: [
      {
        url: "/social-preview.png",
        width: 1200,
        height: 630,
        alt: "PrivacyLens. A clearer view of what follows you.",
      },
    ],
  },
  twitter: { card: "summary_large_image" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={manrope.variable}>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
