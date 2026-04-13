import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { mcpAuth } from "@/app/api/mcp/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const querySchema = z.object({
    entryDate: z.string().optional(),
    assignee: z.string().optional(),
    nsSyncStatus: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
});

export async function GET(request: NextRequest) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
        const params = querySchema.parse(raw);

        const where: Record<string, unknown> = {};
        if (params.entryDate) where.entryDate = params.entryDate;
        if (params.nsSyncStatus) where.nsSyncStatus = params.nsSyncStatus;
        if (params.assignee) {
            where.task = {
                assignee: { contains: params.assignee, mode: "insensitive" },
            };
        }

        const take = params.limit ?? 100;
        const skip = params.offset ?? 0;

        const entries = await prisma.taskBillableEntry.findMany({
            where,
            include: {
                task: {
                    select: {
                        id: true,
                        subject: true,
                        assignee: true,
                        scopeType: true,
                        scopeId: true,
                    },
                },
            },
            orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
            take,
            skip,
        });

        const data = entries.map((entry) => ({
            id: entry.id,
            taskId: entry.taskId,
            entryDate: entry.entryDate,
            hours: entry.hours,
            note: entry.note,
            isValueAdd: entry.isValueAdd,
            nsSyncStatus: entry.nsSyncStatus,
            nsSyncError: entry.nsSyncError,
            netsuiteId: entry.netsuiteId,
            nsSyncedAt: entry.nsSyncedAt,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            taskSubject: entry.task.subject,
            taskAssignee: entry.task.assignee,
            taskScopeType: entry.task.scopeType,
            taskScopeId: entry.task.scopeId,
        }));

        return NextResponse.json({ ok: true, data });
    } catch (error: unknown) {
        const message =
            error instanceof ZodError
                ? error.issues.map((e) => e.message).join(", ")
                : String(
                      error instanceof Error ? error.message : "Unknown error"
                  );
        return NextResponse.json(
            { ok: false, error: message },
            { status: 400 }
        );
    }
}
