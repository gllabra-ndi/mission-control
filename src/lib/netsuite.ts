import "server-only";

import crypto from "crypto";
import { prisma } from "@/lib/prisma";

type NetSuiteQueryValue = string | number | boolean | null | undefined;

export interface NetSuiteConfig {
    accountId: string;
    realm: string;
    baseUrl: string;
    consumerKey: string;
    consumerSecret: string;
    tokenId: string;
    tokenSecret: string;
    restletPath: string;
    discoveryScriptId: string;
    discoveryDeployId: string;
    timeEntryScriptId: string;
    timeEntryDeployId: string;
}

export interface NetSuiteConfigValidation {
    config: NetSuiteConfig | null;
    missing: string[];
}

export interface NetSuiteGovernance {
    remaining?: number;
}

export interface NetSuitePagination {
    limit?: number;
    offset?: number;
    count?: number;
}

export interface NetSuiteRestletSuccessEnvelope<T> {
    success: true;
    data: T;
    _governance?: NetSuiteGovernance;
    _pagination?: NetSuitePagination;
}

export interface NetSuiteRestletErrorEnvelope {
    success: false;
    error: string;
    code?: string;
    _governance?: NetSuiteGovernance;
    _pagination?: NetSuitePagination;
}

export type NetSuiteRestletEnvelope<T> =
    | NetSuiteRestletSuccessEnvelope<T>
    | NetSuiteRestletErrorEnvelope;

export interface NetSuiteRestletResult<T> {
    ok: boolean;
    status: number;
    endpoint: string;
    payload: NetSuiteRestletEnvelope<T> | null;
    data?: T;
    error?: string;
    code?: string;
    missing?: string[];
    message?: string;
    governanceRemaining?: number;
    pagination?: NetSuitePagination;
}

export interface NetSuiteEmployeeRecord {
    id: string;
    entityid: string;
    email: string;
    firstname: string;
    lastname: string;
    title?: string;
    department?: string;
    departmentText?: string;
    supervisor?: string;
    supervisorText?: string;
    hiredate?: string;
}

export interface NetSuiteProjectRecord {
    id: string;
    entityid: string;
    companyname: string;
    parent?: string;
    parentText?: string;
    status?: string;
    statusText?: string;
    startdate?: string;
    enddate?: string;
    projectmanager?: string;
    projectmanagerText?: string;
}

export interface NetSuiteServiceItemRecord {
    id: string;
    itemid: string;
    displayname?: string;
    description?: string;
}

export interface NetSuiteTimeEntryRecord {
    timeBillId: string;
    employee?: string | number | null;
    customer?: string | number | null;
    hours?: number | null;
    trandate?: string | null;
    memo?: string | null;
    isBillable?: boolean | null;
    item?: string | number | null;
    caseTaskEvent?: string | number | null;
    externalId?: string | null;
}

export interface NetSuiteCreateTimeEntryInput {
    externalId: string;
    employeeEmail?: string;
    employeeId?: number;
    customer?: number;
    hours: number;
    date: string;
    memo?: string;
    isBillable?: boolean;
    item?: number | string;
    caseTaskEvent?: number | null;
    formId?: number | null;
}

export interface NetSuiteUpdateTimeEntryInput {
    externalId?: string;
    timeBillId?: number;
    hours?: number;
    date?: string;
    memo?: string;
    isBillable?: boolean;
    customer?: number;
    item?: number | string;
    caseTaskEvent?: number | null;
}

export interface NetSuiteCreateTimeEntryResponse {
    timeBillId: string;
    externalId: string;
    duplicate?: boolean;
}

export interface NetSuiteBatchCreateTimeEntriesResponse {
    created: Array<{ index: number; timeBillId: string; externalId: string }>;
    skipped: Array<{ index: number; externalId: string; timeBillId?: string; reason?: string }>;
    errors: Array<{ index: number; externalId?: string; error: string }>;
}

export interface NetSuiteUpdateTimeEntryResponse {
    timeBillId: string;
    updated: boolean;
}

