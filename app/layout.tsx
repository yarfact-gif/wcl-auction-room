import type { Metadata } from "next";
import "./style.css";

export const metadata: Metadata = {
  title: "WCL Auction Room — Season 1",
  description: "Private real-time cricket auction room"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
