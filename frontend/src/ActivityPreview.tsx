import { useState } from "react";

const records = [
  { id: "request", label: "user request", role: "You", kind: "Message", type: "message", text: "Review the changes before publishing.", detail: "Request", icon: "↗" },
  { id: "command", label: "tool call", role: "Agent", kind: "Tool call", type: "tool", text: "npm test", detail: "Terminal", icon: "⌘" },
  { id: "result", label: "tool result", role: "Tool", kind: "Tool result", type: "tool", text: "Test output is available for review.", detail: "Terminal", icon: "↳" },
  { id: "response", label: "agent response", role: "Agent", kind: "Message", type: "message", text: "Summarize the changes and note any remaining checks.", detail: "Response", icon: "✳" },
];
type Filter = "all" | "tool" | "selected";

export function ActivityPreview() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const visible = records.filter(record => filter === "all" || (filter === "tool" ? record.type === "tool" : selected.has(record.id)));
  function toggle(id: string) {
    setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  return <section id="activity-preview" className="activity-preview" aria-label="Interactive activity review example">
    <header className="activity-preview-bar"><div className="activity-preview-identity"><span className="activity-preview-symbol" aria-hidden="true">A</span><span>Agent-Me</span><span className="activity-preview-slash" aria-hidden="true">/</span><span className="activity-preview-location">Activity review</span></div><span className="activity-example-label"><span aria-hidden="true" />Fictional example</span></header>
    <div className="activity-preview-grid">
      <div className="activity-preview-library"><div className="activity-preview-title"><div><span className="activity-preview-eyebrow">A coding session</span><h2>Review the work behind the answer.</h2></div><span className="activity-preview-source">Codex</span></div>
        <div className="activity-preview-controls" role="group" aria-label="Example activity filters"><button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All activity</button><button type="button" aria-pressed={filter === "tool"} onClick={() => setFilter("tool")}>Tool activity</button>{filter === "selected" && <span className="activity-selected-view">Selected only</span>}<span className="activity-preview-result-count">{visible.length} {visible.length === 1 ? "record" : "records"}</span></div>
        <ul className="activity-preview-records" aria-label="Example activity records">{visible.map(record => <li key={record.id} className={selected.has(record.id) ? "activity-preview-record is-included" : "activity-preview-record"}><label className="activity-preview-record-label"><input type="checkbox" aria-label={`Include ${record.label}`} checked={selected.has(record.id)} onChange={() => toggle(record.id)} /><span className="activity-record-icon" aria-hidden="true">{record.icon}</span><span className="activity-record-body"><span className="activity-preview-record-meta"><strong>{record.role}</strong><span>{record.kind}</span></span><span className={record.id === "command" ? "activity-command" : ""}>{record.text}</span></span><span className="activity-record-detail">{record.detail}</span></label></li>)}</ul>
        {!visible.length && <p className="activity-preview-empty">No selected records. Choose All activity to review the example.</p>}
        <div className="activity-preview-caption"><span className="activity-device-icon" aria-hidden="true"><svg viewBox="0 0 18 18"><rect x="2" y="3" width="14" height="10" rx="1.5" /><path d="M6 16h6M9 13v3" /></svg></span><span>Selection happens on your device. You decide what leaves it.</span></div>
      </div>
      <aside className="activity-preview-selection" aria-label="Example selection"><div className="activity-selection-heading"><span>Your selection</span><span className="activity-private-indicator">Private</span></div><p className="activity-selection-count"><strong aria-label="Example selected record count">{selected.size}</strong><span>{selected.size === 1 ? "record selected" : "records selected"}</span></p><p className="activity-selection-description">Keep the useful parts.<br />Leave everything else out.</p><div className="activity-selection-breakdown"><span>Conversation</span><span>{selected.size ? 1 : 0}</span><span>Source</span><span>Codex</span><span>Attachments</span><span>Excluded</span></div><button type="button" className="activity-preview-selection-button" disabled={!selected.size} onClick={() => setFilter("selected")}>Preview selected activity <span aria-hidden="true">→</span></button><p className="activity-example-disclaimer">Try selecting a record. This example stays on this page.</p></aside>
    </div>
    <footer className="activity-preview-footer"><span>See it with your own work.</span><a href="/traces">Start with your own files <span aria-hidden="true">↗</span></a></footer>
  </section>;
}
