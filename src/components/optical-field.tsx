"use client";
import { useState } from "react";
export function OpticalField() {
  const [paused, setPaused] = useState(false);
  return (
    <div className={`optical-field${paused ? " is-paused" : ""}`}>
      <div className="field-caption">
        <span>THE OPTICAL FIELD</span>
        <button
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? "Resume motion" : "Pause motion"}
        </button>
      </div>
      <svg viewBox="0 0 540 230" fill="none" aria-hidden="true">
        <ellipse
          cx="270"
          cy="116"
          rx="127"
          ry="47"
          stroke="#526fdf"
          opacity=".3"
        />
        <g className="field-orbits">
          <ellipse
            cx="255"
            cy="116"
            rx="54"
            ry="106"
            transform="rotate(-28 255 116)"
            stroke="#aebef7"
            opacity=".65"
          />
          <ellipse
            cx="285"
            cy="116"
            rx="54"
            ry="106"
            transform="rotate(17 285 116)"
            stroke="#829fff"
            opacity=".8"
          />
          <path
            d="M210 29 317 203 309 20 209 161 326 97 245 217 210 29"
            stroke="#526fdf"
            opacity=".22"
          />
          {[
            [210, 29],
            [317, 203],
            [309, 20],
            [209, 161],
            [326, 97],
            [245, 217],
            [237, 67],
            [301, 155],
          ].map(([cx, cy]) => (
            <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3" fill="#c6d0ff" />
          ))}
        </g>
      </svg>
      <div className="field-axis" aria-hidden="true">
        <span>+ &nbsp; + &nbsp; + &nbsp; + &nbsp; + &nbsp; + &nbsp; +</span>
        <span>X / Y / Z</span>
      </div>
    </div>
  );
}
