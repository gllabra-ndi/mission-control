import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
    getNetSuiteConfigFromEnv,
    getNetSuiteDiscoveryDeployIdFromEnv,
    getNetSuiteDiscoveryScriptIdFromEnv,
    getNetSuiteRestletPathFromEnv,
    syncNetSuiteConsultants,
} from "@/lib/netsuite";
import { isNetSuiteSyncAuthorized } from "@/app/api/integrations/netsuite/route-utils";

export const dynamic = "force-dynamic";

const syncRequestSchema = z.object({
    dryRun: z.boolean().optional(),
    department: z.number().int().positive().optional(),
    supervisor: z.number().int().positive().optional(),
});

export async function GET() {
    const { config, missing } = getNetSuiteConfigFromEnv();
    const discoveryPreviewPath = config
        ? `${config.baseUrl}${getNetSuiteRestletPathFromEnv()}?script=${getNetSuiteDiscoveryScriptIdFromEnv()}&deploy=${getNetSuiteDiscoveryDeployIdFromEnv()}&action=listEmployees&limit=1&offset=0`
        : null;

    return NextResponse.json(
        {
            ok: missing.length === 0,
            restletPath: getNetSuiteRestletPathFromEnv(),
            discoveryScriptId: getNetSuiteDiscoveryScriptIdFromEnv(),
            discoveryDeployId: getNetSuiteDiscoveryDeployIdFromEnv(),
            previewEndpoint: discoveryPreviewPath,
            missing,
            syncTokenConfigured: Boolean(String(process.env.NETSUITE_SYNC_TOKEN || "").trim()),
        },
        {
            status: 200,
            headers: {
                "Cache-Control": "no-store",
            },
        }
    );
}

export async function POST(request: NextRequest) {
    if (!isNetSuiteSyncAuthorized(request)) {
        return NextResponse.json(
            {
                ok: false,
                message: "Unauthorized NetSuite sync request",
            },
            {
                status: 401,
                headers: {
                    "Cache-Control": "no-store",
                },
            }
        );
    }

    let payload: z.infer<typeof syncRequestSchema> = {};
    try {
        const body = await request.json().catch(() => ({}));
        payload = syncRequestSchema.parse(body);
    } catch (error: any) {
        return NextResponse.json(
            {
                ok: false,
                message: String(error?.message || "Invalid sync request body"),
            },
            {
                status: 400,
                headers: {
                    "Cache-Control": "no-store",
                },
            }
        );
    }

    const result = await syncNetSuiteConsultants({
        dryRun: payload.dryRun,
        department: payload.department,
        supervisor: payload.supervisor,
    });

    if (result.ok && !result.dryRun) {
        revalidatePath("/");
    }

    return NextResponse.json(result, {
        status: result.ok ? 200 : result.status >= 400 ? result.status : 502,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}
