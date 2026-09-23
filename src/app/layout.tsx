import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  description:
    "Beginner-friendly 3D terrain, road and work-zone planner for 1:87 RC dioramas. Sculpt in real centimeters, check vehicle fit, export foam cut sheets.",
  title: "Diorama 1:87 — RC Terrain Designer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
