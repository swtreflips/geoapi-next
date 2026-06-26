import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "geoapi-next",
  description: "Nominatim geocoder with a Supabase cache",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
