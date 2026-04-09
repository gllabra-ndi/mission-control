import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
    getNetSuiteEmployee,
    getNetSuiteProject,
    listNetSuiteEmployees,
    listNetSuiteProjects,
    listNetSuiteServiceItems,
    type NetSuiteRestletResult,
} from "@/lib/netsuite";

export const dynamic = "force-dynamic";

const actionSchema = z.enum([
    "listEmployees",
    "getEmployee",
    "listProjects",
    "getProject",
    "listServiceItems",
]);

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
        const action = actionSchema.parse(actionValue);
        const limit = parseOptionalPositiveInt(request.nextUrl.searchParams.get("limit"));
        const offset = parseOptionalNonNegativeInt(request.nextUrl.searchParams.get("offset"));

        switch (action) {
            case "listEmployees": {
                const result = await listNetSuiteEmployees({
                    limit,
                    offset,
                    department: parseOptionalPositiveInt(request.nextUrl.searchParams.get("department")),
                    supervisor: parseOptionalPositiveInt(request.nextUrl.searchParams.get("supervisor")),
                });
                if (!result.ok || !result.payload) return buildErrorResponse(result);
                return NextResponse.json(result.payload, {
                    status: 200,
                    headers: {
                        "Cache-Control": "no-store",
                    },
                });
            }
            case "getEmployee": {
                const result = await getNetSuiteEmployee({
                    employeeId: parseOptionalPositiveInt(request.nextUrl.searchParams.get("employeeId")),
                    email: request.nextUrl.searchParams.get("email") || undefined,
                });
                if (!result.ok || !result.payload) return buildErrorResponse(result);
                return NextResponse.json(result.payload, {
                    status: 200,
                    headers: {
                        "Cache-Control": "no-store",
                    },
                });
            }
            case "listProjects": {
                const result = await listNetSuiteProjects({
                    limit,
                    offset,
                    status: parseOptionalPositiveInt(request.nextUrl.searchParams.get("status")),
                    customer: parseOptionalPositiveInt(request.nextUrl.searchParams.get("customer")),
                });
                if (!result.ok || !result.payload) return buildErrorResponse(result);
                return NextResponse.json(result.payload, {
                    status: 200,
                    headers: {
                        "Cache-Control": "no-store",
                    },
                });
            }
            case "getProject": {
                const projectId = parseOptionalPositiveInt(request.nextUrl.searchParams.get("projectId"));
                if (!projectId) {
                    return NextResponse.json(
                        {
                            success: false,
                            error: "projectId is required",
                            code: "MISSING_PARAMS",
                        },
                        {
                            status: 400,
                            headers: {
                                "Cache-Control": "no-store",
                            },
                        }
                    );
                }

                const result = await getNetSuiteProject({ projectId });
                if (!result.ok || !result.payload) return buildErrorResponse(result);
                return NextResponse.json(result.payload, {
                    status: 200,
                    headers: {
                        "Cache-Control": "no-store",
                    },
                });
            }
            case "listServiceItems": {
                const result = await listNetSuiteServiceItems({ limit, offset });
                if (!result.ok || !result.payload) return buildErrorResponse(result);
                return NextResponse.json(result.payload, {
                    status: 200,
                    headers: {
                        "Cache-Control": "no-store",
                    },
                });
            }
        }
    } catch (error: any) {
        return NextResponse.json(
            {
                success: false,
                error: String(error?.message || "Invalid discovery request"),
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
