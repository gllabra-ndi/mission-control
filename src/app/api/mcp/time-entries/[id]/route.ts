import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { mcpAuth } from "@/app/api/mcp/auth";
import { prisma } from "@/lib/prisma";
import {
    updateEditableTaskBillableEntry,
    deleteEditableTaskBillableEntry,
} from "@/app/actions";

export const dynamic = "force-dynamic";

const updateEntrySchema = z.object({
    note: z.string().max(500).optional(),
    hours: z.number().min(0.25).max(24).optional(),
    entryDate: z.string().min(1).optional(),
});

export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const { id } = await params;

        const existing = await prisma.taskBillableEntry.findUnique({
            where: { id },
        });
        if (!existing) {
            return NextResponse.json(
                { ok: false, error: "Time entry not found" },
                { status: 404 }
            );
        }

        const body = await request.json();
        const data = updateEntrySchema.parse(body);

        const updated = await updateEditableTaskBillableEntry(id, data);

        if (!updated) {
            return NextResponse.json(
                { ok: false, error: "Failed to update time entry" },
                { status: 500 }
            );
        }

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

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const authResult = await mcpAuth(request);
    if (authResult) return authResult;

    try {
        const { id } = await params;

        const existing = await prisma.taskBillableEntry.findUnique({
            where: { id },
        });
        if (!existing) {
            return NextResponse.json(
                { ok: false, error: "Time entry not found" },
                { status: 404 }
            );
        }

        await deleteEditableTaskBillableEntry(id);

        return NextResponse.json({ ok: true, data: { id } });
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
