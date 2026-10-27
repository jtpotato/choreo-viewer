import type { Metadata, Viewport } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Choreo Viewer",
  description:
    "A browser-based choreography video player with tempo detection, slow playback, and loop controls.",
  applicationName: "Choreo Viewer",
  keywords: ["dance practice", "choreography", "video player", "beat detection"],
  openGraph: {
    title: "Choreo Viewer",
    description: "Choreography video player with tempo and loop controls.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
