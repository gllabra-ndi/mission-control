import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
    batchCreateNetSuiteTimeEntries,
    createNetSuiteTimeEntry,
    getNetSuiteTimeEntry,
    searchNetSuiteTimeEntries,
    updateNetSuiteTimeEntry,
    type NetSuiteCreateTimeEntryInput,
    type NetSuiteRestletResult,
    type NetSuiteUpdateTimeEntryInput,
} from "@/lib/netsuite";
import { isNetSuiteSyncAuthorized } from "@/app/api/integrations/netsuite/route-utils";

export const dynamic = "force-dynamic";

const getActionSchema = z.enum(["getTimeEntry", "searchTimeEntries"]);
const postActionSchema = z.enum(["createTimeEntry", "batchCreateTimeEntries", "updateTimeEntry"]);

const createTimeEntrySchema: z.ZodType<NetSuiteCreateTimeEntryInput> = z.object({
    externalId: z.string().trim().min(1),
    employeeEmail: z.string().trim().email().optional(),
    employeeId: z.number().int().positive().optional(),
    customer: z.number().int().positive().optional(),
    hours: z.number().positive(),
    date: z.string().trim().min(1),
    memo: z.string().optional(),
    isBillable: z.boolean().optional(),
    item: z.union([z.number().int().positive(), z.string().trim().min(1)]).optional(),
    caseTaskEvent: z.number().int().positive().nullable().optional(),
    formId: z.number().int().positive().nullable().optional(),
});

const updateTimeEntrySchema: z.ZodType<NetSuiteUpdateTimeEntryInput> = z.object({
    externalId: z.string().trim().min(1).optional(),
    timeBillId: z.number().int().positive().optional(),
    hours: z.number().positive().optional(),
    date: z.string().trim().min(1).optional(),
    memo: z.string().optional(),
    isBillable: z.boolean().optional(),
    customer: z.number().int().positive().optional(),
    item: z.union([z.number().int().positive(), z.string().trim().min(1)]).optional(),
    caseTaskEvent: z.number().int().positive().nullable().optional(),
});

function parseOptionalPositiveInt(value: string | null | undefined) {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error("Expected a positive integer query parameter");
    }
    return parsed;
}

function parseOptionalNonNegativeInt(value: string | null | undefined) {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error("Expected a non-negative integer query parameter");
    }
    return parsed;
}

function buildErrorResponse(result: NetSuiteRestletResult<unknown>) {
    const body = result.payload ?? {
        success: false,
        error: result.error || result.message || "NetSuite request failed",
        code: result.code || (result.missing?.length ? "CONFIG_MISSING" : "INTERNAL_ERROR"),
        missing: result.missing,
    };

    return NextResponse.json(body, {
        status: result.status >= 400 ? result.status : 502,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}

export async function GET(request: NextRequest) {
    const actionValue = request.nextUrl.searchParams.get("action");

    try {
        const action = getActionSchema.parse(actionValue);

        if (action === "getTimeEntry") {
            const result = await getNetSuiteTimeEntry({
                externalId: request.nextUrl.searchParams.get("externalId") || undefined,
                timeBillId: parseOptionalPositiveInt(request.nextUrl.searchParams.get("timeBillId")),
            });

            if (!result.ok || !result.payload) return buildErrorResponse(result);
            return NextResponse.json(result.payload, {
                status: 200,
                headers: {
                    "Cache-Control": "no-store",
                },
            });
        }

        const result = await searchNetSuiteTimeEntries({
            employeeId: parseOptionalPositiveInt(request.nextUrl.searchParams.get("employeeId")),
            projectId: parseOptionalPositiveInt(request.nextUrl.searchParams.get("projectId")),
            dateFrom: request.nextUrl.searchParams.get("dateFrom") || undefined,
            dateTo: request.nextUrl.searchParams.get("dateTo") || undefined,
            limit: parseOptionalPositiveInt(request.nextUrl.searchParams.get("limit")),
            offset: parseOptionalNonNegativeInt(request.nextUrl.searchParams.get("offset")),
        });

        if (!result.ok || !result.payload) return buildErrorResponse(result);
        return NextResponse.json(result.payload, {
            status: 200,
            headers: {
                "Cache-Control": "no-store",
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: String(error?.message || "Invalid NetSuite time entry request"),
                code: actionValue ? "VALIDATION_FAILED" : "MISSING_ACTION",
            },
            {
                status: 400,
                headers: {
                    "Cache-Control": "no-store",
                },
            }
        );
    }
}

export async function POST(request: NextRequest) {
    if (!isNetSuiteSyncAuthorized(request)) {
        return NextResponse.json(
            {
                success: false,
                error: "Unauthorized NetSuite time entry request",
                code: "UNAUTHORIZED",
            },
            {
                status: 401,
                headers: {
                    "Cache-Control": "no-store",
                },
            }
        );
    }

    let body: any = {};
    try {
        body = await request.json();
    } catch {
        body = {};
    }

    try {
        const action = postActionSchema.parse(body?.action);

        if (action === "createTimeEntry") {
            const data = createTimeEntrySchema.parse(body?.data ?? {});
            const result = await createNetSuiteTimeEntry(data);
            if (!result.ok || !result.payload) return buildErrorResponse(result);
            return NextResponse.json(result.payload, {
                status: 200,
                headers: {
                    "Cache-Control": "no-store",
                },
            });
        }

        if (action === "batchCreateTimeEntries") {
            const entries = z.array(createTimeEntrySchema).parse(body?.entries ?? []);
            const result = await batchCreateNetSuiteTimeEntries(entries);
            if (!result.ok || !result.payload) return buildErrorResponse(result);
            return NextResponse.json(result.payload, {
                status: 200,
                headers: {
                    "Cache-Control": "no-store",
                },
            });
        }

        const data = updateTimeEntrySchema.parse(body?.data ?? {});
        const result = await updateNetSuiteTimeEntry(data);
        if (!result.ok || !result.payload) return buildErrorResponse(result);
        return NextResponse.json(result.payload, {
            status: 200,
            headers: {
                "Cache-Control": "no-store",
            },
        });
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: String(error?.message || "Invalid NetSuite time entry request"),
                code: body?.action ? "VALIDATION_FAILED" : "MISSING_ACTION",
            },
            {
                status: 400,
                headers: {
                    "Cache-Control": "no-store",
                },
            }
        );
    }
}
