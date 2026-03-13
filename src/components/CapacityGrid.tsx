"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import {
    CapacityGridPayload,
    CapacityGridResource,
    CapacityGridRow,
    updateCapacityGridConfig
} from "@/app/actions";
import { ChevronLeft, ChevronRight, Grid2x2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ClickUpTask } from "@/lib/clickup";

interface CapacityGridProps {
    activeWeekStr: string;
    initialGrid: CapacityGridPayload;
    onGridChange?: (nextGrid: CapacityGridPayload) => void;
    consultants?: Array<{ id: number; name: string }>;
    consultantConfigsById?: Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>;
    tasks?: ClickUpTask[];
}

function toNumber(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function getEffectiveHours(wt: number, wPlus: number): number {
    return Math.abs(wPlus) > 0.0001 ? wPlus : wt;
}

function normalizeName(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function CapacityGrid({
    activeWeekStr,
    initialGrid,
    onGridChange,
    consultants = [],
    consultantConfigsById = {},
    tasks = [],
}: CapacityGridProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [isMatchChecking, startMatchChecking] = useTransition();
    const [isWeekNavLocked, setIsWeekNavLocked] = useState(false);

    const [resources, setResources] = useState<CapacityGridResource[]>(initialGrid?.resources ?? []);
    const [rows, setRows] = useState<CapacityGridRow[]>(initialGrid?.rows ?? []);
    const [consultantConfigs, setConsultantConfigs] = useState<Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>>(consultantConfigsById);
    const [hasMatchCheckRun, setHasMatchCheckRun] = useState(false);
    const initializedWeekRef = useRef<string>("");
    const autoFillRunKeyRef = useRef<string>("");
    const navUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // Prevent render loops: only rehydrate local grid state when week changes.
        if (initializedWeekRef.current === activeWeekStr) return;
        initializedWeekRef.current = activeWeekStr;
        setResources(initialGrid?.resources ?? []);
        setRows(initialGrid?.rows ?? []);
        setHasMatchCheckRun(false);
    }, [activeWeekStr, initialGrid?.resources, initialGrid?.rows]);

    useEffect(() => {
        setConsultantConfigs(consultantConfigsById);
    }, [activeWeekStr, consultantConfigsById]);

    const activeWeekDate = useMemo(() => new Date(activeWeekStr + "T00:00:00"), [activeWeekStr]);
    const weekParamFor = (nextDate: Date) => `/?week=${format(nextDate, "yyyy-MM-dd")}&tab=capacity-grid`;

    useEffect(() => {
        setIsWeekNavLocked(false);
        if (navUnlockTimerRef.current) {
            clearTimeout(navUnlockTimerRef.current);
            navUnlockTimerRef.current = null;
        }
    }, [activeWeekStr]);

    useEffect(() => {
        return () => {
            if (navUnlockTimerRef.current) {
                clearTimeout(navUnlockTimerRef.current);
            }
        };
    }, []);

    const navigateToWeek = useCallback((nextDate: Date | null) => {
        if (isWeekNavLocked) return;
        const currentWeekStr = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
        if (nextDate === null && activeWeekStr === currentWeekStr) return;
        if (nextDate && format(nextDate, "yyyy-MM-dd") === activeWeekStr) return;

        const href = nextDate ? weekParamFor(nextDate) : "/?tab=capacity-grid";
        setIsWeekNavLocked(true);
        router.push(href);
        navUnlockTimerRef.current = setTimeout(() => {
            setIsWeekNavLocked(false);
            navUnlockTimerRef.current = null;
        }, 500);
    }, [activeWeekStr, isWeekNavLocked, router]);

    const handlePrevWeek = () => {
        navigateToWeek(subWeeks(activeWeekDate, 1));
    };
    const handleNextWeek = () => {
        navigateToWeek(addWeeks(activeWeekDate, 1));
    };
    const handleCurrentWeek = () => {
        navigateToWeek(null);
    };

    useEffect(() => {
        const previousWeekHref = weekParamFor(subWeeks(activeWeekDate, 1));
        const nextWeekHref = weekParamFor(addWeeks(activeWeekDate, 1));
        router.prefetch(previousWeekHref);
        router.prefetch(nextWeekHref);
        router.prefetch("/?tab=capacity-grid");
    }, [router, activeWeekDate, activeWeekStr]);

    const persist = useCallback((nextRows: CapacityGridRow[], nextResources: CapacityGridResource[] = resources) => {
        const nextPayload: CapacityGridPayload = {
            resources: nextResources,
            rows: nextRows,
        };
        onGridChange?.(nextPayload);
        startTransition(() => {
            updateCapacityGridConfig(activeWeekStr, {
                resources: nextPayload.resources,
                rows: nextPayload.rows,
            });
        });
    }, [activeWeekStr, onGridChange, resources, startTransition]);

    const updateRow = (rowId: string, patch: Partial<CapacityGridRow>) => {
        setRows((prev) => {
            const nextRows = prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row));
            onGridChange?.({ resources, rows: nextRows });
            return nextRows;
        });
    };

    const updateAllocation = (
        rowId: string,
        resourceId: string,
        field: "wt" | "wPlus",
        value: number
    ) => {
        setRows((prev) =>
            {
            const nextRows = prev.map((row) => {
                if (row.id !== rowId) return row;
                return {
                    ...row,
                    allocations: {
                        ...row.allocations,
                        [resourceId]: {
                            wt: Number(row.allocations[resourceId]?.wt ?? 0),
                            wPlus: Number(row.allocations[resourceId]?.wPlus ?? 0),
                            wtSource: row.allocations[resourceId]?.wtSource === "clickup" ? "clickup" : "manual",
                            wPlusSource: row.allocations[resourceId]?.wPlusSource === "clickup" ? "clickup" : "manual",
                            [field]: value,
                            [field === "wt" ? "wtSource" : "wPlusSource"]: "manual",
                        },
                    },
                };
            });
            onGridChange?.({ resources, rows: nextRows });
            return nextRows;
            }
        );
    };

    const rowStats = useMemo(() => {
        return rows.map((row) => {
            const wt = resources.reduce((sum, resource) => sum + Number(row.allocations[resource.id]?.wt ?? 0), 0);
            const wPlus = resources.reduce((sum, resource) => sum + Number(row.allocations[resource.id]?.wPlus ?? 0), 0);
            const total = resources.reduce((sum, resource) => {
                const cellWt = Number(row.allocations[resource.id]?.wt ?? 0);
                const cellWPlus = Number(row.allocations[resource.id]?.wPlus ?? 0);
                return sum + getEffectiveHours(cellWt, cellWPlus);
            }, 0);
            return {
                id: row.id,
                wt,
                wPlus,
                total,
                gapToMin: total - Number(row.wkMin || 0),
                gapToMax: Number(row.wkMax || 0) - total,
            };
        });
    }, [rows, resources]);

    const totals = useMemo(() => {
        const wtByResource: Record<string, number> = {};
        const wPlusByResource: Record<string, number> = {};
        const effectiveByResource: Record<string, number> = {};
        resources.forEach((resource) => {
            wtByResource[resource.id] = rows.reduce((sum, row) => sum + Number(row.allocations[resource.id]?.wt ?? 0), 0);
            wPlusByResource[resource.id] = rows.reduce((sum, row) => sum + Number(row.allocations[resource.id]?.wPlus ?? 0), 0);
            effectiveByResource[resource.id] = rows.reduce((sum, row) => {
                const wt = Number(row.allocations[resource.id]?.wt ?? 0);
                const wPlus = Number(row.allocations[resource.id]?.wPlus ?? 0);
                return sum + getEffectiveHours(wt, wPlus);
            }, 0);
        });

        const wkMinTotal = rows.reduce((sum, row) => sum + Number(row.wkMin || 0), 0);
        const wkMaxTotal = rows.reduce((sum, row) => sum + Number(row.wkMax || 0), 0);
        const totalWt = Object.values(wtByResource).reduce((a, b) => a + b, 0);
        const totalWPlus = Object.values(wPlusByResource).reduce((a, b) => a + b, 0);
        const totalForecast = Object.values(effectiveByResource).reduce((a, b) => a + b, 0);

        return {
            wtByResource,
            wPlusByResource,
            effectiveByResource,
            wkMinTotal,
            wkMaxTotal,
            totalWt,
            totalWPlus,
            totalForecast,
            gapToMin: totalForecast - wkMinTotal,
            gapToMax: wkMaxTotal - totalForecast,
        };
    }, [rows, resources]);

    const billableCapacityByResource = useMemo(() => {
        const billableByName = new Map<string, number>();
        consultants.forEach((consultant) => {
            const cfg = consultantConfigs[consultant.id] || { billableCapacity: 40 };
            const billable = Number(cfg.billableCapacity ?? 40);
            const full = normalizeName(consultant.name);
            const first = normalizeName(String(consultant.name || "").split(/\s+/)[0] || "");
            if (full) billableByName.set(full, billable);
            if (first && !billableByName.has(first)) billableByName.set(first, billable);
        });

        const map: Record<string, number> = {};
        resources.forEach((resource) => {
            const consultantId = Number(resource.consultantId ?? 0);
            if (consultantId > 0) {
                const cfg = consultantConfigs[consultantId] || { billableCapacity: 40 };
                map[resource.id] = Number(cfg.billableCapacity ?? 40);
                return;
            }
            const fullKey = normalizeName(resource.name);
            const firstKey = normalizeName(String(resource.name || "").split(/\s+/)[0] || "");
            const fallback = billableByName.get(fullKey) ?? billableByName.get(firstKey) ?? 0;
            map[resource.id] = Number(fallback);
        });
        return map;
    }, [resources, consultants, consultantConfigs]);

    const getConsultantHeaderClass = (resourceId: string) => {
        const cap = Number(billableCapacityByResource[resourceId] ?? 0);
        const allocated = Number(totals.effectiveByResource[resourceId] ?? 0);
        if (cap <= 0) return "text-text-main";
        if (Math.abs(allocated - cap) < 0.01) return "text-emerald-400";
        if (allocated > cap) return "text-red-400";
        return "text-amber-300";
    };

    const getClientStatusClass = (total: number, wkMin: number, wkMax: number) => {
        if (total < wkMin) return "text-amber-300";
        if (wkMax > 0 && total > wkMax) return "text-red-400";
        if (total >= wkMin && (wkMax <= 0 || total <= wkMax)) return "text-emerald-400";
        return "text-text-main";
    };

    const clickupHoursByPair = useMemo(() => {
        const exactMap = new Map<string, { wt: number; wPlus: number }>();
        const byConsultantListName = new Map<string, Map<string, { wt: number; wPlus: number }>>();

        const add = (consultantKey: string, clientKey: string, field: "wt" | "wPlus", hours: number) => {
            if (!consultantKey || !clientKey || hours <= 0) return;
            const key = `${consultantKey}|${clientKey}`;
            const current = exactMap.get(key) || { wt: 0, wPlus: 0 };
            current[field] += hours;
            exactMap.set(key, current);
        };

        const addListName = (consultantKey: string, listNameKey: string, field: "wt" | "wPlus", hours: number) => {
            if (!consultantKey || !listNameKey || hours <= 0) return;
            const byList = byConsultantListName.get(consultantKey) || new Map<string, { wt: number; wPlus: number }>();
            const current = byList.get(listNameKey) || { wt: 0, wPlus: 0 };
            current[field] += hours;
            byList.set(listNameKey, current);
            byConsultantListName.set(consultantKey, byList);
        };

        const weekStartMs = new Date(activeWeekStr + "T00:00:00").getTime();
        const weekEndMs = addDays(new Date(weekStartMs), 6).getTime();

        tasks.forEach((task) => {
            const estimateMs = Number(task?.time_estimate ?? 0);
            const hours = estimateMs / (1000 * 60 * 60);
            if (hours <= 0) return;

            const dateMs = Number(task?.due_date ?? task?.start_date ?? task?.date_created ?? 0);
            if (!Number.isFinite(dateMs) || dateMs < weekStartMs || dateMs > weekEndMs) return;

            const listIdKey = normalizeName(String(task?.list?.id ?? ""));
            const listNameKey = normalizeName(String(task?.list?.name ?? ""));
            const clientKeys: string[] = [];
            if (listIdKey) clientKeys.push(`id:${listIdKey}`);
            if (listNameKey) clientKeys.push(`name:${listNameKey}`);
            if (clientKeys.length === 0) return;

            const assignees = Array.isArray(task?.assignees) ? task.assignees : [];
            if (assignees.length === 0) return;

            const day = new Date(dateMs).getDay(); // Sun=0, Mon=1
            const field: "wt" | "wPlus" = day === 1 || day === 2 ? "wt" : "wPlus";

            const splitHours = hours / assignees.length;
            assignees.forEach((assignee) => {
                const consultantId = Number((assignee as any)?.id ?? 0);
                const consultantNameRaw = String((assignee as any)?.username ?? "");
                const consultantNameKey = normalizeName(consultantNameRaw);
                const consultantFirstKey = normalizeName((consultantNameRaw.split(/\s+/)[0] || ""));
                const consultantKeys: string[] = [];
                if (consultantId > 0) consultantKeys.push(`id:${consultantId}`);
                if (consultantNameKey) consultantKeys.push(`name:${consultantNameKey}`);
                if (consultantFirstKey) consultantKeys.push(`first:${consultantFirstKey}`);

                consultantKeys.forEach((consultantKey) => {
                    if (listNameKey) {
                        addListName(consultantKey, listNameKey, field, splitHours);
                    }
                    clientKeys.forEach((clientKey) => {
                        add(consultantKey, clientKey, field, splitHours);
                    });
                });
            });
        });

        return {
            exactMap,
            byConsultantListName,
        };
    }, [tasks, activeWeekStr]);

    const getClickupHoursForCell = useCallback((row: CapacityGridRow, resource: CapacityGridResource) => {
        const consultantId = Number(resource.consultantId ?? 0);
        const consultantName = String(resource.name || "");
        const consultantNameKey = normalizeName(consultantName);
        const consultantFirstKey = normalizeName((consultantName.split(/\s+/)[0] || ""));
        const consultantKeys: string[] = [];
        if (consultantId > 0) consultantKeys.push(`id:${consultantId}`);
        if (consultantNameKey) consultantKeys.push(`name:${consultantNameKey}`);
        if (consultantFirstKey) consultantKeys.push(`first:${consultantFirstKey}`);

        const rowIdKey = normalizeName(String(row.id || ""));
        const rowNameKey = normalizeName(String(row.client || ""));
        const clientKeys: string[] = [];
        if (rowIdKey) clientKeys.push(`id:${rowIdKey}`);
        if (rowNameKey) clientKeys.push(`name:${rowNameKey}`);

        for (const consultantKey of consultantKeys) {
            for (const clientKey of clientKeys) {
                const hit = clickupHoursByPair.exactMap.get(`${consultantKey}|${clientKey}`);
                if (hit) return hit;
            }
        }

        // Fallback match: if the row uses a grouped/shortened client label
        // (e.g. "SodaStream"), sum matching ClickUp list-name buckets.
        const primaryConsultantKey = consultantKeys[0];
        const rowClientNorm = rowNameKey;
        if (primaryConsultantKey && rowClientNorm) {
            const byListName = clickupHoursByPair.byConsultantListName.get(primaryConsultantKey);
            if (byListName && rowClientNorm.length >= 4) {
                let wt = 0;
                let wPlus = 0;
                let found = false;
                byListName.forEach((hours, listNameNorm) => {
                    if (
                        listNameNorm === rowClientNorm
                        || listNameNorm.includes(rowClientNorm)
                        || rowClientNorm.includes(listNameNorm)
                    ) {
                        wt += Number(hours.wt || 0);
                        wPlus += Number(hours.wPlus || 0);
                        found = true;
                    }
                });
                if (found) return { wt, wPlus };
            }
        }

        return { wt: 0, wPlus: 0 };
    }, [clickupHoursByPair]);

    const clickupSeedPlan = useMemo(() => {
        const ops: Array<{ rowId: string; resourceId: string; wt?: number; wPlus?: number }> = [];

        rows.forEach((row) => {
            resources.forEach((resource) => {
                const clickup = getClickupHoursForCell(row, resource);
                const currentWt = Number(row.allocations[resource.id]?.wt ?? 0);
                const currentWPlus = Number(row.allocations[resource.id]?.wPlus ?? 0);
                const seedWt = Number(Number(clickup.wt || 0).toFixed(1));
                const seedWPlus = Number(Number(clickup.wPlus || 0).toFixed(1));

                const op: { rowId: string; resourceId: string; wt?: number; wPlus?: number } = {
                    rowId: row.id,
                    resourceId: resource.id,
                };
                let hasOp = false;

                if (Math.abs(currentWt) < 0.0001 && seedWt > 0) {
                    op.wt = seedWt;
                    hasOp = true;
                }
                if (Math.abs(currentWPlus) < 0.0001 && seedWPlus > 0) {
                    op.wPlus = seedWPlus;
                    hasOp = true;
                }

                if (hasOp) ops.push(op);
            });
        });

        const key = `${activeWeekStr}|${ops
            .map((op) => `${op.rowId}:${op.resourceId}:${op.wt ?? ""}:${op.wPlus ?? ""}`)
            .join("|")}`;
        return { ops, key };
    }, [activeWeekStr, rows, resources, getClickupHoursForCell]);

    const runClickupMatchCheck = useCallback(() => {
        startMatchChecking(() => {
            setHasMatchCheckRun(true);
        });
    }, []);

    const liveMatchSummary = useMemo(() => {
        if (!hasMatchCheckRun) return null;
        let checked = 0;
        let matched = 0;
        rows.forEach((row) => {
            resources.forEach((resource) => {
                const clickup = getClickupHoursForCell(row, resource);
                const plannedWt = Number(row.allocations[resource.id]?.wt ?? 0);
                const plannedWPlus = Number(row.allocations[resource.id]?.wPlus ?? 0);
                const plannedEffective = getEffectiveHours(plannedWt, plannedWPlus);
                const clickupEffective = getEffectiveHours(Number(clickup.wt || 0), Number(clickup.wPlus || 0));
                const isMatch = Math.abs(plannedEffective - clickupEffective) < 0.05;
                checked += 1;
                if (isMatch) matched += 1;
            });
        });
        return { checked, matched };
    }, [hasMatchCheckRun, rows, resources, getClickupHoursForCell]);

    useEffect(() => {
        if (rows.length === 0 || resources.length === 0) return;
        if (clickupSeedPlan.ops.length === 0) return;

        const currentWeekStr = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
        if (activeWeekStr < currentWeekStr) return;
        if (autoFillRunKeyRef.current === clickupSeedPlan.key) return;

        const opMap = new Map<string, { wt?: number; wPlus?: number }>();
        clickupSeedPlan.ops.forEach((op) => {
            opMap.set(`${op.rowId}|${op.resourceId}`, { wt: op.wt, wPlus: op.wPlus });
        });

        let changed = false;
        const nextRows = rows.map((row) => {
            let rowChanged = false;
            const nextAllocations = { ...row.allocations };

            resources.forEach((resource) => {
                const op = opMap.get(`${row.id}|${resource.id}`);
                if (!op) return;

                const currentWt = Number(row.allocations[resource.id]?.wt ?? 0);
                const currentWPlus = Number(row.allocations[resource.id]?.wPlus ?? 0);
                const nextWt = op.wt ?? currentWt;
                const nextWPlus = op.wPlus ?? currentWPlus;

                if (Math.abs(nextWt - currentWt) < 0.05 && Math.abs(nextWPlus - currentWPlus) < 0.05) {
                    return;
                }

                nextAllocations[resource.id] = {
                    wt: nextWt,
                    wPlus: nextWPlus,
                    wtSource: op.wt !== undefined ? "clickup" : (row.allocations[resource.id]?.wtSource === "clickup" ? "clickup" : "manual"),
                    wPlusSource: op.wPlus !== undefined ? "clickup" : (row.allocations[resource.id]?.wPlusSource === "clickup" ? "clickup" : "manual"),
                };
                rowChanged = true;
                changed = true;
            });

            return rowChanged ? { ...row, allocations: nextAllocations } : row;
        });

        autoFillRunKeyRef.current = clickupSeedPlan.key;
        if (!changed) return;

        setRows(nextRows);
        persist(nextRows);
    }, [activeWeekStr, rows, resources, clickupSeedPlan, persist]);

    const weekLabel = `${format(activeWeekDate, "MM/dd")} to ${format(addDays(activeWeekDate, 4), "MM/dd")}`;
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const isCurrentWeek = activeWeekStr === format(currentWeekStart, "yyyy-MM-dd");
    const weekNumber = format(activeWeekDate, "II");
    const weekRangeLabel = `${format(activeWeekDate, "MMM d")} to ${format(addDays(activeWeekDate, 4), "MMM d")}`;

    return (
        <section className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                    <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Capacity Grid
                    </h2>
                    <div className="flex items-center rounded-md border border-border/70 overflow-hidden bg-surface/20">
                        <button
                            onClick={handlePrevWeek}
                            disabled={isWeekNavLocked}
                            className="h-9 w-9 flex items-center justify-center text-text-muted hover:text-white hover:bg-surface-hover transition-colors border-r border-border/70"
                            aria-label="Previous week"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="px-3 py-1.5 min-w-[190px]">
                            <div className="text-[10px] uppercase tracking-wider text-text-muted">Week W{weekNumber}</div>
                            <div className="text-xs font-semibold text-white">{weekRangeLabel}</div>
                        </div>
                        <button
                            onClick={handleNextWeek}
                            disabled={isWeekNavLocked}
                            className="h-9 w-9 flex items-center justify-center text-text-muted hover:text-white hover:bg-surface-hover transition-colors border-l border-border/70"
                            aria-label="Next week"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    <button
                        onClick={handleCurrentWeek}
                        disabled={isWeekNavLocked}
                        className={cn(
                            "h-9 px-3 rounded-md border border-border/70 text-xs font-semibold transition-colors",
                            isCurrentWeek ? "text-white bg-surface/50" : "text-text-muted hover:text-white hover:bg-surface-hover"
                        )}
                    >
                        Current Week
                    </button>
                    <span className="text-xs text-text-muted">{weekLabel}</span>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={runClickupMatchCheck}
                        disabled={isMatchChecking}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-text-main hover:bg-surface-hover disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {isMatchChecking ? "Checking..." : "ClickUp Match"}
                    </button>
                    <span className="text-[11px] text-text-muted">
                        {hasMatchCheckRun && liveMatchSummary
                            ? `${liveMatchSummary.matched}/${liveMatchSummary.checked} cells matched`
                            : "Run ClickUp Match to validate all cells"}
                    </span>
                    <span className="text-[11px] text-text-muted">{isPending ? "Saving..." : "Persistent planning scratchboard"}</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="border border-border/50 rounded-lg p-3 bg-surface/20">
                    <div className="text-[11px] uppercase text-text-muted">Top Level Forecast</div>
                    <div className="text-2xl font-bold text-white mt-1">{totals.totalForecast.toFixed(1)}</div>
                </div>
                <div className="border border-border/50 rounded-lg p-3 bg-surface/20">
                    <div className="text-[11px] uppercase text-text-muted">WK Min Total</div>
                    <div className="text-2xl font-bold text-white mt-1">{totals.wkMinTotal.toFixed(1)}</div>
                </div>
                <div className="border border-border/50 rounded-lg p-3 bg-surface/20">
                    <div className="text-[11px] uppercase text-text-muted">WK Max Total</div>
                    <div className="text-2xl font-bold text-white mt-1">{totals.wkMaxTotal.toFixed(1)}</div>
                </div>
                <div className="border border-border/50 rounded-lg p-3 bg-surface/20">
                    <div className="text-[11px] uppercase text-text-muted">Gap vs WK Min</div>
                    <div className={cn("text-2xl font-bold mt-1", totals.gapToMin >= 0 ? "text-emerald-400" : "text-red-400")}>
                        {totals.gapToMin.toFixed(1)}
                    </div>
                </div>
            </div>

            <div className="border border-border/50 rounded-xl overflow-auto bg-surface/10">
                <table className="min-w-[1800px] w-full border-collapse text-[12px]">
                    <thead>
                        <tr className="border-b-2 border-border/50 text-text-muted text-[11px] font-bold tracking-wider bg-[#1a2035]/80 text-[#94a3b8] cap-none">
                            <th rowSpan={3} className="px-3 py-2 text-right border-r border-border/40">Team</th>
                            <th rowSpan={3} className="px-3 py-2 text-left border-r border-border/40">SA</th>
                            <th rowSpan={3} className="px-3 py-2 text-left border-r border-border/40">Deal Type</th>
                            <th rowSpan={3} className="px-3 py-2 text-right border-r border-border/40">Wk Min</th>
                            <th rowSpan={3} className="px-3 py-2 text-right border-r border-border/40">Wk Max</th>
                            <th rowSpan={3} className="px-3 py-2 text-left border-r border-border/40">Client</th>
                            {resources.map((resource) => (
                                <th key={resource.id} colSpan={2} className="px-2 py-2 text-center border-r border-border/40">
                                    <span className={cn("font-semibold transition-colors", getConsultantHeaderClass(resource.id))}>
                                        {resource.name}
                                    </span>
                                </th>
                            ))}
                            <th rowSpan={3} className="px-3 py-2 text-right border-r border-border/40">WT Total</th>
                            <th rowSpan={3} className="px-3 py-2 text-right border-r border-border/40">W+ Total</th>
                            <th rowSpan={3} className="px-3 py-2 text-right border-r border-border/40">Top Level Forecast</th>
                            <th rowSpan={3} className="px-3 py-2 text-right border-r border-border/40">Gap to Min</th>
                            <th rowSpan={3} className="px-3 py-2 text-right border-r border-border/40">Gap to Max</th>
                            <th rowSpan={3} className="px-3 py-2 text-left">Notes</th>
                        </tr>
                        <tr className="text-text-muted text-[10px] bg-[#1a2035]/80">
                            {resources.map((resource) => {
                                const used = Number(totals.effectiveByResource[resource.id] ?? 0);
                                const maxBillable = Number(billableCapacityByResource[resource.id] ?? 0);
                                return (
                                    <th key={`${resource.id}-cap`} colSpan={2} className="px-2 py-1 text-center border-r border-border/35">
                                        <span className={cn("font-semibold", getConsultantHeaderClass(resource.id))}>
                                            {used.toFixed(1)} / {maxBillable.toFixed(1)}
                                        </span>
                                    </th>
                                );
                            })}
                        </tr>
                        <tr className="text-text-muted text-[11px] bg-[#1a2035]/80">
                            {resources.map((resource) => (
                                <Fragment key={`${resource.id}-sub`}>
                                    <th className="px-2 py-1 text-center border-r border-border/30">WT</th>
                                    <th className="px-2 py-1 text-center border-r border-border/40">W+</th>
                                </Fragment>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => {
                            const stats = rowStats.find((s) => s.id === row.id);
                            const rowTotal = Number(stats?.total ?? 0);
                            const clientStatusClass = getClientStatusClass(rowTotal, Number(row.wkMin || 0), Number(row.wkMax || 0));
                            return (
                                <tr key={row.id} className="border-t border-border/30">
                                    <td className="px-2 py-1.5 border-r border-border/25 text-right">
                                        <input
                                            type="number"
                                            value={row.team}
                                            onChange={(e) => updateRow(row.id, { team: toNumber(e.target.value) })}
                                            onBlur={() => persist(rows)}
                                            className="w-12 bg-transparent border border-transparent focus:border-border rounded px-1 py-1 text-right text-text-main"
                                        />
                                    </td>
                                    <td className="px-2 py-1.5 border-r border-border/25">
                                        <input
                                            value={row.teamSa}
                                            onChange={(e) => updateRow(row.id, { teamSa: e.target.value })}
                                            onBlur={() => persist(rows)}
                                            className="w-28 bg-transparent border border-transparent focus:border-border rounded px-1 py-1 text-text-main"
                                        />
                                    </td>
                                    <td className="px-2 py-1.5 border-r border-border/25">
                                        <input
                                            value={row.dealType}
                                            onChange={(e) => updateRow(row.id, { dealType: e.target.value })}
                                            onBlur={() => persist(rows)}
                                            className="w-20 bg-transparent border border-transparent focus:border-border rounded px-1 py-1 text-text-main"
                                        />
                                    </td>
                                    <td className="px-2 py-1.5 text-right border-r border-border/25">
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={row.wkMin}
                                            onChange={(e) => updateRow(row.id, { wkMin: toNumber(e.target.value) })}
                                            onBlur={() => persist(rows)}
                                            className="w-16 bg-transparent border border-transparent focus:border-border rounded px-1 py-1 text-right text-text-main"
                                        />
                                    </td>
                                    <td className="px-2 py-1.5 text-right border-r border-border/25">
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={row.wkMax}
                                            onChange={(e) => updateRow(row.id, { wkMax: toNumber(e.target.value) })}
                                            onBlur={() => persist(rows)}
                                            className="w-16 bg-transparent border border-transparent focus:border-border rounded px-1 py-1 text-right text-text-main"
                                        />
                                    </td>
                                    <td className="px-2 py-1.5 border-r border-border/25">
                                        <input
                                            value={row.client}
                                            onChange={(e) => updateRow(row.id, { client: e.target.value })}
                                            onBlur={() => persist(rows)}
                                            className={cn("w-40 bg-transparent border border-transparent focus:border-border rounded px-1 py-1 font-medium", clientStatusClass)}
                                        />
                                    </td>
                                    {resources.map((resource) => (
                                        <Fragment key={`${row.id}-${resource.id}`}>
                                            {(() => {
                                                const clickup = getClickupHoursForCell(row, resource);
                                                const plannedWt = Number(row.allocations[resource.id]?.wt ?? 0);
                                                const plannedWPlus = Number(row.allocations[resource.id]?.wPlus ?? 0);
                                                const plannedEffective = getEffectiveHours(plannedWt, plannedWPlus);
                                                const clickupEffective = getEffectiveHours(Number(clickup.wt || 0), Number(clickup.wPlus || 0));
                                                const effectiveMatches = Math.abs(plannedEffective - clickupEffective) < 0.05;
                                                return (
                                                    <>
                                            <td className="px-1 py-1.5 text-right border-r border-border/20">
                                                <input
                                                    type="number"
                                                    step="0.5"
                                                    value={row.allocations[resource.id]?.wt ?? 0}
                                                    onChange={(e) => updateAllocation(row.id, resource.id, "wt", toNumber(e.target.value))}
                                                    onBlur={() => persist(rows)}
                                                    title={`ClickUp Estimate WT: ${Number(clickup.wt || 0).toFixed(1)}h`}
                                                    className={cn(
                                                        "w-14 border rounded px-1 py-1 text-right focus:border-border",
                                                        !hasMatchCheckRun
                                                            ? "bg-surface/30 border-border/40 text-text-main"
                                                            : effectiveMatches
                                                            ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-100"
                                                            : "bg-red-500/20 border-red-500/30 text-red-100"
                                                    )}
                                                />
                                            </td>
                                            <td className="px-1 py-1.5 text-right border-r border-border/20">
                                                <input
                                                    type="number"
                                                    step="0.5"
                                                    value={row.allocations[resource.id]?.wPlus ?? 0}
                                                    onChange={(e) => updateAllocation(row.id, resource.id, "wPlus", toNumber(e.target.value))}
                                                    onBlur={() => persist(rows)}
                                                    title={`ClickUp Estimate W+: ${Number(clickup.wPlus || 0).toFixed(1)}h`}
                                                    className={cn(
                                                        "w-14 border rounded px-1 py-1 text-right focus:border-border",
                                                        !hasMatchCheckRun
                                                            ? "bg-surface/30 border-border/40 text-text-main"
                                                            : effectiveMatches
                                                            ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-100"
                                                            : "bg-red-500/20 border-red-500/30 text-red-100"
                                                    )}
                                                />
                                            </td>
                                                    </>
                                                );
                                            })()}
                                        </Fragment>
                                    ))}
                                    <td className="px-3 py-1.5 text-right border-r border-border/25 font-medium">{stats?.wt.toFixed(1)}</td>
                                    <td className="px-3 py-1.5 text-right border-r border-border/25 font-medium">{stats?.wPlus.toFixed(1)}</td>
                                    <td className="px-3 py-1.5 text-right border-r border-border/25 font-bold text-white">{stats?.total.toFixed(1)}</td>
                                    <td className={cn("px-3 py-1.5 text-right border-r border-border/25 font-medium", (stats?.gapToMin ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>
                                        {stats?.gapToMin.toFixed(1)}
                                    </td>
                                    <td className={cn("px-3 py-1.5 text-right border-r border-border/25 font-medium", (stats?.gapToMax ?? 0) >= 0 ? "text-text-main" : "text-amber-400")}>
                                        {stats?.gapToMax.toFixed(1)}
                                    </td>
                                    <td className="px-2 py-1.5">
                                        <input
                                            value={row.notes}
                                            onChange={(e) => updateRow(row.id, { notes: e.target.value })}
                                            onBlur={() => persist(rows)}
                                            className="w-72 bg-transparent border border-transparent focus:border-border rounded px-1 py-1 text-text-main"
                                        />
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="border-t border-border/40 bg-indigo-500/10">
                            <td colSpan={3} className="px-3 py-2 font-semibold text-text-main border-r border-border/30">
                                Totals
                            </td>
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-text-main">
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.wkMinTotal.toFixed(1)}
                                </div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-text-main">
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.wkMaxTotal.toFixed(1)}
                                </div>
                            </td>
                            <td className="px-3 py-2 border-r border-border/30 text-text-muted text-xs">
                                Clients
                            </td>
                            {resources.map((resource) => (
                                <Fragment key={`tot-${resource.id}`}>
                                    <td className="px-2 py-2 border-r border-border/20 text-right text-[11px] font-semibold text-text-main">
                                        <div className="inline-flex min-w-[3.5rem] justify-end rounded border border-border/35 bg-surface/30 px-1.5 py-1">
                                            {totals.wtByResource[resource.id].toFixed(1)}
                                        </div>
                                    </td>
                                    <td className="px-2 py-2 border-r border-border/20 text-right text-[11px] font-semibold text-indigo-200">
                                        <div className="inline-flex min-w-[3.5rem] justify-end rounded border border-border/35 bg-surface/30 px-1.5 py-1">
                                            {totals.wPlusByResource[resource.id].toFixed(1)}
                                        </div>
                                    </td>
                                </Fragment>
                            ))}
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30">
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.totalWt.toFixed(1)}
                                </div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30">
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.totalWPlus.toFixed(1)}
                                </div>
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-white border-r border-border/30">
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.totalForecast.toFixed(1)}
                                </div>
                            </td>
                            <td className={cn("px-3 py-2 text-right font-semibold border-r border-border/30", totals.gapToMin >= 0 ? "text-emerald-400" : "text-red-400")}>
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.gapToMin.toFixed(1)}
                                </div>
                            </td>
                            <td className={cn("px-3 py-2 text-right font-semibold border-r border-border/30", totals.gapToMax >= 0 ? "text-text-main" : "text-amber-400")}>
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.gapToMax.toFixed(1)}
                                </div>
                            </td>
                            <td className="px-3 py-2 text-xs text-text-muted">
                                <div className="flex items-center gap-1">
                                    <Grid2x2 className="w-3.5 h-3.5" />
                                    Calculated fields are formula-driven
                                </div>
                            </td>
                        </tr>
                        <tr className="border-t border-border/30 bg-surface/20">
                            <td colSpan={6} className="px-3 py-2 font-semibold text-text-main border-r border-border/30">
                                Billable Capacity
                            </td>
                            {resources.map((resource) => (
                                <td key={`cap-${resource.id}`} colSpan={2} className="px-2 py-2 border-r border-border/20 text-center text-[11px] font-semibold text-cyan-200">
                                    <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                        {Number(billableCapacityByResource[resource.id] ?? 0).toFixed(1)}
                                    </div>
                                </td>
                            ))}
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-cyan-200">
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {Object.values(billableCapacityByResource).reduce((sum, hrs) => sum + Number(hrs || 0), 0).toFixed(1)}
                                </div>
                            </td>
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-cyan-200">-</td>
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-cyan-200">-</td>
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-cyan-200">-</td>
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-cyan-200">-</td>
                            <td className="px-3 py-2 text-xs text-text-muted">
                                Pulled from Consultant Utilization billable capacity
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>

        </section>
    );
}
