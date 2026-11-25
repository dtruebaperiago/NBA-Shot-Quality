import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/dm-sans";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./foundations.css";
import "./workspace.css";
import "./model.css";
import { WorkspaceShell } from "../components/workspace-shell";
import { getDataset, getDatasetVersion } from "../lib/dataset";

export const metadata: Metadata = {
  title: { default: "Player Shot Lab · Shot Quality", template: "%s · Shot Quality" },
  description: "A basketball shot analysis workspace for scouting and player development.",
};

const initializeTheme = 'try { if (localStorage.getItem("shot-quality-theme") === "dark") document.documentElement.dataset.theme = "dark"; } catch {}';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: initializeTheme }} /></head>
      <body><WorkspaceShell dataset={getDataset().label} archiveVersion={getDatasetVersion()}>{children}</WorkspaceShell></body>
    </html>
  );
}