export interface NetSuiteSearchTimeEntriesResponse {
    results: NetSuiteTimeEntryRecord[];
    count: number;
    offset: number;
    limit: number;
    hasMore: boolean;
}

export interface NetSuiteConsultantRecord {
    externalId: string;
    firstName: string;
    lastName: string;
    fullName: string;
    email: string;
    isInactive: boolean;
}

export interface NetSuiteConsultantSyncResult {
    ok: boolean;
    status: number;
    sourcePath: string;
    fetched: number;
    created: number;
    updated: number;
    skippedInactive: number;
    skippedInvalid: number;
    dryRun: boolean;
    missing?: string[];
    message?: string;
    consultants?: NetSuiteConsultantRecord[];
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

    return pairs.map(([key, value]) => `${key}=${value}`).join("&");
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
    return `https://${accountId}.restlets.api.netsuite.com`;
}

function normalizePath(path: string): string {
    const trimmed = String(path || "").trim();
    if (!trimmed) return "/";
    return trimmed;
}

function buildRequestUrl(config: NetSuiteConfig, path: string): URL {
    const normalizedPath = normalizePath(path);
    if (/^https?:\/\//i.test(normalizedPath)) {
        return new URL(normalizedPath);
    }
    const cleanPath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
    return new URL(`${config.baseUrl}${cleanPath}`);
}

function normalizeString(value: unknown): string {
    return String(value ?? "").trim();
}

function normalizeLowercaseEmail(value: unknown): string {
    return normalizeString(value).toLowerCase();
}

function normalizeBoolean(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    const normalized = normalizeString(value).toLowerCase();
    return normalized === "true" || normalized === "t" || normalized === "yes" || normalized === "y" || normalized === "1";
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
    const normalized = normalizeString(fullName);
    if (!normalized) return { firstName: "", lastName: "" };
    const commaTokens = normalized.split(",").map((token) => token.trim()).filter(Boolean);
    if (commaTokens.length === 2) {
        return {
            firstName: commaTokens[1],
            lastName: commaTokens[0],
        };
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) {
        return { firstName: normalized, lastName: "" };
    }

    return {
        firstName: tokens.slice(0, -1).join(" "),
        lastName: tokens.slice(-1).join(" "),
    };
}

function buildFullName(firstName: string, lastName: string): string {
    return `${normalizeString(firstName)} ${normalizeString(lastName)}`.trim();
}

function toQueryValue(value: NetSuiteQueryValue): string | null {
    if (value == null) return null;
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? String(value) : null;
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    return normalizeString(value);
}

function buildRestletPath(path: string, params: Record<string, NetSuiteQueryValue>): string {
    const normalizedPath = normalizePath(path);
    const isAbsoluteUrl = /^https?:\/\//i.test(normalizedPath);
    const url = isAbsoluteUrl
        ? new URL(normalizedPath)
        : new URL(normalizedPath, "https://netsuite.local");

    Object.entries(params).forEach(([key, value]) => {
        const normalizedValue = toQueryValue(value);
        if (normalizedValue === null) return;
        url.searchParams.set(key, normalizedValue);
    });

    return isAbsoluteUrl ? url.toString() : `${url.pathname}${url.search}`;
}

