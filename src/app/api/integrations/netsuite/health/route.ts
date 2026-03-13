import { NextResponse } from "next/server";
import { netSuiteHealthCheck } from "@/lib/netsuite";

export const dynamic = "force-dynamic";

export async function GET() {
    const result = await netSuiteHealthCheck();
    const status = result.ok ? 200 : result.status >= 400 ? result.status : 502;
    return NextResponse.json(result, {
        status,
        headers: {
            "Cache-Control": "no-store",
        },
    });
}
