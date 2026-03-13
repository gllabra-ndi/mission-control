"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export interface CapacityGridResource {
    id: string;
    name: string;
    orderIndex: number;
    consultantId?: number | null;
}

export interface CapacityGridAllocation {
    wt: number;
    wPlus: number;
    wtSource?: "manual" | "clickup";
    wPlusSource?: "manual" | "clickup";
}

export interface CapacityGridRow {
    id: string;
    team: number;
    teamSa: string;
    dealType: string;
    wkMin: number;
    wkMax: number;
    client: string;
    notes: string;
    allocations: Record<string, CapacityGridAllocation>;
}

export interface CapacityGridPayload {
    resources: CapacityGridResource[];
    rows: CapacityGridRow[];
}

export interface CapacityGridWeekRecord {
    week: string;
    payload: CapacityGridPayload;
}

export interface CapacityGridConsultant {
    id: number;
    name: string;
}

const DEFAULT_CAPACITY_GRID_RESOURCES: CapacityGridResource[] = [
    { id: "omair-javaid", name: "Omair Javaid", orderIndex: 0, consultantId: null },
    { id: "james-w", name: "James W.", orderIndex: 1, consultantId: null },
    { id: "monica", name: "Monica", orderIndex: 2, consultantId: null },
    { id: "greg", name: "Greg", orderIndex: 3, consultantId: null },
    { id: "nikko", name: "Nikko", orderIndex: 4, consultantId: null },
];