function getRestletStatusForErrorCode(code?: string): number {
    switch (String(code || "").trim().toUpperCase()) {
        case "MISSING_ACTION":
        case "MISSING_PARAMS":
        case "VALIDATION_FAILED":
        case "BATCH_LIMIT_EXCEEDED":
            return 400;
        case "INVALID_ACTION":
        case "METHOD_NOT_ALLOWED":
            return 405;
        case "NOT_FOUND":
        case "RECORD_NOT_FOUND":
            return 404;
        case "RECORD_LOCKED":
            return 409;
        case "INTERNAL_ERROR":
            return 500;
        default:
            return 502;
    }
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

export function getNetSuiteRestletPathFromEnv(): string {
    return normalizePath(
        process.env.NETSUITE_RESTLET_PATH ||
        "/app/site/hosting/restlet.nl"
    );
}

export function getNetSuiteDiscoveryScriptIdFromEnv(): string {
    return normalizeString(process.env.NETSUITE_DISCOVERY_SCRIPT_ID || "2757");
}

export function getNetSuiteDiscoveryDeployIdFromEnv(): string {
    return normalizeString(process.env.NETSUITE_DISCOVERY_DEPLOY_ID || "1");
}

export function getNetSuiteTimeEntryScriptIdFromEnv(): string {
    return normalizeString(process.env.NETSUITE_TIME_ENTRY_SCRIPT_ID || "2758");
}

export function getNetSuiteTimeEntryDeployIdFromEnv(): string {
    return normalizeString(process.env.NETSUITE_TIME_ENTRY_DEPLOY_ID || "1");
}

export function getNetSuiteConfigFromEnv(): NetSuiteConfigValidation {
    const accountId = String(process.env.NETSUITE_ACCOUNT_ID || "").trim();
    const consumerKey = String(process.env.NETSUITE_CONSUMER_KEY || "").trim();
    const consumerSecret = String(process.env.NETSUITE_CONSUMER_SECRET || "").trim();
    const tokenId = String(process.env.NETSUITE_TOKEN_ID || "").trim();
    const tokenSecret = String(process.env.NETSUITE_TOKEN_SECRET || "").trim();
    const realm = String(process.env.NETSUITE_REALM || accountId).trim();

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
        restletPath: getNetSuiteRestletPathFromEnv(),
        discoveryScriptId: getNetSuiteDiscoveryScriptIdFromEnv(),
        discoveryDeployId: getNetSuiteDiscoveryDeployIdFromEnv(),
        timeEntryScriptId: getNetSuiteTimeEntryScriptIdFromEnv(),
        timeEntryDeployId: getNetSuiteTimeEntryDeployIdFromEnv(),
    };

    return { config, missing: [] };
}

function buildDiscoveryRestletPath(
    config: NetSuiteConfig,
    params: Record<string, NetSuiteQueryValue>
): string {
    return buildRestletPath(config.restletPath, {
        script: config.discoveryScriptId,
        deploy: config.discoveryDeployId,
        ...params,
    });
}

function buildTimeEntryRestletPath(
    config: NetSuiteConfig,
    params: Record<string, NetSuiteQueryValue>
): string {
    return buildRestletPath(config.restletPath, {
        script: config.timeEntryScriptId,
        deploy: config.timeEntryDeployId,
        ...params,
    });
}

export async function netSuiteRequest(
    config: NetSuiteConfig,
    path: string,
    options?: { method?: "GET" | "POST"; body?: unknown }
): Promise<Response> {
    const method = options?.method || "GET";
    const url = buildRequestUrl(config, path);
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

async function netSuiteRestletRequest<T>(
    config: NetSuiteConfig,
    input: {
        path: string;
        method?: "GET" | "POST";
        body?: unknown;
    }
): Promise<NetSuiteRestletResult<T>> {
    const method = input.method || "GET";
    const endpoint = buildRequestUrl(config, input.path).toString();

    try {
        const response = await netSuiteRequest(config, input.path, {
            method,
            body: input.body,
        });
        const text = await response.text();

        let payload: NetSuiteRestletEnvelope<T> | null = null;
        try {
            payload = text ? JSON.parse(text) : null;
        } catch {
            return {
                ok: false,
                status: 502,
                endpoint,
                payload: null,
                message: "NetSuite RESTlet response was not valid JSON",
            };
        }

        const governanceRemaining = payload?._governance?.remaining;
        const pagination = payload?._pagination;

        if (payload?.success) {
            return {
                ok: response.ok,
                status: response.status,
                endpoint,
                payload,
                data: payload.data,
                governanceRemaining,
                pagination,
            };
        }

        const errorStatus = response.ok
            ? getRestletStatusForErrorCode(payload?.code)
            : response.status;

        return {
            ok: false,
            status: errorStatus,
            endpoint,
            payload,
            error: payload?.error || "NetSuite RESTlet request failed",
            code: payload?.code,
            governanceRemaining,
            pagination,
        };
    } catch (error: any) {
        return {
            ok: false,
            status: 500,
            endpoint,
            payload: null,
            message: String(error?.message || "Unknown NetSuite RESTlet error"),
        };
    }
}

export async function listNetSuiteEmployees(input?: {
    limit?: number;
    offset?: number;
    department?: number;
    supervisor?: number;
}) {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            endpoint: "",
            payload: null,
            missing,
            message: "Missing NetSuite configuration",
        } satisfies NetSuiteRestletResult<NetSuiteEmployeeRecord[]>;
    }

    return netSuiteRestletRequest<NetSuiteEmployeeRecord[]>(config, {
        path: buildDiscoveryRestletPath(config, {
            action: "listEmployees",
            limit: input?.limit ?? 1000,
            offset: input?.offset ?? 0,
            department: input?.department,
            supervisor: input?.supervisor,
        }),
        method: "GET",
    });
}

