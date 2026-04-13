import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { mcpAuth } from "@/app/api/mcp/auth";
import { prisma } from "@/lib/prisma";
import { addEditableTaskBillableEntry } from "@/app/actions";

export const dynamic = "force-dynamic";

const addEntrySchema = z.object({
    entryDate: z.string().min(1),
    hours: z.number().min(0.25).max(24),
    note: z.string().max(500).optional(),
});

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const { id: taskId } = await params;

        const task = await prisma.editableTask.findUnique({
            where: { id: taskId },
        });
        if (!task) {
            return NextResponse.json(
                { ok: false, error: "Task not found" },
                { status: 404 }
            );
        }

        const body = await request.json();
        const input = addEntrySchema.parse(body);

        const entry = await addEditableTaskBillableEntry({
            taskId,
            entryDate: input.entryDate,
            hours: input.hours,
            note: input.note,
        });

        if (!entry) {
            return NextResponse.json(
                { ok: false, error: "Failed to create time entry" },
                { status: 500 }
            );
        }

        return NextResponse.json(
            { ok: true, data: entry },
            { status: 201 }
        );
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