function slugify(value: string) {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function normalizeName(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeFirstToken(value: string) {
    const first = String(value || "").trim().split(/\s+/)[0] || "";
    return normalizeName(first);
}

function resourceIdFromName(name: string) {
    const id = slugify(name);
    return id.length > 0 ? id : `resource-${Date.now()}`;
}

function buildResourcesFromConsultants(consultants?: CapacityGridConsultant[] | string[]): CapacityGridResource[] {
    if (!Array.isArray(consultants) || consultants.length === 0) return DEFAULT_CAPACITY_GRID_RESOURCES;

    const normalized = consultants
        .map((entry) => {
            if (typeof entry === "string") {
                const name = String(entry || "").trim();
                if (!name) return null;
                return { id: null, name };
            }
            const consultantId = Number(entry?.id ?? 0);
            const name = String(entry?.name ?? "").trim();
            if (!name) return null;
            return {
                id: Number.isFinite(consultantId) && consultantId > 0 ? consultantId : null,
                name,
            };
        })
        .filter(Boolean) as Array<{ id: number | null; name: string }>;

    if (normalized.length === 0) return DEFAULT_CAPACITY_GRID_RESOURCES;

    const unique = new Map<string, { id: number | null; name: string }>();
    normalized.forEach((entry) => {
        const key = entry.id ? `id:${entry.id}` : `name:${normalizeName(entry.name)}`;
        if (!key) return;
        const existing = unique.get(key);
        if (!existing || entry.name.length > existing.name.length) {
            unique.set(key, entry);
        }
    });

    return Array.from(unique.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry, idx) => ({
            id: entry.id ? `consultant-${entry.id}` : resourceIdFromName(entry.name),
            name: entry.name,
            orderIndex: idx,
            consultantId: entry.id,
        }));
}

function buildEmptyAllocations(resources: CapacityGridResource[]): Record<string, CapacityGridAllocation> {
    const allocations: Record<string, CapacityGridAllocation> = {};
    resources.forEach((resource) => {
        allocations[resource.id] = { wt: 0, wPlus: 0, wtSource: "manual", wPlusSource: "manual" };
    });
    return allocations;
}

function sanitizeCapacityPayload(input: any, forcedResources?: CapacityGridResource[]): CapacityGridPayload {
    const resources: CapacityGridResource[] = forcedResources && forcedResources.length > 0
        ? forcedResources
        : Array.isArray(input?.resources)
        ? input.resources.map((r: any, idx: number) => ({
            id: String(r?.id ?? `resource-${idx + 1}`),
            name: String(r?.name ?? `Resource ${idx + 1}`),
            orderIndex: Number(r?.orderIndex ?? idx),
            consultantId: Number.isFinite(Number(r?.consultantId))
                ? Number(r.consultantId)
                : null,
        }))
        : DEFAULT_CAPACITY_GRID_RESOURCES;

    const rows: CapacityGridRow[] = Array.isArray(input?.rows)
        ? input.rows.map((row: any, idx: number) => {
            const allocations = buildEmptyAllocations(resources);
            const incoming = row?.allocations ?? {};
            resources.forEach((resource) => {
                const cell = incoming[resource.id];
                if (cell) {
                    allocations[resource.id] = {
                        wt: Number(cell.wt ?? 0),
                        wPlus: Number(cell.wPlus ?? 0),
                        wtSource: cell.wtSource === "clickup" ? "clickup" : "manual",
                        wPlusSource: cell.wPlusSource === "clickup" ? "clickup" : "manual",
                    };
                }
            });
            return {
                id: String(row?.id ?? `row-${idx + 1}`),
                team: Number(row?.team ?? 0),
                teamSa: String(row?.teamSa ?? ""),
                dealType: String(row?.dealType ?? ""),
                wkMin: Number(row?.wkMin ?? 0),
                wkMax: Number(row?.wkMax ?? 0),
                client: String(row?.client ?? `Client ${idx + 1}`),
                notes: String(row?.notes ?? ""),
                allocations,
            };
        })
        : [];

    return { resources, rows };
}

function remapCapacityPayloadToResources(payload: CapacityGridPayload, targetResources: CapacityGridResource[]): CapacityGridPayload {
    const existingById = new Map(payload.resources.map((r) => [r.id, r]));
    const existingByConsultantId = new Map(
        payload.resources
            .filter((r) => Number.isFinite(Number(r.consultantId)) && Number(r.consultantId) > 0)
            .map((r) => [Number(r.consultantId), r])
    );
    const existingByNorm = new Map(payload.resources.map((r) => [normalizeName(r.name), r]));
    const existingByFirstToken = new Map(payload.resources.map((r) => [normalizeFirstToken(r.name), r]));

    const rows = payload.rows.map((row) => {
        const nextAllocations = buildEmptyAllocations(targetResources);
        targetResources.forEach((target) => {
            const direct = row.allocations[target.id];
            if (direct) {
                nextAllocations[target.id] = {
                    wt: Number(direct.wt ?? 0),
                    wPlus: Number(direct.wPlus ?? 0),
                };
                return;
            }
            if (Number(target.consultantId) > 0) {
                const matchByConsultantId = existingByConsultantId.get(Number(target.consultantId));
                if (matchByConsultantId && row.allocations[matchByConsultantId.id]) {
                    const cell = row.allocations[matchByConsultantId.id];
                    nextAllocations[target.id] = {
                        wt: Number(cell.wt ?? 0),
                        wPlus: Number(cell.wPlus ?? 0),
                        wtSource: cell.wtSource === "clickup" ? "clickup" : "manual",
                        wPlusSource: cell.wPlusSource === "clickup" ? "clickup" : "manual",
                    };
                    return;
                }
            }
            const matchByNorm = existingByNorm.get(normalizeName(target.name));
            if (matchByNorm && row.allocations[matchByNorm.id]) {
                const cell = row.allocations[matchByNorm.id];
                    nextAllocations[target.id] = {
                        wt: Number(cell.wt ?? 0),
                        wPlus: Number(cell.wPlus ?? 0),
                        wtSource: cell.wtSource === "clickup" ? "clickup" : "manual",
                        wPlusSource: cell.wPlusSource === "clickup" ? "clickup" : "manual",
                    };
                    return;
                }
            const matchByFirstToken = existingByFirstToken.get(normalizeFirstToken(target.name));
            if (matchByFirstToken && row.allocations[matchByFirstToken.id]) {
                const cell = row.allocations[matchByFirstToken.id];
                    nextAllocations[target.id] = {
                        wt: Number(cell.wt ?? 0),
                        wPlus: Number(cell.wPlus ?? 0),
                        wtSource: cell.wtSource === "clickup" ? "clickup" : "manual",
                        wPlusSource: cell.wPlusSource === "clickup" ? "clickup" : "manual",
                    };
                    return;
                }
            const matchById = existingById.get(target.id);
            if (matchById && row.allocations[matchById.id]) {
                const cell = row.allocations[matchById.id];
                nextAllocations[target.id] = {
                    wt: Number(cell.wt ?? 0),
                    wPlus: Number(cell.wPlus ?? 0),
                    wtSource: cell.wtSource === "clickup" ? "clickup" : "manual",
                    wPlusSource: cell.wPlusSource === "clickup" ? "clickup" : "manual",
                };
            }
        });

        return {
            ...row,
            allocations: nextAllocations,
        };
    });

    return {
        resources: targetResources,
        rows,
    };
}

async function applyInitialWkMaxFromTarget(week: string, payload: CapacityGridPayload): Promise<{ payload: CapacityGridPayload; changed: boolean }> {
    const clientConfigs = await prisma.clientConfig.findMany({
        where: { week },
    });

    const targetById = new Map<string, number>();
    const targetByName = new Map<string, number>();
    clientConfigs.forEach((cfg) => {
        const target = Number(cfg.target ?? 0);
        if (target <= 0) return;
        const idKey = normalizeName(String(cfg.clientId ?? ""));
        const nameKey = normalizeName(String(cfg.clientName ?? ""));
        if (idKey) targetById.set(idKey, target);
        if (nameKey) targetByName.set(nameKey, target);
    });

    let changed = false;
    const nextRows = payload.rows.map((row) => {
        const idKey = normalizeName(String(row.id ?? ""));
        const nameKey = normalizeName(String(row.client ?? ""));
        const hasMatch = targetById.has(idKey) || targetByName.has(nameKey);
        if (!hasMatch) return row;

        const target = Number(targetById.get(idKey) ?? targetByName.get(nameKey) ?? 0);
        const currentMax = Number(row.wkMax ?? 0);
        if (Math.abs(currentMax - target) < 0.01) return row;

        changed = true;
        return {
            ...row,
            wkMax: target,
        };
    });

    return {
        payload: changed ? { ...payload, rows: nextRows } : payload,
        changed,
    };
}

async function applyInitialTeamFromClientConfig(week: string, payload: CapacityGridPayload): Promise<{ payload: CapacityGridPayload; changed: boolean }> {
    const anyTeamSet = payload.rows.some((row) => Number(row.team ?? 0) > 0);
    if (anyTeamSet) return { payload, changed: false };

    const clientConfigs = await prisma.clientConfig.findMany({
        where: { week },
    });

    const teamById = new Map<string, number>();
    const teamByName = new Map<string, number>();
    clientConfigs.forEach((cfg) => {
        const team = Number(cfg.team ?? 0);
        if (!Number.isFinite(team) || team <= 0) return;
        const idKey = normalizeName(String(cfg.clientId ?? ""));
        const nameKey = normalizeName(String(cfg.clientName ?? ""));
        if (idKey) teamById.set(idKey, team);
        if (nameKey) teamByName.set(nameKey, team);
    });

    let changed = false;
    const nextRows = payload.rows.map((row) => {
        const idKey = normalizeName(String(row.id ?? ""));
        const nameKey = normalizeName(String(row.client ?? ""));
        const team = Number(teamById.get(idKey) ?? teamByName.get(nameKey) ?? 0);
        if (!team || team <= 0) return row;
        changed = true;
        return {
            ...row,
            team,
        };
    });

    return {
        payload: changed ? { ...payload, rows: nextRows } : payload,
        changed,
    };
}

async function buildSeedCapacityGrid(week: string, consultants?: CapacityGridConsultant[] | string[]): Promise<CapacityGridPayload> {
    const resources = buildResourcesFromConsultants(consultants);
    let sourceConfigs = await prisma.clientConfig.findMany({
        where: { week },
        orderBy: { orderIndex: "asc" },
    });
    if (sourceConfigs.length === 0) {
        sourceConfigs = await prisma.clientConfig.findMany({
            where: { week: "2026-03-02" },
            orderBy: { orderIndex: "asc" },
        });
    }

    const rows: CapacityGridRow[] = sourceConfigs.map((cc, idx) => ({
        id: cc.clientId || `seed-${idx + 1}`,
        team: Number(cc.team ?? 0),
        teamSa: String(cc.sa ?? ""),
        dealType: String(cc.dealType ?? ""),
        wkMin: Number(cc.min ?? 0),
        // Seed wkMax from Command Center week target as requested.
        wkMax: Number(cc.target ?? 0),
        client: String(cc.clientName ?? cc.clientId ?? `Client ${idx + 1}`),
        notes: "",
        allocations: buildEmptyAllocations(resources),
    }));

    if (rows.length > 0) return { resources, rows };

    const fallbackClients = [
        "Mikisew",
        "Sparetek",
        "ARKTikka",
        "Santec | Canada",
        "FPM",
        "Global Light",
        "SodaStream",
        "TIN (That's It Fruit)",
        "LSCU",
        "Global Gourmet",
        "Dye & Durham",
        "A2A",
        "Brainspire Office Furniture",
        "HPSA",
        "SIGA",
        "Pellucere",
        "BizRoR",
        "Centium/Tonix",
        "Centium/A3B",
        "Centium/C3CW",
        "Happy Feet",
    ];
    return {
        resources,
        rows: fallbackClients.map((name, idx) => ({
            id: slugify(name) || `client-${idx + 1}`,
            team: 0,
            teamSa: "",
            dealType: "",
            wkMin: 0,
            wkMax: 0,
            client: name,
            notes: "",
            allocations: buildEmptyAllocations(resources),
        })),
    };
}

export async function getWeekConfig(week: string) {
    return await prisma.weekConfig.findUnique({
        where: { week }
    });
}

export async function getWeekConfigsForYear(year: number) {
    const prefix = `${year}-`;
    return await prisma.weekConfig.findMany({
        where: {
            week: {
                startsWith: prefix
            }
        }
    });
}

export async function updateWeekConfig(week: string, baseTarget: number, stretchTarget: number) {
    await prisma.weekConfig.upsert({
        where: { week },
        update: { baseTarget, stretchTarget },
        create: { week, baseTarget, stretchTarget }
    });
    revalidatePath("/");
}

export async function getLeadConfigs(week: string) {
    return await prisma.leadConfig.findMany({
        where: { week }
    });
}

export async function updateLeadConfig(week: string, leadName: string, target: number) {
    await prisma.leadConfig.upsert({
        where: { week_leadName: { week, leadName } },
        update: { target },
        create: { week, leadName, target }
    });
    revalidatePath("/");
}

export async function getClientConfigs(week: string) {
    return await prisma.clientConfig.findMany({
        where: { week }
    });
}

export async function updateClientConfig(week: string, clientId: string, data: { clientName?: string, orderIndex?: number, team?: number, sa?: string, dealType?: string, min?: number, max?: number, target?: number, mtHrs?: number, wPlusHrs?: number }) {
    await prisma.clientConfig.upsert({
        where: { week_clientId: { week, clientId } },
        update: data,
        create: {
            week,
            clientId,
            clientName: data.clientName ?? "",
            orderIndex: data.orderIndex ?? 0,
            team: data.team ?? 0,
            sa: data.sa ?? "",
            dealType: data.dealType ?? "",
            min: data.min ?? 0,
            target: data.target ?? 0,
            max: data.max ?? 0,
            mtHrs: data.mtHrs ?? 0,
            wPlusHrs: data.wPlusHrs ?? 0,
        }
    });
    revalidatePath("/");
}

export async function getConsultantConfigs(week: string) {
    return await prisma.consultantConfig.findMany({
        where: { week }
    });
}

export async function getConsultantConfigsForYear(year: number) {
    const prefix = `${year}-`;
    return await prisma.consultantConfig.findMany({
        where: {
            week: {
                startsWith: prefix
            }
        }
    });
}

export async function updateConsultantConfig(week: string, consultantId: number, data: { maxCapacity?: number, billableCapacity?: number, mtHrs?: number, wPlusHrs?: number, notes?: string }) {
    await prisma.consultantConfig.upsert({
        where: { week_consultantId: { week, consultantId } },
        update: data,
        create: {
            week,
            consultantId,
            maxCapacity: data.maxCapacity ?? 40,
            billableCapacity: data.billableCapacity ?? 40,
            mtHrs: data.mtHrs ?? 0,
            wPlusHrs: data.wPlusHrs ?? 0,
            notes: data.notes ?? ""
        }
    });
    revalidatePath("/");
}

export async function getCapacityGridConfig(
    week: string,
    consultants?: CapacityGridConsultant[] | string[]
): Promise<CapacityGridPayload> {
    const rosterResources = buildResourcesFromConsultants(consultants);
    const capacityGridModel = (prisma as any).capacityGridConfig;
    if (!capacityGridModel) {
        return buildSeedCapacityGrid(week, consultants);
    }

    const existing = await capacityGridModel.findUnique({
        where: { week },
    });

    if (!existing) {
        const seed = await buildSeedCapacityGrid(week, consultants);
        await capacityGridModel.create({
            data: {
                week,
                resourcesJson: JSON.stringify(seed.resources),
                rowsJson: JSON.stringify(seed.rows),
            },
        });
        return seed;
    }

    try {
        const parsed = sanitizeCapacityPayload({
            resources: JSON.parse(existing.resourcesJson || "[]"),
            rows: JSON.parse(existing.rowsJson || "[]"),
        });
        const aligned = consultants && consultants.length > 0
            ? remapCapacityPayloadToResources(parsed, rosterResources)
            : parsed;
        const wkMaxApplied = await applyInitialWkMaxFromTarget(week, aligned);
        const teamApplied = await applyInitialTeamFromClientConfig(week, wkMaxApplied.payload);

        const hasResourceDiff =
            JSON.stringify(teamApplied.payload.resources) !== JSON.stringify(parsed.resources) ||
            JSON.stringify(teamApplied.payload.rows.map((r) => Object.keys(r.allocations).sort())) !== JSON.stringify(parsed.rows.map((r) => Object.keys(r.allocations).sort()));

        if (hasResourceDiff || wkMaxApplied.changed || teamApplied.changed) {
            await capacityGridModel.update({
                where: { week },
                data: {
                    resourcesJson: JSON.stringify(teamApplied.payload.resources),
                    rowsJson: JSON.stringify(teamApplied.payload.rows),
                },
            });
        }

        return teamApplied.payload;
    } catch {
        const seed = await buildSeedCapacityGrid(week, consultants);
        await capacityGridModel.update({
            where: { week },
            data: {
                resourcesJson: JSON.stringify(seed.resources),
                rowsJson: JSON.stringify(seed.rows),
            },
        });
        return seed;
    }
}

export async function getCapacityGridConfigsForYear(year: number): Promise<CapacityGridWeekRecord[]> {
    const prefix = `${year}-`;
    const capacityGridModel = (prisma as any).capacityGridConfig;
    if (!capacityGridModel) return [];

    const rows = await capacityGridModel.findMany({
        where: {
            week: {
                startsWith: prefix
            }
        },
        orderBy: {
            week: "asc"
        }
    });

    return rows.map((row: any) => {
        try {
            return {
                week: String(row.week),
                payload: sanitizeCapacityPayload({
                    resources: JSON.parse(String(row.resourcesJson || "[]")),
                    rows: JSON.parse(String(row.rowsJson || "[]")),
                }),
            };
        } catch {
            return {
                week: String(row.week),
                payload: { resources: [], rows: [] },
            };
        }
    });
}

export async function updateCapacityGridConfig(week: string, payload: CapacityGridPayload) {
    const sanitized = sanitizeCapacityPayload(payload);
    const capacityGridModel = (prisma as any).capacityGridConfig;
    if (!capacityGridModel) return;

    await capacityGridModel.upsert({
        where: { week },
        update: {
            resourcesJson: JSON.stringify(sanitized.resources),
            rowsJson: JSON.stringify(sanitized.rows),
        },
        create: {
            week,
            resourcesJson: JSON.stringify(sanitized.resources),
            rowsJson: JSON.stringify(sanitized.rows),
        },
    });
    revalidatePath("/");
}