export async function getNetSuiteEmployee(input: {
    employeeId?: number;
    email?: string;
}) {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            endpoint: "",
            payload: null,
            missing,
            message: "Missing NetSuite configuration",
        } satisfies NetSuiteRestletResult<NetSuiteEmployeeRecord>;
    }

    return netSuiteRestletRequest<NetSuiteEmployeeRecord>(config, {
        path: buildDiscoveryRestletPath(config, {
            action: "getEmployee",
            employeeId: input.employeeId,
            email: input.email,
        }),
        method: "GET",
    });
}

export async function listNetSuiteProjects(input?: {
    limit?: number;
    offset?: number;
    status?: number;
    customer?: number;
}) {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            endpoint: "",
            payload: null,
            missing,
            message: "Missing NetSuite configuration",
        } satisfies NetSuiteRestletResult<NetSuiteProjectRecord[]>;
    }

    return netSuiteRestletRequest<NetSuiteProjectRecord[]>(config, {
        path: buildDiscoveryRestletPath(config, {
            action: "listProjects",
            limit: input?.limit ?? 1000,
            offset: input?.offset ?? 0,
            status: input?.status,
            customer: input?.customer,
        }),
        method: "GET",
    });
}

export async function getNetSuiteProject(input: {
    projectId: number;
}) {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            endpoint: "",
            payload: null,
            missing,
            message: "Missing NetSuite configuration",
        } satisfies NetSuiteRestletResult<NetSuiteProjectRecord>;
    }

    return netSuiteRestletRequest<NetSuiteProjectRecord>(config, {
        path: buildDiscoveryRestletPath(config, {
            action: "getProject",
            projectId: input.projectId,
        }),
        method: "GET",
    });
}

export async function listNetSuiteServiceItems(input?: {
    limit?: number;
    offset?: number;
}) {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            endpoint: "",
            payload: null,
            missing,
            message: "Missing NetSuite configuration",
        } satisfies NetSuiteRestletResult<NetSuiteServiceItemRecord[]>;
    }

    return netSuiteRestletRequest<NetSuiteServiceItemRecord[]>(config, {
        path: buildDiscoveryRestletPath(config, {
            action: "listServiceItems",
            limit: input?.limit ?? 1000,
            offset: input?.offset ?? 0,
        }),
        method: "GET",
    });
}

export async function createNetSuiteTimeEntry(data: NetSuiteCreateTimeEntryInput) {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            endpoint: "",
            payload: null,
            missing,
            message: "Missing NetSuite configuration",
        } satisfies NetSuiteRestletResult<NetSuiteCreateTimeEntryResponse>;
    }

    return netSuiteRestletRequest<NetSuiteCreateTimeEntryResponse>(config, {
        path: buildTimeEntryRestletPath(config, {}),
        method: "POST",
        body: {
            action: "createTimeEntry",
            data,
        },
    });
}

export async function batchCreateNetSuiteTimeEntries(entries: NetSuiteCreateTimeEntryInput[]) {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            endpoint: "",
            payload: null,
            missing,
            message: "Missing NetSuite configuration",
        } satisfies NetSuiteRestletResult<NetSuiteBatchCreateTimeEntriesResponse>;
    }

    return netSuiteRestletRequest<NetSuiteBatchCreateTimeEntriesResponse>(config, {
        path: buildTimeEntryRestletPath(config, {}),
        method: "POST",
        body: {
            action: "batchCreateTimeEntries",
            entries,
        },
    });
}

