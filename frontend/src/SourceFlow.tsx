import { BeamZepa, type BeamZepaNode } from "./ui/BeamZepa";
import "./SourceFlow.css";

const sources: BeamZepaNode[] = [
  { id: "claude", label: "Claude activity", icon: <span className="source-flow-label">Claude</span> },
  { id: "codex", label: "Codex activity", icon: <span className="source-flow-label">Codex</span> },
  { id: "omp", label: "OMP and Pi activity", icon: <span className="source-flow-label">OMP / Pi</span> },
];
const uses: BeamZepaNode[] = [
  { id: "prompts", label: "Prompt and skill optimization", icon: <span className="source-flow-label">Prompts</span> },
  { id: "evals", label: "Evaluation and benchmarking", icon: <span className="source-flow-label">Evals</span> },
  { id: "models", label: "Small-model training", icon: <span className="source-flow-label">Models</span> },
];

export function SourceFlow() {
  return <section className="source-flow" aria-labelledby="source-flow-title"><div className="source-flow-copy"><p className="home-eyebrow">Built from real experience</p><h2 id="source-flow-title">One history.<br />More possibilities.</h2><p>What your agents learned can help shape what comes next. Turn selected activity into better prompts, useful evaluations, or examples for a specific model.</p><a className="home-text-link" href="/traces">Explore your activity <span aria-hidden="true">↗</span></a></div><div className="source-flow-diagram"><div className="source-flow-legend"><span>Your activity</span><span>Potential uses</span></div><BeamZepa className="home-beam" leftNodes={sources} rightNodes={uses} hub={<span className="source-flow-hub">A</span>} hubLabel="Agent-Me reviewed activity" color="#f47b43" secondaryColor="#aeb2aa" trackColor="#d4d7ce" speed={5.5} curvature={52} nodeSize={65} railHeight={210} width={580} theme="light" variant="bare" /><p className="source-flow-disclaimer">You choose which uses to consider. An agreement comes before any use of submitted activity.</p></div></section>;
}
