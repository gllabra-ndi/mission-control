import { NextRequest, NextResponse } from "next/server";
import { mcpAuth } from "@/app/api/mcp/auth";
import { prisma } from "@/lib/prisma";
import { syncTimeEntryToNetSuite } from "@/lib/netsuiteTimeEntrySync";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const entries = await prisma.taskBillableEntry.findMany({
            where: {
                nsSyncStatus: { in: ["failed", "pending"] },
            },
            orderBy: { createdAt: "asc" },
            take: 50,
        });

        if (entries.length === 0) {
            return NextResponse.json({
                ok: true,
                data: { processed: 0, succeeded: 0, failed: 0 },
            });
        }

        const results = await Promise.allSettled(
            entries.map((entry) => {
                const mode =
                    entry.nsSyncStatus === "synced" && entry.netsuiteId
                        ? ("update" as const)
                        : ("create" as const);
                return syncTimeEntryToNetSuite(entry.id, mode);
            })
        );

        let succeeded = 0;
        let failedCount = 0;
        for (const result of results) {
            if (
                result.status === "fulfilled" &&
                result.value &&
                result.value.success
            ) {
                succeeded += 1;
            } else {
                failedCount += 1;
            }
        }

        return NextResponse.json({
            ok: true,
            data: {
                processed: entries.length,
                succeeded,
                failed: failedCount,
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