export async function updateNetSuiteTimeEntry(data: NetSuiteUpdateTimeEntryInput) {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            endpoint: "",
            payload: null,
            missing,
            message: "Missing NetSuite configuration",
        } satisfies NetSuiteRestletResult<NetSuiteUpdateTimeEntryResponse>;
    }

    return netSuiteRestletRequest<NetSuiteUpdateTimeEntryResponse>(config, {
        path: buildTimeEntryRestletPath(config, {}),
        method: "POST",
        body: {
            action: "updateTimeEntry",
            data,
        },
    });
}

export async function getNetSuiteTimeEntry(input: {
    externalId?: string;
    timeBillId?: number;
}) {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            endpoint: "",
            payload: null,
            missing,
            message: "Missing NetSuite configuration",
        } satisfies NetSuiteRestletResult<NetSuiteTimeEntryRecord>;
    }

    return netSuiteRestletRequest<NetSuiteTimeEntryRecord>(config, {
        path: buildTimeEntryRestletPath(config, {
            action: "getTimeEntry",
            externalId: input.externalId,
            timeBillId: input.timeBillId,
        }),
        method: "GET",
    });
}

export async function searchNetSuiteTimeEntries(input: {
    employeeId?: number;
    projectId?: number;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
    offset?: number;
}) {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            endpoint: "",
            payload: null,
            missing,
            message: "Missing NetSuite configuration",
        } satisfies NetSuiteRestletResult<NetSuiteSearchTimeEntriesResponse>;
    }

    return netSuiteRestletRequest<NetSuiteSearchTimeEntriesResponse>(config, {
        path: buildTimeEntryRestletPath(config, {
            action: "searchTimeEntries",
            employeeId: input.employeeId,
            projectId: input.projectId,
            dateFrom: input.dateFrom,
            dateTo: input.dateTo,
            limit: input.limit ?? 100,
            offset: input.offset ?? 0,
        }),
        method: "GET",
    });
}

async function fetchAllNetSuiteEmployees(input?: {
    department?: number;
    supervisor?: number;
}): Promise<{
    ok: boolean;
    status: number;
    sourcePath: string;
    employees: NetSuiteEmployeeRecord[];
    missing?: string[];
    message?: string;
}> {
    const { config, missing } = getNetSuiteConfigFromEnv();
    if (!config) {
        return {
            ok: false,
            status: 400,
            sourcePath: "",
            employees: [],
            missing,
            message: "Missing NetSuite configuration",
        };
    }

    const pageSize = 1000;
    const employees: NetSuiteEmployeeRecord[] = [];
    let offset = 0;
    let pageCount = 0;
    let sourcePath = buildDiscoveryRestletPath(config, {
        action: "listEmployees",
        limit: pageSize,
        offset,
        department: input?.department,
        supervisor: input?.supervisor,
    });

    while (pageCount < 20) {
        pageCount += 1;
        const result = await netSuiteRestletRequest<NetSuiteEmployeeRecord[]>(config, {
            path: buildDiscoveryRestletPath(config, {
                action: "listEmployees",
                limit: pageSize,
                offset,
                department: input?.department,
                supervisor: input?.supervisor,
            }),
            method: "GET",
        });

        if (!result.ok || !Array.isArray(result.data)) {
            return {
                ok: false,
                status: result.status,
                sourcePath,
                employees: [],
                missing: result.missing,
                message: result.error || result.message || "NetSuite employee fetch failed",
            };
        }

        employees.push(...result.data);
        const currentCount = result.pagination?.count ?? result.data.length;
        if (currentCount < pageSize) break;
        offset += currentCount;
    }

    return {
        ok: true,
        status: 200,
        sourcePath,
        employees,
    };
}

