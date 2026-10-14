"use client";

import { useState } from "react";
import type { RequestFinding } from "@/scanner/types";
import {
  CLASSIFICATION_EXPLANATION,
  EvidenceLabel,
  classificationOf,
} from "@/components/evidence";

/** Most destinations the interactive timeline draws. */
export const MAX_JOURNEY_REQUESTS = 100;

function timing(request: RequestFinding) {
  return Number.isFinite(request.timeMs) && request.timeMs >= 0
    ? Math.round(request.timeMs)
    : null;
}

export function RequestJourney({
  requests: allRequests,
  sample,
}: {
  requests: RequestFinding[];
  sample: boolean;
}) {
  const [selected, setSelected] = useState(0);
  if (!allRequests.length) return null;
  const total = allRequests.length;
  // Drawing every request of a very large report would build a huge timeline;
  // the full inventory below always lists all of them.
  const requests = allRequests.slice(0, MAX_JOURNEY_REQUESTS);
  const current = requests[selected] ?? requests[0];
  const maxTime = Math.max(
    1,
    ...requests.map((request) => timing(request) ?? 0),
  );
  const height = 70 + requests.length * 44;
  return (
    <section className="journey-panel" aria-labelledby="journey-heading">
      <div className="journey-heading">
        <div>
          <p className="section-kicker">THE REQUEST WINDOW</p>
          <h2 id="journey-heading">The first moments.</h2>
          <p>
            {total} request signals from the initial page load. No consent
            choice was made.
            {total > requests.length &&
              ` The timeline shows the first ${requests.length}; the inventory below lists all of them.`}
          </p>
        </div>
        <span className="sample-tag">
          {sample ? "SAMPLE DATA" : "INITIAL PAGE LOAD"}
        </span>
      </div>
      <div className="journey-layout">
        <div className="journey-figure">
          <div className="field-caption">
            <span>PAGE LOAD</span>
            <span>REQUEST TIMING / MS</span>
          </div>
          <svg viewBox={`0 0 620 ${height}`} fill="none" aria-hidden="true">
            <path d={`M36 25V${height - 24}`} stroke="#45516c" />
            {requests.map((request, index) => {
              const elapsed = timing(request);
              const x = 85 + ((elapsed ?? 0) / maxTime) * 475;
              const y = 48 + index * 44;
              const active = index === selected;
              return (
                <g
                  key={index}
                  className={
                    active ? "journey-signal is-selected" : "journey-signal"
                  }
                >
                  <path
                    d={`M36 ${y}H580`}
                    stroke="#30394e"
                    strokeDasharray="3 7"
                  />
                  <path
                    d={`M36 ${y}H${x}`}
                    stroke={active ? "#9badff" : "#5d709b"}
                    strokeWidth={active ? "2" : "1"}
                  />
                  <circle cx="36" cy={y} r="3" fill="#9badff" />
                  <circle
                    className="signal-halo"
                    cx={x}
                    cy={y}
                    r="13"
                    fill={active ? "#9badff" : "transparent"}
                    opacity=".16"
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r={active ? "5" : "3"}
                    fill={active ? "#dae1ff" : "#8395c3"}
                  />
                  <text
                    x={x}
                    y={y - 18}
                    fill={active ? "#dae1ff" : "#aeb8cd"}
                    textAnchor="middle"
                    fontSize="13"
                    fontFamily="monospace"
                  >
                    {elapsed === null ? "Unknown" : elapsed + " ms"}
                  </text>
                </g>
              );
            })}
          </svg>
          <p className="journey-figure-note">
            {sample
              ? "Illustrative timings from the bundled example."
              : "Request initiation times from this observation."}{" "}
            Select a destination to explore its signal. Timing shows initiation,
            not proof that data reached a server.
          </p>
        </div>
        <div className="journey-controls">
          <p className="section-kicker">EXPLORE THE DESTINATIONS</p>
          <div
            className="destination-list"
            role="group"
            aria-label="Choose a request signal"
          >
            {requests.map((request, index) => (
              <button
                key={index}
                type="button"
                aria-pressed={index === selected}
                onClick={() => setSelected(index)}
              >
                <span className="destination-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  {request.technology ?? request.domain}
                  <small>{request.domain || "Destination unknown"}</small>
                </span>
                <span className="destination-time">
                  {timing(request) === null
                    ? "Unknown"
                    : timing(request) + " ms"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="journey-detail" aria-live="polite" aria-atomic="true">
        <div>
          <span className="section-kicker">SELECTED SIGNAL</span>
          <strong>{current.technology ?? "Unidentified technology"}</strong>
        </div>
        <div>
          <span className="section-kicker">DESTINATION</span>
          <strong>{current.domain || "Unknown"}</strong>
        </div>
        <div>
          <span className="section-kicker">ADDRESS</span>
          <strong>{current.url}</strong>
        </div>
        <div>
          <span className="section-kicker">RESOURCE TYPE</span>
          <strong>{current.resourceType || "Unknown"}</strong>
        </div>
        <div>
          <span className="section-kicker">CONSENT STATE</span>
          <strong>
            {current.beforeConsent ? "No choice made yet" : "Not established"}
          </strong>
        </div>
        {current.outcome && (
          <div>
            <span className="section-kicker">OUTCOME</span>
            <strong>
              {current.outcome === "completed"
                ? "Completed"
                : current.outcome === "failed"
                  ? "Failed"
                  : "Refused by filter"}
            </strong>
          </div>
        )}
        <div>
          <span className="section-kicker">EVIDENCE</span>
          <EvidenceLabel kind={classificationOf(current.classification)} />
        </div>
        <p className="journey-explain">
          {CLASSIFICATION_EXPLANATION[classificationOf(current.classification)]}
        </p>
        <a href="#network-heading">
          View request inventory <span aria-hidden="true">↓</span>
        </a>
      </div>
    </section>
  );
}
