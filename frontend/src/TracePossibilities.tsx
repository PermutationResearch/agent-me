import { useId, useRef, useState } from "react";
import "./TracePossibilities.css";

type Use = "sell" | "optimize" | "evaluate" | "models";
const choices: { id: Use; name: string; summary: string; number: string }[] = [
  { id: "sell", name: "Sell selected traces", summary: "Choose what you would offer.", number: "01" },
  { id: "optimize", name: "Improve prompts & skills", summary: "Learn from your actual work.", number: "02" },
  { id: "evaluate", name: "Build evaluations", summary: "Keep useful cases to test against.", number: "03" },
  { id: "models", name: "Prepare model examples", summary: "Curate work for a specific need.", number: "04" },
];
const content = {
  sell: {
    availability: "Review & submission",
    title: "Your experience. A considered offer.",
    description: "The requests, corrections, and tool results behind your work can be useful to others. Inspect your history, remove sensitive details, and submit only the traces you choose for Agent-Me to review.",
    note: "There is no guaranteed offer. A purchase requires a separate agreement and payment before any rights transfer.",
    link: "Review my traces", href: "/traces",
  },
  optimize: {
    availability: "Local workspace",
    title: "Give your next prompt more experience.",
    description: "Use GEPA Optimize Anything to explore prompt and skill candidates against relevant examples from your imported history. Compare a candidate with your original on held-out tasks, then choose what to keep.",
    note: "Requires an unlocked local workspace, a completed archive index, and the configured local model. Scores are model-judge estimates; candidates are never installed automatically.",
    link: "Open local workspace", href: "/workspace",
  },
  evaluate: {
    availability: "Export workflow",
    title: "Test against the work that matters.",
    description: "Save the requests your agents struggled with, the corrections you made, and the results worth checking. A portable activity export gives you real examples to shape your own evaluation set.",
    note: "You define the checks and expected outcomes. Agent-Me does not generate or run your harness yet.",
    link: "Prepare evaluation examples", href: "/traces",
  },
  models: {
    availability: "Prepare for training",
    title: "Start a smaller model with your kind of work.",
    description: "Select useful conversations and tool activity for a specific task. Export the examples with source attribution so you can curate and transform them for a model that fits your workflow.",
    note: "Model training is a separate workflow. Agent-Me exports selected activity; it does not train, fine-tune, or deploy a model here.",
    link: "Curate model examples", href: "/traces",
  },
};

function SaleIllustration() {
  return <div className="possibilities-sale"><div className="possibilities-mini-window"><div className="possibilities-window-bar"><span className="possibilities-window-dot" />Selected activity<span>Private</span></div><div className="possibilities-mini-record"><span className="possibilities-mini-check">✓</span><div><b>Your request</b><span>Review this change before release.</span></div></div><div className="possibilities-mini-record"><span className="possibilities-mini-check">✓</span><div><b>Your correction</b><span>Keep the existing error handling.</span></div></div><div className="possibilities-mini-record possibilities-mini-excluded"><span className="possibilities-mini-check" /><div><b>Personal details</b><span>Excluded from your selection</span></div></div></div><div className="possibilities-review-slip"><span className="possibilities-slip-mark">A</span><div><b>Ready for consideration</b><span>You choose whether to submit.</span></div><span className="possibilities-slip-arrow">↗</span></div></div>;
}
function PromptIllustration() {
  return <div className="possibilities-prompt"><div className="possibilities-prompt-sheet"><span className="possibilities-mini-label">Your starting prompt</span><p>Review the changes.</p><div className="possibilities-prompt-divider"><span>GEPA</span><span>↓</span></div><span className="possibilities-mini-label">A candidate to evaluate</span><p>Review the changes.<br /><em>Check error handling.<br />Explain any unverified behavior.</em></p></div><div className="possibilities-split-row"><span>Train</span><span>Validate</span><span>Held-out test</span></div><p className="possibilities-illustration-note">Compare first. Apply only what you trust.</p></div>;
}
function EvaluationIllustration() {
  return <div className="possibilities-evaluation"><div className="possibilities-eval-heading"><span className="possibilities-mini-label">A case worth keeping</span><span className="possibilities-file-label">evaluation.json</span></div><div className="possibilities-case-line"><span>Request</span><p>Fix the failing checkout test.</p></div><div className="possibilities-case-line"><span>Evidence</span><p>Tool output + your correction</p></div><div className="possibilities-case-line"><span>Your check</span><p>Does the fix preserve validation?</p></div><div className="possibilities-case-footer"><span className="possibilities-case-node" /><span>Your cases</span><i /><span>Your harness</span><span>↗</span></div></div>;
}
function ModelIllustration() {
  return <div className="possibilities-model"><div className="possibilities-example-stack"><div /><div /><div className="possibilities-example-front"><span className="possibilities-mini-label">A focused example</span><div><span>Task</span><b>Explain a code change</b></div><div><span>Context</span><b>Selected agent activity</b></div><div><span>Review</span><b>Keep source attribution</b></div><div className="possibilities-example-rule" /></div></div><div className="possibilities-model-path"><span>Curated export</span><i /><span>Training workflow</span><b>↗</b></div></div>;
}
const illustrations = { sell: SaleIllustration, optimize: PromptIllustration, evaluate: EvaluationIllustration, models: ModelIllustration };

