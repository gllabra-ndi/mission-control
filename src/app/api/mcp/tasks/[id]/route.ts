import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { mcpAuth } from "@/app/api/mcp/auth";
import { prisma } from "@/lib/prisma";
import { updateEditableTask } from "@/app/actions";

export const dynamic = "force-dynamic";

const updateTaskSchema = z.object({
    week: z.string().optional(),
    plannedWeek: z.string().optional(),
    closedDate: z.string().optional(),
    subject: z.string().optional(),
    description: z.string().optional(),
    assignee: z.string().optional(),
    isAi: z.boolean().optional(),
    estimateHours: z.number().min(0).optional(),
    billableHoursToday: z.number().min(0).optional(),
    status: z.enum(["backlog", "open", "closed"]).optional(),
    position: z.number().optional(),
});

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const { id } = await params;
        const task = await prisma.editableTask.findUnique({
            where: { id },
            include: {
                billableEntries: {
                    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
                },
            },
        });

        if (!task) {
            return NextResponse.json(
                { ok: false, error: "Task not found" },
                { status: 404 }
            );
        }

        return NextResponse.json({ ok: true, data: task });
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

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const { id } = await params;
        const body = await request.json();
        const data = updateTaskSchema.parse(body);

        const existing = await prisma.editableTask.findUnique({
            where: { id },
        });
        if (!existing) {
            return NextResponse.json(
                { ok: false, error: "Task not found" },
                { status: 404 }
            );
        }

        await updateEditableTask(id, data);

        const updated = await prisma.editableTask.findUnique({
            where: { id },
            include: {
                billableEntries: {
                    orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
                },
            },
        });

        return NextResponse.json({ ok: true, data: updated });
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
