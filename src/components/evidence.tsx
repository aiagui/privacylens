import type { Classification } from "@/scanner/types";

export const CLASSIFICATION_EXPLANATION: Record<Classification, string> = {
  observed:
    "The browser started a request to an endpoint a recognized signature treats as collection. Whether data arrived, and what it contained, is not established.",
  inferred:
    "A resource from a recognized vendor was requested, such as a script. This does not show that any data was sent.",
  unknown:
    "No recognized signature explains this destination, so its purpose is not established. That is not evidence that it is harmless or that it tracks.",
};

export function EvidenceLabel({ kind }: { kind: Classification }) {
  return (
    <span className={`evidence-label evidence-${kind}`}>
      {kind.toUpperCase()}
    </span>
  );
}

export { classificationOf } from "@/report/summary";
