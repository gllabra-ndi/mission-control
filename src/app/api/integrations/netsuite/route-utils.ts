import type { NextRequest } from "next/server";

function normalizeToken(value: string | null | undefined) {
    return String(value || "").trim();
}

export function getNetSuiteSyncTokenFromRequest(request: NextRequest): string {
    const authHeader = normalizeToken(request.headers.get("authorization"));
    if (authHeader.toLowerCase().startsWith("bearer ")) {
        return normalizeToken(authHeader.slice(7));
    }

    return (
        normalizeToken(request.headers.get("x-sync-token")) ||
        normalizeToken(request.headers.get("x-netsuite-sync-token"))
    );
}

export function isNetSuiteSyncAuthorized(request: NextRequest): boolean {
    const expected = normalizeToken(process.env.NETSUITE_SYNC_TOKEN);
    if (!expected) return false;
    return getNetSuiteSyncTokenFromRequest(request) === expected;
}
