import { useId, useState } from "react";
import { ActivityPreview } from "./ActivityPreview";
import "./TraceProductTour.css";

const views = [
  { title: "See the work behind every answer", detail: "Requests, replies, tools, and corrections. A trace keeps the whole story together.", tab: "Activity" },
  { title: "Keep the useful parts. Leave the rest.", detail: "Inspect sensitive details and select individual records. Nothing starts selected.", tab: "Selection" },
  { title: "Your data goes where you decide.", detail: "Download a portable copy, or explicitly submit a reviewed selection to Agent-Me.", tab: "Export" },
  { title: "A clear offer. Your final say.", detail: "Your private receipt keeps review status and any proposed offer in one place.", tab: "Receipt" },
];

export function TraceProductTour() {
  const [active, setActive] = useState(0);
  const id = useId();
  return <section className="product-tour" id="product-tour" aria-labelledby={`${id}-heading`}>
    <h2 id={`${id}-heading`} className="trace-visually-hidden">Your activity, under your control.</h2>
    <div className="product-tour-layout">
      <div className={`product-tour-window product-tour-view-${active}`} id={`${id}-window`}>
        <div className="product-tour-chrome"><span className="product-tour-traffic" aria-hidden="true"><i /><i /><i /></span><span className="product-tour-app"><span aria-hidden="true">A</span>Agent-Me</span><span className="product-tour-tab">{views[active].tab}</span><span className="product-tour-example">Fictional example</span></div>
        <div className="product-tour-review" hidden={active > 1}>
          {active === 1 && <div className="product-tour-selection-hint"><span aria-hidden="true">↳</span>Try selecting a record. You choose what to include.</div>}
          <ActivityPreview />
        </div>
        {active === 2 && <section className="product-tour-scene" aria-label="Export and sharing example"><div className="product-tour-scene-intro"><span className="product-tour-overline">One selection. Your choice.</span><h3>Keep a copy.<br />Share a selection.</h3><p>Downloading an export does not submit it. Sending selected activity requires a separate confirmation.</p></div><div className="product-tour-export-stack"><div className="product-tour-export-file"><span className="product-tour-file-icon" aria-hidden="true"><svg viewBox="0 0 32 38"><path d="M6 2h13l7 7v27H6V2Zm13 0v9h7M11 18h10m-10 6h10m-10 6h6" /></svg></span><div><strong>Your activity export</strong><span>Portable JSON · source attribution retained</span></div><span aria-hidden="true">↓</span></div><div className="product-tour-export-choice"><div><span className="product-tour-option-icon" aria-hidden="true">↓</span><strong>Keep it for yourself</strong><p>Use your examples in your own workflow.</p></div><div><span className="product-tour-option-icon" aria-hidden="true">↗</span><strong>Submit for consideration</strong><p>Choose permitted uses before you send.</p></div></div></div><a className="product-tour-action" href="/traces">Prepare your own selection<span aria-hidden="true">↗</span></a></section>}
        {active === 3 && <section className="product-tour-scene product-tour-receipt-scene" aria-label="Private receipt example"><div className="product-tour-scene-intro"><span className="product-tour-overline">Your private receipt</span><h3>Review first.<br />Decide for yourself.</h3><p>Check the status, see any offer, and choose whether to continue. No automatic sale.</p></div><div className="product-tour-receipt-card"><div className="product-tour-receipt-top"><span className="product-tour-receipt-symbol" aria-hidden="true">A</span><div><strong>Selected activity</strong><span>Private review with Agent-Me</span></div><span aria-hidden="true">↗</span></div><dl><div><dt>Proposed amount</dt><dd>Shown when there is an offer</dd></div><div><dt>Permitted uses</dt><dd>Within your preferences</dd></div><div><dt>Your options</dt><dd>Accept, decline, or withdraw</dd></div></dl><p>A separate agreement and payment are required before a purchase or rights transfer.</p></div><a className="product-tour-action" href="/submissions">Open your private receipt<span aria-hidden="true">↗</span></a></section>}
      </div>
      <div className="product-tour-nav"><div className="product-tour-nav-options" role="group" aria-label="Explore the product">{views.map((view,index) => <button type="button" key={view.title} className="product-tour-choice" aria-label={view.title} aria-pressed={active === index} aria-controls={`${id}-window`} onClick={() => setActive(index)}><span>{view.title}</span></button>)}</div><p className="product-tour-detail" aria-live="polite">{views[active].detail}</p><a className="product-tour-open" href="/traces">Open Activity review <span aria-hidden="true">↗</span></a></div>
    </div>
    <p className="product-tour-footnote">A hands-on example. Your own files stay on your device until you choose to submit a selection.</p>
  </section>;
}
