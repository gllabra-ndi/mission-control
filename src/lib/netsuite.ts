import "server-only";

import crypto from "crypto";

export interface NetSuiteConfig {
    accountId: string;
    realm: string;
    baseUrl: string;
    consumerKey: string;
    consumerSecret: string;
    tokenId: string;
    tokenSecret: string;
    healthPath: string;
}

export interface NetSuiteConfigValidation {
    config: NetSuiteConfig | null;
    missing: string[];
}

function percentEncode(value: string): string {
    return encodeURIComponent(value)
        .replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuthParams(config: NetSuiteConfig): Record<string, string> {
    return {
        oauth_consumer_key: config.consumerKey,
        oauth_token: config.tokenId,
        oauth_signature_method: "HMAC-SHA256",
        oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
        oauth_nonce: crypto.randomBytes(16).toString("hex"),
        oauth_version: "1.0",
    };
}

function normalizeParams(url: URL, oauthParams: Record<string, string>): string {
    const pairs: Array<[string, string]> = [];

    url.searchParams.forEach((value, key) => {
        pairs.push([percentEncode(key), percentEncode(value)]);
    });

    Object.entries(oauthParams).forEach(([key, value]) => {
        pairs.push([percentEncode(key), percentEncode(value)]);
    });

    pairs.sort((a, b) => {
        if (a[0] === b[0]) return a[1].localeCompare(b[1]);
        return a[0].localeCompare(b[0]);
    });

    return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

function buildSignatureBaseString(method: string, url: URL, normalizedParams: string): string {
    const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;
    return [
        method.toUpperCase(),
        percentEncode(baseUrl),
        percentEncode(normalizedParams),
    ].join("&");
}

function buildAuthorizationHeader(
    config: NetSuiteConfig,
    oauthParams: Record<string, string>,
    signature: string
): string {
    const headerParams: Array<[string, string]> = [
        ["realm", config.realm],
        ...Object.entries({ ...oauthParams, oauth_signature: signature }),
    ];

    return `OAuth ${headerParams
        .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
        .join(", ")}`;
}

function sanitizeBaseUrl(rawBaseUrl: string): string {
    const trimmed = rawBaseUrl.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
    return trimmed;
}

function buildBaseUrl(accountId: string, baseUrl?: string): string {
    if (baseUrl && baseUrl.trim().length > 0) return sanitizeBaseUrl(baseUrl);
    return `https://${accountId}.suitetalk.api.netsuite.com`;
}

export function getNetSuiteConfigFromEnv(): NetSuiteConfigValidation {
    const accountId = String(process.env.NETSUITE_ACCOUNT_ID || "").trim();
    const consumerKey = String(process.env.NETSUITE_CONSUMER_KEY || "").trim();
    const consumerSecret = String(process.env.NETSUITE_CONSUMER_SECRET || "").trim();
    const tokenId = String(process.env.NETSUITE_TOKEN_ID || "").trim();
    const tokenSecret = String(process.env.NETSUITE_TOKEN_SECRET || "").trim();
    const realm = String(process.env.NETSUITE_REALM || accountId).trim();
    const healthPath = String(process.env.NETSUITE_HEALTH_PATH || "/services/rest/record/v1/metadata-catalog?limit=1").trim();

    const missing: string[] = [];
    if (!accountId) missing.push("NETSUITE_ACCOUNT_ID");
    if (!consumerKey) missing.push("NETSUITE_CONSUMER_KEY");
    if (!consumerSecret) missing.push("NETSUITE_CONSUMER_SECRET");
    if (!tokenId) missing.push("NETSUITE_TOKEN_ID");
    if (!tokenSecret) missing.push("NETSUITE_TOKEN_SECRET");

    if (missing.length > 0) return { config: null, missing };

    const config: NetSuiteConfig = {
        accountId,
        realm,
        baseUrl: buildBaseUrl(accountId, process.env.NETSUITE_BASE_URL),
        consumerKey,
        consumerSecret,
        tokenId,
        tokenSecret,
        healthPath: healthPath.startsWith("/") ? healthPath : `/${healthPath}`,
    };

    return { config, missing: [] };
}

function buildSignedRequestHeaders(config: NetSuiteConfig, method: string, url: URL): Headers {
    const oauthParams = buildOAuthParams(config);
    const normalizedParams = normalizeParams(url, oauthParams);
    const signatureBaseString = buildSignatureBaseString(method, url, normalizedParams);
    const signingKey = `${percentEncode(config.consumerSecret)}&${percentEncode(config.tokenSecret)}`;
    const signature = crypto
        .createHmac("sha256", signingKey)
        .update(signatureBaseString)
        .digest("base64");

    const headers = new Headers();
    headers.set("Authorization", buildAuthorizationHeader(config, oauthParams, signature));
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    return headers;
}

export async function netSuiteRequest(
    config: NetSuiteConfig,
    path: string,
    options?: { method?: "GET" | "POST"; body?: unknown }
): Promise<Response> {
    const method = options?.method || "GET";
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${config.baseUrl}${cleanPath}`);
    const headers = buildSignedRequestHeaders(config, method, url);

    const init: RequestInit = {
        method,
        headers,
        cache: "no-store",
    };

    if (options?.body !== undefined) {
        init.body = JSON.stringify(options.body);
    }

    return fetch(url.toString(), init);
}

export async function netSuiteHealthCheck() {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            message: "Missing NetSuite configuration",
            missing,
        };
    }

    try {
        const response = await netSuiteRequest(config, config.healthPath, { method: "GET" });
        const text = await response.text();
        return {
            ok: response.ok,
            status: response.status,
            endpoint: `${config.baseUrl}${config.healthPath}`,
            bodyPreview: text.slice(0, 1000),
        };
    } catch (error: any) {
        return {
            ok: false,
            status: 500,
            endpoint: `${config.baseUrl}${config.healthPath}`,
            message: String(error?.message || "Unknown NetSuite connection error"),
        };
    }
}
