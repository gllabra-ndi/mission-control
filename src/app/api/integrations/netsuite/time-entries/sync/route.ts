import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isNetSuiteSyncAuthorized } from "@/app/api/integrations/netsuite/route-utils";
import { syncTimeEntryToNetSuite, isTimeEntrySyncEnabled } from "@/lib/netsuiteTimeEntrySync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
    if (!isNetSuiteSyncAuthorized(request)) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const model = (prisma as any).taskBillableEntry;
    const [pending, failed, synced] = await Promise.all([
        model.count({ where: { nsSyncStatus: "pending" } }),
        model.count({ where: { nsSyncStatus: "failed" } }),
        model.count({ where: { nsSyncStatus: "synced" } }),
    ]);

    return NextResponse.json({
        ok: true,
        enabled: isTimeEntrySyncEnabled(),
        counts: { pending, failed, synced },
    });
}

export async function POST(request: NextRequest) {
    if (!isNetSuiteSyncAuthorized(request)) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const model = (prisma as any).taskBillableEntry;
    const entries = await model.findMany({
        where: { nsSyncStatus: { in: ["pending", "failed"] } },
        orderBy: { createdAt: "asc" },
        take: 50,
        select: { id: true, nsSyncStatus: true, netsuiteId: true },
    });

    let succeeded = 0;
    let failedCount = 0;
    let skipped = 0;

    for (const entry of entries) {
        const mode = (entry.nsSyncStatus === "synced" && entry.netsuiteId) ? "update" as const : "create" as const;
        const result = await syncTimeEntryToNetSuite(String(entry.id), mode);
        if (result.dryRun) {
            skipped++;
        } else if (result.success) {
            succeeded++;
        } else {
            failedCount++;
        }
    }

    return NextResponse.json({
        ok: true,
        processed: entries.length,
        succeeded,
        failed: failedCount,
        skipped,
    });
}
