import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  // An application flag is not proof of egress isolation. Keep arbitrary scans
  // disabled until the worker is independently confined at infrastructure level.
  return NextResponse.json(
    {
      error: {
        code: "SCAN_ISOLATION_REQUIRED",
        message:
          "Public URL scanning is unavailable until an isolated scanner worker with enforced outbound network policy is deployed. Local controlled-fixture scans remain available to developers.",
      },
    },
    { status: 503 },
  );
}
