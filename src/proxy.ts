import { NextResponse, type NextRequest } from "next/server";

/**
 * Defense in depth for the dev-only fixture scanner: the route itself also
 * 404s when NODE_ENV is production, but this blocks it one layer earlier
 * and independently of that in-route check.
 */
export function proxy(request: NextRequest) {
  if (
    process.env.NODE_ENV === "production" &&
    request.nextUrl.pathname.startsWith("/api/dev/")
  ) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Not found." } },
      { status: 404 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/dev/:path*",
};
