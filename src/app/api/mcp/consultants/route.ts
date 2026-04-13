import { NextRequest, NextResponse } from "next/server";
import { mcpAuth } from "@/app/api/mcp/auth";
import { getConsultants } from "@/app/actions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const consultants = await getConsultants();
        return NextResponse.json({ ok: true, data: consultants });
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
