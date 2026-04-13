import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";

function extractToken(request: NextRequest): string {
    const auth = (request.headers.get("authorization") || "").trim();
    if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
    return (request.headers.get("x-mc-token") || "").trim();
}

export async function mcpAuth(
    request: NextRequest
): Promise<NextResponse | null> {
    const expected = (process.env.MC_API_TOKEN || "").trim();
    if (!expected) {
        return NextResponse.json(
            { ok: false, error: "MC_API_TOKEN not configured" },
            { status: 503 }
        );
    }

    const token = extractToken(request);
    if (!token || token !== expected) {
        return NextResponse.json(
            { ok: false, error: "Unauthorized" },
            { status: 401 }
        );
    }

    const rl = await checkRateLimit("mc-api-global");
    if (!rl.success) {
        return NextResponse.json(
            { ok: false, error: "Rate limit exceeded", retryAfter: rl.reset },
            {
                status: 429,
                headers: {
                    "Retry-After": String(
                        Math.ceil((rl.reset || 0) / 1000)
                    ),
                },
            }
        );
    }

    return null;
}
