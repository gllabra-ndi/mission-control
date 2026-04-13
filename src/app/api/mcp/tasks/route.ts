import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { mcpAuth } from "@/app/api/mcp/auth";
import { prisma } from "@/lib/prisma";
import { createEditableTask } from "@/app/actions";

export const dynamic = "force-dynamic";

const searchParamsSchema = z.object({
    week: z.string().min(1).optional(),
    assignee: z.string().optional(),
    scopeType: z.string().optional(),
    scopeId: z.string().optional(),
    status: z.enum(["backlog", "open", "closed"]).optional(),
    q: z.string().optional(),
});

const createTaskSchema = z.object({
    week: z.string().min(1),
    plannedWeek: z.string().optional(),
    closedDate: z.string().optional(),
    scopeType: z.string().min(1),
    scopeId: z.string().min(1),
    subject: z.string().min(1),
    description: z.string().optional(),
    assignee: z.string().optional(),
    isAi: z.boolean().optional(),
    estimateHours: z.number().min(0).optional(),
    billableHoursToday: z.number().min(0).optional(),
    status: z.enum(["backlog", "open", "closed"]).optional(),
});

export async function GET(request: NextRequest) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const raw = Object.fromEntries(request.nextUrl.searchParams.entries());
        const params = searchParamsSchema.parse(raw);

        const where: Record<string, unknown> = {};
        if (params.week) where.week = params.week;
        if (params.scopeType) where.scopeType = params.scopeType;
        if (params.scopeId) where.scopeId = params.scopeId;
        if (params.status) where.status = params.status;
        if (params.assignee) {
            where.assignee = { contains: params.assignee, mode: "insensitive" };
        }
        if (params.q) {
            where.OR = [
                { subject: { contains: params.q, mode: "insensitive" } },
                { assignee: { contains: params.q, mode: "insensitive" } },
            ];
        }

        const tasks = await prisma.editableTask.findMany({
            where,
            include: {
                billableEntries: {
                    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
                },
            },
            orderBy: [
                { status: "asc" },
                { position: "asc" },
                { createdAt: "asc" },
            ],
            take: 200,
        });

        return NextResponse.json({ ok: true, data: tasks });
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

export async function POST(request: NextRequest) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const body = await request.json();
        const input = createTaskSchema.parse(body);
        const task = await createEditableTask(input);

        if (!task) {
            return NextResponse.json(
                { ok: false, error: "Failed to create task" },
                { status: 500 }
            );
        }

        return NextResponse.json({ ok: true, data: task }, { status: 201 });
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