export function TracePossibilities() {
  const [selected, setSelected] = useState<Use>("sell");
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const id = useId(); const current = content[selected];
  function move(direction: number) {
    const element = rail.current;
    if (element) element.scrollBy({ left: direction * element.clientWidth * .85, behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  return <section className="possibilities-section" id="possibilities" aria-labelledby={`${id}-heading`}>
    <header className="possibilities-heading"><h2 id={`${id}-heading`}>Unlock the value of the work<br /> you already do with AI.</h2><div className="possibilities-rail-controls"><button type="button" aria-label="Previous use cases" disabled={atStart} onClick={() => move(-1)}>←</button><button type="button" aria-label="Next use cases" disabled={atEnd} onClick={() => move(1)}>→</button></div></header>
    <div ref={rail} className="possibilities-feature-rail" role="group" aria-label="Explore what you can do" onScroll={event => { const element=event.currentTarget; setAtStart(element.scrollLeft<5); setAtEnd(element.scrollWidth-element.clientWidth-element.scrollLeft<5); }}>{choices.map(choice => {
      const Illustration = illustrations[choice.id];
      return <button key={choice.id} type="button" className={`possibilities-feature-card possibilities-feature-${choice.id}`} aria-pressed={selected === choice.id} aria-controls={`${id}-panel`} onClick={() => setSelected(choice.id)}><div className="possibilities-feature-scene" aria-hidden="true"><span className="possibilities-example-label">Illustrative example</span><Illustration /></div><div className="possibilities-feature-copy"><h3><span aria-hidden="true">{choice.id === "sell" ? "↗" : choice.id === "optimize" ? "⌘" : choice.id === "evaluate" ? "⌑" : "▧"}</span>{choice.name}</h3><p>{choice.summary}</p><span className="possibilities-card-description">{choice.id === "sell" ? "You choose the records. We review the fit. A priced offer is yours to consider." : choice.id === "optimize" ? "Explore better prompts and skills with GEPA and examples from your history." : choice.id === "evaluate" ? "Keep real tasks and corrections to shape tests for your own harness." : "Curate a portable selection as a starting point for a focused training workflow."}</span><span className="possibilities-feature-action">Explore this path <span aria-hidden="true">↗</span></span></div></button>;
    })}</div>
    <section className="possibilities-detail" id={`${id}-panel`} aria-labelledby={`${id}-panel-title`} aria-live="polite"><div><span className="possibilities-availability">{current.availability}</span><h3 id={`${id}-panel-title`}>{current.title}</h3></div><div><p className="possibilities-description">{current.description}</p><a className="possibilities-cta" href={current.href}>{current.link}<span aria-hidden="true">↗</span></a><p className="possibilities-note">{current.note}</p></div></section>
  </section>;
}
