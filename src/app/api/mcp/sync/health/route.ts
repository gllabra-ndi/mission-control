import { NextRequest, NextResponse } from "next/server";
import { mcpAuth } from "@/app/api/mcp/auth";
import { prisma } from "@/lib/prisma";
import { isTimeEntrySyncEnabled } from "@/lib/netsuiteTimeEntrySync";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const [pending, failed, synced] = await Promise.all([
            prisma.taskBillableEntry.count({
                where: { nsSyncStatus: "pending" },
            }),
            prisma.taskBillableEntry.count({
                where: { nsSyncStatus: "failed" },
            }),
            prisma.taskBillableEntry.count({
                where: { nsSyncStatus: "synced" },
            }),
        ]);

        return NextResponse.json({
            ok: true,
            data: {
                enabled: isTimeEntrySyncEnabled(),
                counts: { pending, failed, synced },
            },
        });
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
