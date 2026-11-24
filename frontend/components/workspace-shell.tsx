"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartScatter, ClipboardList, Crosshair, Database, Moon, Sun, UserSearch } from "lucide-react";
import { MotionConfig } from "motion/react";
import { useSyncExternalStore, type ReactNode } from "react";
import { Button } from "./ui";

const destinations = [
  { href: "/", label: "Player Shot Lab", shortLabel: "Shot Lab", icon: Crosshair },
  { href: "/model", label: "Shot Quality Model", shortLabel: "Shot Quality Model", icon: ChartScatter },
  { href: "/scout", label: "Opponent Scout Brief", shortLabel: "Scout Brief", icon: ClipboardList },
  { href: "/players", label: "Player Finder", shortLabel: "Player Finder", icon: UserSearch },
];

function subscribeTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function readTheme() {
  return document.documentElement.dataset.theme === "dark";
}

export function WorkspaceShell({ dataset, children }: { dataset: string; children: ReactNode }) {
  const pathname = usePathname();
  const dark = useSyncExternalStore(subscribeTheme, readTheme, () => false);

  function toggleTheme() {
    const theme = dark ? "light" : "dark";
    const root = document.documentElement;
    const freeze = document.createElement("style");
    freeze.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.append(freeze);
    root.dataset.theme = theme;
    void root.offsetHeight;
    requestAnimationFrame(() => requestAnimationFrame(() => freeze.remove()));
    try { localStorage.setItem("shot-quality-theme", theme); } catch { /* The current page can still switch themes. */ }
  }

  return <MotionConfig reducedMotion="user"><div className="workspace">
    <a href="#workspace-content" className="skip-link">Skip to content</a>
    <aside className="workspace-sidebar">
      <Link href="/" className="wordmark" aria-label="Shot Quality home">
        <span className="brand-mark" aria-hidden="true"><Crosshair size={23} strokeWidth={2} absoluteStrokeWidth /></span>
        <span>SHOT QUALITY</span>
      </Link>
      <nav aria-label="Analysis workspace" className="workspace-nav">
        {destinations.map(({ href, label, shortLabel, icon: Icon }) => <Link key={href} className="workspace-link" href={href} aria-label={label} aria-current={pathname === href ? "page" : undefined}>
          <Icon size={16} strokeWidth={2} absoluteStrokeWidth aria-hidden="true" /><span>{shortLabel}</span>
        </Link>)}
      </nav>
    </aside>
    <div className="workspace-body">
      <header className="workspace-topbar">
        <div className="workspace-source"><Database size={14} strokeWidth={1.5} absoluteStrokeWidth aria-hidden="true" /><span>{dataset}</span></div>
        <Button variant="icon" onClick={toggleTheme} aria-label={dark ? "Use light theme" : "Use dark theme"}>{dark ? <Sun size={17} /> : <Moon size={17} />}</Button>
      </header>
      <main id="workspace-content" className="workspace-content">{children}</main>
    </div>
  </div></MotionConfig>;
}
