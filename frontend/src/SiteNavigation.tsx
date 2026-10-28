import { useEffect, useId, useRef, useState } from "react";

export type MarketActive = "home" | "traces" | "submit" | "submissions" | "buyer" | "mcp";
export function SiteBrand() {
  return <><span className="trace-brand-mark" aria-hidden="true"><svg viewBox="0 0 28 28"><path d="M6.5 21 12.6 7h2.8l6.1 14M9.5 16h9" /></svg></span><span>Agent-Me</span></>;
}
export function SiteNavigation({ active = "home", story = false, local = false }: { active?: MarketActive; story?: boolean; local?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  const [scrolled, setScrolled] = useState(() => typeof window !== "undefined" && window.scrollY > 72);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 72);
    update(); window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return <header className="site-header" data-story={story}>
    <nav className="trace-nav market-nav site-navigation" aria-label="Agent-Me" data-story={story} data-scrolled={scrolled}>
      <a className="trace-brand" href="/" aria-label="Agent-Me home"><SiteBrand /></a>
      <div className="trace-nav-links"><a href={story ? "#possibilities" : "/traces"} aria-current={active === "traces" ? "page" : undefined}>{story ? "What you can do" : "Review activity"}</a><a href={story ? "#how-it-works" : "/#how-it-works"}>How it works</a><a href="/mcp" aria-current={active === "mcp" ? "page" : undefined}>Use with your agent</a><a href="/privacy">Your data</a></div>
      <div className="site-navigation-actions"><a className="site-receipt-link" href="/submissions" aria-current={active === "submissions" ? "page" : undefined}>My submission</a><a className="market-nav-action" href="/submit" aria-current={active === "submit" ? "page" : undefined}>Submit activity <span aria-hidden="true">↗</span></a></div>
      <button ref={menuButton} type="button" className="site-menu-toggle" aria-expanded={menuOpen} aria-controls={menuId} aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen(value => !value)}><span aria-hidden="true">{menuOpen ? "×" : "☰"}</span></button>
      {menuOpen && <div id={menuId} className="site-mobile-menu" onKeyDown={event => { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus(); } }}><a href={story ? "#possibilities" : "/traces"} onClick={() => setMenuOpen(false)}>{story ? "What you can do" : "Review activity"}</a><a href="/#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a><a href="/submissions" onClick={() => setMenuOpen(false)}>Open private receipt</a><a href="/mcp" onClick={() => setMenuOpen(false)}>Use with your agent</a><a href="/privacy" onClick={() => setMenuOpen(false)}>Data & privacy</a></div>}
      {local && <span className="trace-local-state"><span aria-hidden="true" /><span className="trace-local-label">Local processing</span></span>}
    </nav>
  </header>;
}
