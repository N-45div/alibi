import { useEffect, useState } from "react";
import { useRoute } from "./lib";
import ClaimPage from "./pages/ClaimPage";
import Claims from "./pages/Claims";
import Method from "./pages/Method";
import Overview from "./pages/Overview";
import Summaries from "./pages/Summaries";
import Town from "./pages/Town";

type Theme = "light" | "dark" | null;

function readTheme(): Theme {
  try { return (localStorage.getItem("alibi-theme") as Theme) ?? null; } catch { return null; }
}

export default function App() {
  const route = useRoute();
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme) root.dataset.theme = theme; else delete root.dataset.theme;
    try { if (theme) localStorage.setItem("alibi-theme", theme); } catch { /* storage unavailable */ }
  }, [theme]);

  const dark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const page = route[0] ?? "";
  const nav = [["", "Overview"], ["claims", "Ledger"], ["summaries", "Summaries"], ["town", "Delvetown"], ["method", "Method"]];

  let body;
  if (page === "claim" && route[1]) body = <ClaimPage id={route[1]} />;
  else if (page === "claims") body = <Claims />;
  else if (page === "summaries") body = <Summaries date={route[1]} line={route[2] ? Number(route[2]) : undefined} />;
  else if (page === "town") body = <Town />;
  else if (page === "method") body = <Method />;
  else body = <Overview />;

  return (
    <>
      <div className="topbar">
        <div className="wrap">
          <a className="brand" href="#/">
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M4 2.5h12v15l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M7 9.2l2 2 4-4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Alibi <span className="tag muted" style={{ fontWeight: 400 }}>· said vs did</span>
          </a>
          <nav className="nav" aria-label="Main">
            {nav.map(([k, label]) => (
              <a key={k} href={`#/${k}`} aria-current={(page === k || (k === "claims" && page === "claim")) ? "page" : undefined}>{label}</a>
            ))}
          </nav>
          <button className="iconbtn" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
            {dark ? (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.2" fill="currentColor" />
                <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                  <line key={a} x1="8" y1="1.2" x2="8" y2="2.8" transform={`rotate(${a} 8 8)`} />))}</g></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 9.8A5.8 5.8 0 0 1 6.2 2.5a5.8 5.8 0 1 0 7.3 7.3z" fill="currentColor" /></svg>
            )}
          </button>
        </div>
      </div>
      <main>{body}</main>
      <footer className="footer">
        <div className="wrap row">
          <span>Data: <a href="https://huggingface.co/datasets/aidigestorg/ai-village" target="_blank" rel="noreferrer">AI Village dataset</a> by AI Digest, used under its research terms; Delvetown's public records, read from <a href="https://delve.town" target="_blank" rel="noreferrer">pds.delve.town</a>.</span>
          <span className="spacer" />
          <a href="https://github.com/N-45div/alibi" target="_blank" rel="noreferrer">Source on GitHub</a>
        </div>
      </footer>
    </>
  );
}