function normalizeNetSuiteConsultant(record: any): NetSuiteConsultantRecord | null {
    const externalId = normalizeString(
        record?.id ??
        record?.internalId ??
        record?.employeeId ??
        record?.entityId
    );
    const email = normalizeLowercaseEmail(
        record?.email ??
        record?.emailAddress
    );

    let firstName = normalizeString(
        record?.firstName ??
        record?.firstname ??
        record?.givenName
    );
    let lastName = normalizeString(
        record?.lastName ??
        record?.lastname ??
        record?.surname ??
        record?.familyName
    );
    const fullName = normalizeString(
        record?.name ??
        record?.fullName ??
        record?.entityId ??
        record?.entityid ??
        buildFullName(firstName, lastName)
    );

    if ((!firstName || !lastName) && fullName) {
        const split = splitFullName(fullName);
        if (!firstName) firstName = split.firstName;
        if (!lastName) lastName = split.lastName;
    }

    const resolvedFullName = buildFullName(firstName, lastName) || fullName;
    const isInactive = normalizeBoolean(
        record?.isInactive ??
        record?.isinactive ??
        record?.inactive
    );

    if (!externalId || !email || !resolvedFullName) return null;

    return {
        externalId,
        firstName: firstName || resolvedFullName,
        lastName,
        fullName: resolvedFullName,
        email,
        isInactive,
    };
}

async function getNextNegativeConsultantId(): Promise<number> {
    const existing = await prisma.consultant.findFirst({
        orderBy: {
            id: "asc",
        },
        select: {
            id: true,
        },
    });

    if (!existing || Number(existing.id) >= 0) return -1;
    return Number(existing.id) - 1;
}

export async function fetchNetSuiteConsultants(input?: {
    department?: number;
    supervisor?: number;
}): Promise<{
    ok: boolean;
    status: number;
    sourcePath: string;
    consultants: NetSuiteConsultantRecord[];
    skippedInactive: number;
    skippedInvalid: number;
    missing?: string[];
    message?: string;
}> {
    const fetched = await fetchAllNetSuiteEmployees(input);

    if (!fetched.ok) {
        return {
            ok: false,
            status: fetched.status,
            sourcePath: fetched.sourcePath,
            consultants: [],
            skippedInactive: 0,
            skippedInvalid: 0,
            missing: fetched.missing,
            message: fetched.message,
        };
    }

    const consultantsByExternalId = new Map<string, NetSuiteConsultantRecord>();
    let skippedInactive = 0;
    let skippedInvalid = 0;

    fetched.employees.forEach((employee) => {
        const consultant = normalizeNetSuiteConsultant(employee);
        if (!consultant) {
            skippedInvalid += 1;
            return;
        }
        if (consultant.isInactive) {
            skippedInactive += 1;
            return;
        }
        consultantsByExternalId.set(consultant.externalId, consultant);
    });

    return {
        ok: true,
        status: 200,
        sourcePath: fetched.sourcePath,
        consultants: Array.from(consultantsByExternalId.values()).sort((a, b) => a.fullName.localeCompare(b.fullName)),
        skippedInactive,
        skippedInvalid,
    };
}

