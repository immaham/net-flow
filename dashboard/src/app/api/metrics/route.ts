import { NextResponse } from "next/server";

export async function GET() {
  try {
    const response = await fetch("http://localhost:9000/metrics", {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Proxy metrics endpoint returned an error" },
        { status: 502 },
      );
    }

    const metrics = await response.json();

    return NextResponse.json(metrics, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to connect to net-flow proxy" },
      { status: 503 },
    );
  }
}
