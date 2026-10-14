"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_REPORT_BYTES, readReportFile } from "@/report/import";
import { isUnsafeCharacter } from "@/report/text";
import type { ValidationIssue } from "@/report/validate";
import type { ScanReport } from "@/scanner/types";
import { ReportView } from "@/components/report-view";

type State =
  | { phase: "idle" }
  | { phase: "reading"; fileName: string }
  | {
      phase: "error";
      fileName: string;
      issues: ValidationIssue[];
      truncated: boolean;
    }
  | { phase: "loaded"; fileName: string; report: ScanReport };

/** A file name is user data: show it as plain, bounded text only. */
function safeName(name: string): string {
  const cleaned = [...name]
    .map((character) =>
      isUnsafeCharacter(character.codePointAt(0) ?? 0) ? " " : character,
    )
    .join("")
    .trim();
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}…` : cleaned || "report";
}

const MAX_MB = MAX_REPORT_BYTES / 1024 / 1024;

/**
 * Opens a PrivacyLens JSON report entirely in this browser tab. The file is read
 * with File.text(), validated, and shown through the normal report components.
 * Nothing is uploaded, stored or cached: there is no network call, cookie,
 * localStorage, sessionStorage or IndexedDB use anywhere on this path, and
 * closing the report or the tab discards it.
 */
export function ReportImport() {
  const [state, setState] = useState<State>({ phase: "idle" });
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  // Only the most recently chosen file may update the page: a slow read of an
  // earlier choice must not overwrite a later one.
  const latest = useRef(0);

  // Dropping a file anywhere else on the page would make the browser navigate
  // to it; keep the page, and the report, where they are.
  useEffect(() => {
    const stop = (event: DragEvent) => event.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  useEffect(() => {
    if (state.phase === "error") errorRef.current?.focus();
    if (state.phase === "loaded")
      viewRef.current?.querySelector<HTMLElement>("h1")?.focus();
    // After closing a report the importer is mounted again; put focus back on
    // its file input so keyboard and screen-reader users are not left on nothing.
    if (state.phase === "idle" && returnFocus.current) {
      returnFocus.current = false;
      inputRef.current?.focus();
    }
  }, [state.phase]);

  const open = useCallback(async (files: FileList | null | undefined) => {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      latest.current += 1;
      setState({
        phase: "error",
        fileName: "",
        issues: [
          { path: "(files)", message: "Choose one report file at a time." },
        ],
        truncated: false,
      });
      return;
    }
    const file = files[0]!;
    const fileName = safeName(file.name);
    const ticket = ++latest.current;
    setState({ phase: "reading", fileName });
    const result = await readReportFile(file);
    if (ticket !== latest.current) return;
    setState(
      result.ok
        ? { phase: "loaded", fileName, report: result.report }
        : {
            phase: "error",
            fileName,
            issues: result.issues,
            truncated: result.truncated,
          },
    );
    // Let the same file be chosen again after it was changed.
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const reset = () => {
    latest.current += 1;
    returnFocus.current = true;
    setState({ phase: "idle" });
  };

  if (state.phase === "loaded") {
    return (
      <div ref={viewRef}>
        <div className="import-bar container">
          <p>
            Showing <strong>{state.fileName}</strong>
          </p>
          <button type="button" className="secondary-button" onClick={reset}>
            Close this report
          </button>
        </div>
        <p className="visually-hidden" role="status">
          Report opened.
        </p>
        <ReportView report={state.report} imported />
      </div>
    );
  }

  return (
    <section
      className="import-panel container"
      aria-labelledby="import-heading"
    >
      <p className="eyebrow">OPEN A REPORT</p>
      <h1 id="import-heading">Explore a report from the PrivacyLens CLI</h1>
      <p className="import-lead">
        Scan a public website on your own computer, then open the JSON report
        here to explore it with the same evidence labels and request timeline as
        the sample.
      </p>
      <ol className="import-steps">
        <li>
          Run the scanner:
          <code>npm run scan -- https://example.org --out report.json</code>
        </li>
        <li>Choose or drop the file below.</li>
      </ol>

      <div
        className={`import-drop${dragging ? " is-dragging" : ""}`}
        onDragEnter={() => setDragging(true)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void open(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          id="report-file"
          className="import-input"
          type="file"
          accept=".json,application/json"
          aria-describedby="import-privacy import-limits"
          onChange={(event) => void open(event.target.files)}
        />
        <label className="primary-link import-button" htmlFor="report-file">
          Choose a report file
        </label>
        <span className="import-or" aria-hidden="true">
          or drop it here
        </span>
      </div>

      <p id="import-privacy" className="import-privacy">
        <strong>Your report stays in this browser tab.</strong> It is read
        locally, never uploaded, and not saved anywhere. Closing the report or
        the tab discards it.
      </p>
      <p id="import-limits" className="import-limits">
        Accepts one <code>.json</code> file up to {MAX_MB} MB from the
        scanner&apos;s report format, version 1.
      </p>

      <div className="visually-hidden" role="status">
        {state.phase === "reading" ? "Reading the file." : ""}
      </div>

      {state.phase === "error" && (
        <div
          ref={errorRef}
          className="import-error"
          role="alert"
          tabIndex={-1}
          aria-labelledby="import-error-heading"
        >
          <h2 id="import-error-heading">This file could not be opened</h2>
          {state.fileName && (
            <p>
              File: <strong>{state.fileName}</strong>
            </p>
          )}
          <ul>
            {state.issues.map((issue, index) => (
              <li key={`${issue.path}-${index}`}>
                <code>{issue.path}</code> {issue.message}
              </li>
            ))}
          </ul>
          {state.truncated && <p>More problems were found than are listed.</p>}
          <p>
            Nothing from the file was kept. Reports must come from{" "}
            <code>npm run scan</code> in a matching PrivacyLens version.
          </p>
        </div>
      )}
    </section>
  );
}
