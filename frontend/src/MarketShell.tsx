import { useEffect, type ReactNode } from "react";
import "./TraceStudio.css";
import "./market.css";
import "./ClonkTheme.css";
import "./SiteChrome.css";
import { SiteNavigation } from "./SiteNavigation";
import { SiteFooter } from "./SiteFooter";

type Active = "home" | "traces" | "submit" | "submissions" | "buyer" | "mcp";
export function MarketShell({ children, active = "home", title = "Contribute your AI experience", storyNavigation = false }: { children: ReactNode; active?: Active; title?: string; storyNavigation?: boolean }) {
  useEffect(() => {
    const previous = document.title;
    const previousLanguage = document.documentElement.lang;
    document.documentElement.lang = "en";
    document.body.classList.add("trace-studio-page", "market-page");
    document.title = `${title} | Agent-Me`;
    return () => { document.title = previous; document.documentElement.lang = previousLanguage; document.body.classList.remove("trace-studio-page", "market-page"); };
  }, [title]);
  return <div className="app-shell trace-studio market-shell">
    <a className="trace-skip-link" href="#market-main">Skip to content</a>
    <SiteNavigation active={active} story={storyNavigation} />
    <main id="market-main" className="market-main">{children}</main>
    <SiteFooter />
  </div>;
}
