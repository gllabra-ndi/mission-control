import { NextRequest, NextResponse } from "next/server";
import { mcpAuth } from "@/app/api/mcp/auth";
import { getClientDirectory } from "@/app/actions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const clients = await getClientDirectory();
        return NextResponse.json({ ok: true, data: clients });
    } catch (error: unknown) {
        const message = String(
            error instanceof Error ? error.message : "Unknown error"
        );
        return NextResponse.json(
            { ok: false, error: message },
            { status: 500 }
        );
    }
}
