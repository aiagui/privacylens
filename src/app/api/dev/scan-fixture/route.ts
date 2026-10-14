import { NextResponse } from "next/server";
import {
  listDevFixtures,
  runDevFixtureScan,
  UnknownFixtureError,
} from "@/scanner/dev-fixtures";

export const runtime = "nodejs";

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

function notFound() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Not found." } },
    { status: 404 },
  );
}

/**
 * Development-only endpoint, guarded here and in proxy.ts. It never
 * accepts a URL: the only input is a fixtureId from the fixed registry in
 * src/scanner/dev-fixtures.ts, so there is no way to direct a scan at an
 * unapproved destination through this route.
 */
export async function GET() {
  if (isProductionRuntime()) return notFound();
  return NextResponse.json({ fixtures: listDevFixtures() });
}

export async function POST(request: Request) {
  if (isProductionRuntime()) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: { code: "INVALID_BODY", message: "Request body must be JSON." },
      },
      { status: 400 },
    );
  }

  const fixtureId =
    body && typeof body === "object" && "fixtureId" in body
      ? (body as { fixtureId: unknown }).fixtureId
      : undefined;

  if (typeof fixtureId !== "string" || fixtureId.length === 0) {
    return NextResponse.json(
      {
        error: { code: "INVALID_FIXTURE", message: "A fixtureId is required." },
      },
      { status: 400 },
    );
  }

  try {
    const report = await runDevFixtureScan(fixtureId);
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof UnknownFixtureError) {
      return NextResponse.json(
        { error: { code: "UNKNOWN_FIXTURE", message: error.message } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: {
          code: "SCAN_FAILED",
          message: "The development fixture scan failed.",
        },
      },
      { status: 500 },
    );
  }
}