export async function syncNetSuiteConsultants(options?: {
    dryRun?: boolean;
    department?: number;
    supervisor?: number;
}): Promise<NetSuiteConsultantSyncResult> {
    const dryRun = Boolean(options?.dryRun);
    const fetched = await fetchNetSuiteConsultants({
        department: options?.department,
        supervisor: options?.supervisor,
    });

    if (!fetched.ok) {
        return {
            ok: false,
            status: fetched.status,
            sourcePath: fetched.sourcePath,
            fetched: 0,
            created: 0,
            updated: 0,
            skippedInactive: fetched.skippedInactive,
            skippedInvalid: fetched.skippedInvalid,
            dryRun,
            missing: fetched.missing,
            message: fetched.message,
        };
    }

    const consultants = fetched.consultants;
    const externalIds = consultants.map((consultant) => consultant.externalId);
    const emails = consultants.map((consultant) => consultant.email);

    const existingByExternal = new Map<string, { id: number }>();
    const existingByEmail = new Map<string, { id: number; source: string; externalId: string | null }>();

    if (externalIds.length > 0) {
        const matches = await prisma.consultant.findMany({
            where: {
                source: "netsuite",
                externalId: {
                    in: externalIds,
                },
            },
            select: {
                id: true,
                externalId: true,
            },
        });
        matches.forEach((row) => {
            if (row.externalId) {
                existingByExternal.set(String(row.externalId), { id: Number(row.id) });
            }
        });
    }

    if (emails.length > 0) {
        const matches = await prisma.consultant.findMany({
            where: {
                email: {
                    in: emails,
                },
            },
            select: {
                id: true,
                email: true,
                source: true,
                externalId: true,
            },
        });
        matches.forEach((row) => {
            existingByEmail.set(normalizeLowercaseEmail(row.email), {
                id: Number(row.id),
                source: String(row.source ?? "manual"),
                externalId: row.externalId ? String(row.externalId) : null,
            });
        });
    }

    let created = 0;
    let updated = 0;
    let nextNegativeId = await getNextNegativeConsultantId();

    for (const consultant of consultants) {
        const existingExternal = existingByExternal.get(consultant.externalId);
        const existingEmail = existingByEmail.get(consultant.email);
        const targetId = existingExternal?.id ?? existingEmail?.id ?? null;
        const data = {
            firstName: consultant.firstName,
            lastName: consultant.lastName,
            email: consultant.email,
            source: "netsuite",
            externalId: consultant.externalId,
        };

        if (targetId !== null) {
            updated += 1;
            if (!dryRun) {
                await prisma.consultant.update({
                    where: { id: targetId },
                    data,
                });
            }
            existingByExternal.set(consultant.externalId, { id: targetId });
            existingByEmail.set(consultant.email, {
                id: targetId,
                source: "netsuite",
                externalId: consultant.externalId,
            });
            continue;
        }

        created += 1;
        const createdId = nextNegativeId;
        nextNegativeId -= 1;

        if (!dryRun) {
            await prisma.consultant.create({
                data: {
                    id: createdId,
                    ...data,
                },
            });
        }

        existingByExternal.set(consultant.externalId, { id: createdId });
        existingByEmail.set(consultant.email, {
            id: createdId,
            source: "netsuite",
            externalId: consultant.externalId,
        });
    }

    return {
        ok: true,
        status: 200,
        sourcePath: fetched.sourcePath,
        fetched: consultants.length,
        created,
        updated,
        skippedInactive: fetched.skippedInactive,
        skippedInvalid: fetched.skippedInvalid,
        dryRun,
        consultants: dryRun ? consultants : undefined,
    };
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

    const discovery = await netSuiteRestletRequest<NetSuiteEmployeeRecord[]>(config, {
        path: buildDiscoveryRestletPath(config, {
            action: "listEmployees",
            limit: 1,
            offset: 0,
        }),
        method: "GET",
    });

    const timeEntries = await netSuiteRestletRequest<NetSuiteSearchTimeEntriesResponse>(config, {
        path: buildTimeEntryRestletPath(config, {
            action: "searchTimeEntries",
            dateFrom: "2100-01-01",
            dateTo: "2100-01-01",
            limit: 1,
            offset: 0,
        }),
        method: "GET",
    });

    const ok = discovery.ok && timeEntries.ok;
    const status = ok ? 200 : Math.max(discovery.status, timeEntries.status);

    return {
        ok,
        status,
        baseUrl: config.baseUrl,
        restletPath: config.restletPath,
        deploymentStatusNote: "NetSuite RESTlet deployments are documented as TESTING and must be switched to RELEASED before production traffic.",
        discovery: {
            ok: discovery.ok,
            status: discovery.status,
            scriptId: config.discoveryScriptId,
            deployId: config.discoveryDeployId,
            endpoint: discovery.endpoint,
            code: discovery.code,
            error: discovery.error || discovery.message,
            governanceRemaining: discovery.governanceRemaining,
        },
        timeEntries: {
            ok: timeEntries.ok,
            status: timeEntries.status,
            scriptId: config.timeEntryScriptId,
            deployId: config.timeEntryDeployId,
            endpoint: timeEntries.endpoint,
            code: timeEntries.code,
            error: timeEntries.error || timeEntries.message,
            governanceRemaining: timeEntries.governanceRemaining,
        },
    };
}
