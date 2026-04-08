import { NextRequest } from "next/server";

export function getNetSuiteSyncTokenFromRequest(request: NextRequest): string {
    const authHeader = String(request.headers.get("authorization") || "").trim();
    if (authHeader.toLowerCase().startsWith("bearer ")) {
        return authHeader.slice(7).trim();
    }
    return String(request.headers.get("x-sync-token") || "").trim();
}

export function isNetSuiteSyncAuthorized(request: NextRequest): boolean {
    const expected = String(process.env.NETSUITE_SYNC_TOKEN || "").trim();
    if (!expected) return true;
    return getNetSuiteSyncTokenFromRequest(request) === expected;
}
