import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AidLine",
  description: "Find free meals, groceries, and food help lines in San Francisco by asking.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
