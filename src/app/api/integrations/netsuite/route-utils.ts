import type { NextRequest } from "next/server";

function normalizeToken(value: string | null | undefined) {
    return String(value || "").trim();
}

function extractBearerToken(authHeader: string | null) {
    const normalized = normalizeToken(authHeader);
    if (!normalized) return "";
    const match = normalized.match(/^Bearer\s+(.+)$/i);
    return match ? normalizeToken(match[1]) : "";
}

/**
 * Authorizes internal NetSuite sync endpoints.
 *
 * Expected config:
 * - Set `NETSUITE_SYNC_TOKEN` in the environment
 * - Send it either as:
 *   - `Authorization: Bearer <token>` OR
 *   - `x-netsuite-sync-token: <token>`
 */
export function isNetSuiteSyncAuthorized(request: NextRequest) {
    const expected = normalizeToken(process.env.NETSUITE_SYNC_TOKEN);
    if (!expected) return false;

    const bearer = extractBearerToken(request.headers.get("authorization"));
    const headerToken = normalizeToken(request.headers.get("x-netsuite-sync-token"));
    const provided = bearer || headerToken;

    return provided.length > 0 && provided === expected;
}

