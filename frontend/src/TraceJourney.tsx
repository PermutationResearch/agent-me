import { useId, useState } from "react";
import "./TraceJourney.css";

const steps = [
  { title: "Review your traces", description: "Open supported history files on your device. Inspect the redactions, edit sensitive details, and select exactly what to include.", action: "Review your traces", href: "/traces", label: "Private review", heading: "A selection you can stand behind.", detail: "Your source files and excluded records stay on your device." },
  { title: "Submit a selection", description: "Choose the uses you would consider. Confirm what you are sending, then save your private receipt to follow the review.", action: "Prepare a submission", href: "/submit", label: "Explicit submission", heading: "Send only what you choose.", detail: "Your receipt gives you access to your submission, review status, and any offer." },
  { title: "Consider an offer", description: "If there is a fit, Agent-Me proposes a price and specific uses. Accept, decline, or withdraw. You decide what comes next.", action: "Open your receipt", href: "/submissions", label: "Your decision", heading: "A clear offer. A choice that’s yours.", detail: "No automatic sale. A purchase requires a separate agreement and payment." },
];

export function TraceJourney() {
  const [active, setActive] = useState(0);
  const id = useId(); const step = steps[active];
  return <section className="trace-journey" id="how-it-works" aria-labelledby={`${id}-heading`}>
    <div className="home-section-heading"><p className="home-eyebrow">A straightforward exchange</p><h2 id={`${id}-heading`}>Choose. Share.<br /><em>Decide.</em></h2><p>You bring the experience. We review its fit. Every step keeps the decision in your hands.</p></div>
    <div className="trace-journey-steps" role="group" aria-label="Submission steps">{steps.map((item,index) => <button type="button" key={item.title} aria-pressed={active === index} aria-controls={`${id}-panel`} onClick={() => setActive(index)}><span className="trace-journey-number">0{index+1}</span><span><strong>{item.title}</strong><span>{item.description}</span></span><span className="trace-journey-arrow" aria-hidden="true">↗</span></button>)}</div>
    <div className="trace-journey-panel" id={`${id}-panel`} role="region" aria-label={step.title}>
      <div className="trace-journey-panel-copy"><span className="trace-journey-label">{step.label}</span><h3>{step.heading}</h3><p>{step.detail}</p><a className="home-text-link" href={step.href}>{step.action}<span aria-hidden="true">↗</span></a></div>
      <div className="trace-journey-visual" aria-label="Illustrated workflow"><div className="trace-journey-visual-bar"><span className="trace-journey-app-icon">A</span><span>Agent-Me</span><span>Illustrated workflow</span></div>
        {active === 0 ? <div className="trace-journey-selection"><span className="trace-journey-micro">Your selection</span><div><span className="trace-journey-tick">✓</span><span>Requests & corrections</span><span>Included</span></div><div><span className="trace-journey-tick">✓</span><span>Tool calls & results</span><span>Included</span></div><div className="trace-journey-excluded"><span>—</span><span>Personal details</span><span>Leave out</span></div><p>Inspect. Edit. Select.</p></div>
          : active === 1 ? <div className="trace-journey-receipt"><div className="trace-journey-receipt-symbol" aria-hidden="true">↗</div><strong>Selected activity</strong><span>Your permitted uses travel with it.</span><div><span>Review status</span><strong>Available through your receipt</strong></div><p>Save your receipt. Keep it private.</p></div>
          : <div className="trace-journey-offer"><span className="trace-journey-micro">If Agent-Me makes an offer</span><strong>A price. Defined uses.<br />Your decision.</strong><div><span>Amount</span><span>In your private receipt</span></div><div><span>Intended use</span><span>Within your preferences</span></div><p>Agreement and payment follow separately.</p></div>}
      </div>
    </div>
  </section>;
}
