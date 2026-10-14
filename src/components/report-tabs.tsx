"use client";

import { useRef, useState } from "react";

type View = "simple" | "technical";
const VIEWS: { id: View; label: string; hint: string }[] = [
  {
    id: "simple",
    label: "Simple view",
    hint: "The main findings in plain English",
  },
  {
    id: "technical",
    label: "Technical view",
    hint: "Full evidence and inventory",
  },
];

/**
 * Switches between two renderings of the same report. Both panels are always in
 * the document (the inactive one is `hidden`), so nothing is fetched or
 * recomputed when switching and no information is ever dropped.
 */
export function ReportTabs({
  simple,
  technical,
}: {
  simple: React.ReactNode;
  technical: React.ReactNode;
}) {
  const [view, setView] = useState<View>("simple");
  const refs = useRef<Record<View, HTMLButtonElement | null>>({
    simple: null,
    technical: null,
  });

  function move(to: View) {
    setView(to);
    refs.current[to]?.focus();
  }
  function onKeyDown(event: React.KeyboardEvent) {
    const other: View = view === "simple" ? "technical" : "simple";
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      move(other);
    } else if (event.key === "Home") {
      event.preventDefault();
      move("simple");
    } else if (event.key === "End") {
      event.preventDefault();
      move("technical");
    }
  }

  return (
    <div className="report-views">
      <div
        className="view-tabs"
        role="tablist"
        aria-label="Report view"
        onKeyDown={onKeyDown}
      >
        {VIEWS.map((item) => (
          <button
            key={item.id}
            ref={(node) => {
              refs.current[item.id] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={view === item.id}
            aria-controls={`panel-${item.id}`}
            tabIndex={view === item.id ? 0 : -1}
            onClick={() => setView(item.id)}
          >
            <span>{item.label}</span>
            <small>{item.hint}</small>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id="panel-simple"
        aria-labelledby="tab-simple"
        hidden={view !== "simple"}
      >
        {simple}
        <p className="view-switch">
          <button type="button" onClick={() => move("technical")}>
            Inspect the full evidence in Technical view{" "}
            <span aria-hidden="true">→</span>
          </button>
        </p>
      </div>
      <div
        role="tabpanel"
        id="panel-technical"
        aria-labelledby="tab-technical"
        hidden={view !== "technical"}
      >
        {technical}
      </div>
    </div>
  );
}
