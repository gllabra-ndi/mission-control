"use client";

import { useMemo, Suspense, use } from "react";
import { useRouter } from "next/navigation";
import { format, subWeeks, addWeeks, addDays, startOfWeek, startOfMonth, endOfMonth } from "date-fns";
import { ImportedTask, TimeEntry } from "@/lib/imported-data";
import { computeCapacityHeaderMetrics, getAllocationHours, normalizeDashboardName } from "@/lib/dashboardMetrics";
import { AlertCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandCenterProps {
    tasksPromise?: Promise<ImportedTask[]>;
    timeEntriesPromise?: Promise<TimeEntry[]>;
    tasks?: ImportedTask[];
    timeEntries?: TimeEntry[];
    activeWeekStr: string;
    dbConfig: any;
    onNavigateWeek?: (nextWeek: string) => void;
    isWeekLoading?: boolean;
}

interface ClientPaceTrackerRow {
    id: string;
    team: number;
    client: string;
    sa: string;
    dealType: string;
    monthlyMin: number;
    wkMax: number;
    plannedHours: number;
    billedHours: number;
    monthlyMax: number;
    isUnderMonthlyMin: boolean;
    isPlannedOverMonthlyMax: boolean;
    isOverMonthlyMax: boolean;
    statusLabel: string;
}

const DEFAULT_LEAD_TARGETS: Record<string, number> = {
    "James W.": 117,
    "Monica": 110,
    "Omair": 64,
    "Greg": 37.5,
    "Joe": 30,
    "Mike": 10,
    "Nikko": 3,
    "James/Omair": 2,
};

function CommandMetrics({
    tasksPromise,
    timeEntriesPromise,
    tasks: initialTasks,
    timeEntries: initialTimeEntries,
    activeWeekStr,
    dbConfig,
    activeWeekDate,
    isCurrentWeek,
    isPastWeek,
}: any) {
    const tasks = tasksPromise ? use(tasksPromise) : initialTasks;
    const timeEntries = timeEntriesPromise ? use(timeEntriesPromise) : initialTimeEntries;

    const baseTarget = dbConfig?.weekConfig?.baseTarget ?? 350;
    const stretchTarget = dbConfig?.weekConfig?.stretchTarget ?? 400;

    const tasksMap = useMemo(() => {
        const map = new Map<string, ImportedTask>();
        (tasks || []).forEach((t: any) => map.set(t.id, t));
        return map;
    }, [tasks]);

    const activeWeekStartMs = startOfWeek(activeWeekDate, { weekStartsOn: 1 }).getTime();
    const activeWeekEndMs = addDays(new Date(activeWeekStartMs), 6).getTime();
    const activeMonthStartDate = startOfMonth(activeWeekDate);
    const activeMonthEndDate = endOfMonth(activeWeekDate);
    const activeMonthStartMs = activeMonthStartDate.getTime();
    const activeMonthEndMs = activeMonthEndDate.getTime();
    const activeMonthLabel = format(activeMonthStartDate, "MMMM yyyy");
    
    const activeMonthProgress = useMemo(() => {
        const daysInMonth = Math.max(1, activeMonthEndDate.getDate());
        const now = new Date();
        const referenceDate = isCurrentWeek
            ? now
            : activeWeekDate > now
                ? activeMonthStartDate
                : activeMonthEndDate;
        const dayOfMonth = Math.min(daysInMonth, Math.max(1, referenceDate.getDate()));
        return dayOfMonth / daysInMonth;
    }, [activeMonthEndDate, activeMonthStartDate, activeWeekDate, isCurrentWeek]);

    const activeWeekTimeEntries = useMemo(() => {
        return (timeEntries || []).filter((entry: any) => {
            const entryStartMs = Number(entry?.start || 0);
            return entryStartMs >= activeWeekStartMs && entryStartMs <= activeWeekEndMs;
        });
    }, [timeEntries, activeWeekStartMs, activeWeekEndMs]);

    const activeMonthTimeEntries = useMemo(() => {
        return (timeEntries || []).filter((entry: any) => {
            const entryStartMs = Number(entry?.start || 0);
            return entryStartMs >= activeMonthStartMs && entryStartMs <= activeMonthEndMs;
        });
    }, [timeEntries, activeMonthStartMs, activeMonthEndMs]);

    const totalBilledMs = useMemo(() => {
        return activeWeekTimeEntries.reduce((acc: number, entry: any) => acc + (Number(entry.duration) || 0), 0);
    }, [activeWeekTimeEntries]);
    const totalBilledHrs = totalBilledMs / (1000 * 60 * 60);
    
    const monthToDateBilledHrs = useMemo(() => {
        return activeMonthTimeEntries.reduce((acc: number, entry: any) => acc + ((Number(entry.duration) || 0) / (1000 * 60 * 60)), 0);
    }, [activeMonthTimeEntries]);

    const billedByClient = useMemo(() => {
        const map = new Map<string, number>();
        activeMonthTimeEntries.forEach((entry: any) => {
            const taskMatch = tasksMap.get(entry.task?.id);
            const durationHours = (Number(entry.duration) || 0) / (1000 * 60 * 60);
            if (durationHours <= 0) return;
            const idKey = normalizeDashboardName(String(taskMatch?.list?.id ?? ""));
            const nameKey = normalizeDashboardName(String(taskMatch?.list?.name ?? ""));
            if (idKey) map.set(idKey, (map.get(idKey) || 0) + durationHours);
            if (nameKey) map.set(nameKey, (map.get(nameKey) || 0) + durationHours);
        });
        return map;
    }, [activeMonthTimeEntries, tasksMap]);

    const weeklyTrend = useMemo(() => {
        return Array.isArray(dbConfig?.weeklyTrend) ? dbConfig.weeklyTrend : [];
    }, [dbConfig]);

    const monthlyBaseTarget = useMemo(() => {
        return weeklyTrend.reduce((sum: number, row: any) => {
            const weekStartMs = new Date(`${String(row?.weekStart ?? "")}T00:00:00`).getTime();
            if (!Number.isFinite(weekStartMs) || weekStartMs < activeMonthStartMs || weekStartMs > activeMonthEndMs) {
                return sum;
            }
            return sum + Number(row?.baseTarget ?? 0);
        }, 0);
    }, [activeMonthEndMs, activeMonthStartMs, weeklyTrend]);

    const monthPacingTarget = monthlyBaseTarget * activeMonthProgress;
    const monthPacingStatus = monthToDateBilledHrs >= monthPacingTarget ? "ON TRACK" : "BEHIND";
    const monthPacingStatusClass = monthToDateBilledHrs >= monthPacingTarget ? "text-emerald-400" : "text-amber-300";
    const monthProgressLabel = `${Math.round(activeMonthProgress * 100)}% THROUGH MONTH`;

    const clientDirectoryById = useMemo(() => {
        const map = new Map<string, any>();
        const rows = Array.isArray(dbConfig?.clientDirectory) ? dbConfig.clientDirectory : [];
        rows.forEach((row: any) => {
            const id = String(row?.id ?? "").trim();
            if (!id) return;
            map.set(id, row);
        });
        return map;
    }, [dbConfig?.clientDirectory]);

    const currentCapacityMetrics = useMemo(
        () => computeCapacityHeaderMetrics({
            payload: dbConfig?.capacityGridConfig,
            billableRollups: Array.isArray(dbConfig?.taskBillableRollups) ? dbConfig.taskBillableRollups : [],
            consultantConfigRows: Array.isArray(dbConfig?.consultantConfigs) ? dbConfig.consultantConfigs : [],
            tasks: Array.isArray(tasks) ? tasks : [],
        }),
        [dbConfig, tasks]
    );

    const currentWeekCards = [
        { label: "Consultant Total Capacity", value: currentCapacityMetrics.totalCapacity, accent: "text-white" },
        { label: "Planned", value: currentCapacityMetrics.planned, accent: "text-white" },
        { label: "Actuals", value: currentCapacityMetrics.actuals, accent: "text-white" },
        { label: "WK Min Total", value: currentCapacityMetrics.wkMinTotal, accent: "text-white" },
        { label: "WK Max Total", value: currentCapacityMetrics.wkMaxTotal, accent: "text-white" },
        {
            label: "Gap vs WK Min",
            value: currentCapacityMetrics.gapToMin,
            accent: currentCapacityMetrics.gapToMin >= 0 ? "text-white" : "text-slate-400",
            lane: currentCapacityMetrics.gapToMin >= 0 ? "" : "bg-slate-500/10",
        },
    ];

    const monthCapacityRows = useMemo(() => {
        const rowsMap = new Map<string, any>();
        const capacityGridWeeks = new Map<string, any>();
        const capacityGridConfigsForYear = Array.isArray(dbConfig?.capacityGridConfigsForYear) ? dbConfig.capacityGridConfigsForYear : [];
        
        capacityGridConfigsForYear.forEach((weekRow: any) => {
            const weekKey = String(weekRow?.week ?? "");
            if (!weekKey) return;
            capacityGridWeeks.set(weekKey, weekRow?.payload ?? null);
        });
        
        if (!capacityGridWeeks.has(activeWeekStr) && dbConfig?.capacityGridConfig) {
            capacityGridWeeks.set(activeWeekStr, dbConfig.capacityGridConfig);
        }

        capacityGridWeeks.forEach((payload: any, weekKey: string) => {
            const weekMs = new Date(`${weekKey}T00:00:00`).getTime();
            if (!Number.isFinite(weekMs) || weekMs < activeMonthStartMs || weekMs > activeMonthEndMs) return;

            const rows = Array.isArray(payload?.rows) ? payload.rows : [];
            const resources = (Array.isArray(payload?.resources) ? payload.resources : []).filter((resource: any) => !Boolean(resource?.removed));

            rows.forEach((row: any, idx: number) => {
                const rowId = String(row?.id ?? `row-${idx + 1}`);
                const clientDir = clientDirectoryById.get(rowId);
                const existing = rowsMap.get(rowId) ?? {
                    client: String(clientDir?.name ?? row?.client ?? "Client"),
                    team: Number(clientDir?.team ?? row?.team ?? 0),
                    sa: String(clientDir?.sa ?? row?.teamSa ?? ""),
                    dealType: String(clientDir?.dealType ?? row?.dealType ?? ""),
                    monthlyMin: 0,
                    wkMax: Number(clientDir?.max ?? row?.wkMax ?? 0),
                    monthlyMax: 0,
                    plannedHours: 0,
                };

                const allocations = row?.allocations || {};
                const rowPlannedHours = resources.reduce((sum: number, resource: any) => {
                    return sum + getAllocationHours(allocations?.[resource.id]);
                }, 0);

                existing.monthlyMin += Number(clientDir?.min ?? row?.wkMin ?? 0);
                existing.monthlyMax += Number(clientDir?.max ?? row?.wkMax ?? 0);
                existing.plannedHours += Number(rowPlannedHours ?? 0);

                rowsMap.set(rowId, existing);
            });
        });
        return rowsMap;
    }, [dbConfig, activeMonthStartMs, activeMonthEndMs, activeWeekStr, clientDirectoryById]);

    const cptRows: ClientPaceTrackerRow[] = useMemo(() => {
        const capacityGridRows = Array.isArray(dbConfig?.capacityGridConfig?.rows) ? dbConfig.capacityGridConfig.rows : [];
        return capacityGridRows.map((row: any, idx: number) => {
            const rowId = String(row?.id ?? `row-${idx + 1}`);
            const monthlyCapacity = monthCapacityRows.get(rowId);
            const clientDir = clientDirectoryById.get(rowId);
            const idKey = normalizeDashboardName(rowId);
            const nameKey = normalizeDashboardName(String(row?.client ?? ""));
            const billedHours = Number(billedByClient.get(idKey) ?? billedByClient.get(nameKey) ?? 0);
            
            const monthlyMin = Number(monthlyCapacity?.monthlyMin ?? 0);
            const wkMax = Number(clientDir?.max ?? row?.wkMax ?? monthlyCapacity?.wkMax ?? 0);
            const monthlyMax = Number(monthlyCapacity?.monthlyMax ?? 0);
            const plannedHours = Number(monthlyCapacity?.plannedHours ?? 0);
            
            const isUnderMonthlyMin = monthlyMin > 0 && plannedHours < monthlyMin;
            const isPlannedOverMonthlyMax = monthlyMax > 0 && plannedHours > monthlyMax;
            const isOverMonthlyMax = monthlyMax > 0 && billedHours > monthlyMax;
            
            const statusLabel = isOverMonthlyMax
                ? "Actuals Over Max"
                : isUnderMonthlyMin
                    ? "Under Minimum"
                : isPlannedOverMonthlyMax
                    ? "Planned Over Max"
                    : "OK";

            return {
                id: rowId,
                team: Number(clientDir?.team ?? row?.team ?? monthlyCapacity?.team ?? 0),
                client: String(clientDir?.name ?? row?.client ?? monthlyCapacity?.client ?? "Client"),
                sa: String(clientDir?.sa ?? row?.teamSa ?? monthlyCapacity?.sa ?? ""),
                dealType: String(clientDir?.dealType ?? row?.dealType ?? monthlyCapacity?.dealType ?? ""),
                monthlyMin,
                wkMax,
                plannedHours,
                billedHours,
                monthlyMax,
                isUnderMonthlyMin,
                isPlannedOverMonthlyMax,
                isOverMonthlyMax,
                statusLabel,
            };
        });
    }, [dbConfig, monthCapacityRows, clientDirectoryById, billedByClient]);

    const cptTotals = cptRows.reduce((acc: { max: number; monthlyMax: number; plannedHours: number; billedHours: number }, row: ClientPaceTrackerRow) => {
        acc.max += row.wkMax;
        acc.monthlyMax += row.monthlyMax;
        acc.plannedHours += row.plannedHours;
        acc.billedHours += row.billedHours;
        return acc;
    }, { max: 0, monthlyMax: 0, plannedHours: 0, billedHours: 0 });

    return (
        <div className="space-y-8">
            <div className="w-full overflow-hidden rounded-2xl border border-border/60 bg-[linear-gradient(180deg,rgba(39,32,74,0.92)_0%,rgba(27,24,49,0.96)_100%)] shadow-[0_18px_50px_rgba(0,0,0,0.24)]">
                <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                    <h3 className="text-lg font-semibold text-white">MONTH AT A GLANCE</h3>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-200/80">{activeMonthLabel}</div>
                </div>
                <div className="grid grid-cols-1 divide-y divide-white/10 md:grid-cols-[1fr_1fr_0.9fr] md:divide-x md:divide-y-0">
                    <div className="px-6 py-6">
                        <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-indigo-200/70">Month To Date Actuals</div>
                        <div className="mt-4 text-4xl font-bold leading-none text-white">{monthToDateBilledHrs.toFixed(1)}</div>
                    </div>
                    <div className="px-6 py-6">
                        <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-indigo-200/70">Monthly Base Target</div>
                        <div className="mt-4 text-4xl font-bold leading-none text-white">{monthlyBaseTarget.toFixed(0)}</div>
                    </div>
                    <div className="bg-white/[0.02] px-6 py-6">
                        <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-indigo-200/70">Month Pacing Status</div>
                        <div className={cn("mt-4 text-4xl font-bold leading-none", monthPacingStatusClass)}>{monthPacingStatus}</div>
                        <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-indigo-200/70">{monthProgressLabel}</div>
                    </div>
                </div>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden shrink-0">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30">
                    <h3 className="text-sm font-semibold text-text-main">THIS WEEK AT A GLANCE</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 divide-y md:divide-y-0 md:divide-x divide-border/40">
                    {currentWeekCards.map((card) => (
                        <div key={card.label} className={cn("p-4", card.lane)}>
                            <div className="text-[11px] uppercase text-text-muted">{card.label}</div>
                            <div className={cn("mt-1 text-3xl font-bold", card.accent)}>{card.value.toFixed(1)}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden shrink-0">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-emerald-400" />
                        <h3 className="text-sm font-semibold text-text-main">CLIENT PACE TRACKER — {activeMonthLabel}</h3>
                    </div>
                </div>
                <div className="overflow-x-auto text-[13px]">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b-2 border-border/50 text-text-muted text-[11px] font-bold tracking-wider bg-[#1a2035]/80 text-[#94a3b8] cap-none">
                                <th className="px-5 py-2.5 font-medium w-16 text-right border-r border-dashed border-blue-400/30">Team</th>
                                <th className="px-5 py-2.5 font-medium min-w-[160px] border-r border-dashed border-blue-400/30">Client</th>
                                <th className="px-5 py-2.5 font-medium w-32 border-r border-dashed border-blue-400/30">SA</th>
                                <th className="px-5 py-2.5 font-medium w-32 border-r border-dashed border-blue-400/30">Deal Type</th>
                                <th className="px-5 py-2.5 font-medium w-24 text-right border-r border-dashed border-blue-400/30">Wk Max</th>
                                <th className="px-5 py-2.5 font-medium w-28 text-right border-r border-dashed border-blue-400/30">Month Max</th>
                                <th className="px-5 py-2.5 font-medium w-28 font-bold text-white text-right border-r border-dashed border-blue-400/30 bg-indigo-500/10">Planned (Month)</th>
                                <th className="px-5 py-2.5 font-medium w-28 font-bold text-white text-right border-r border-dashed border-blue-400/30 bg-cyan-500/10">Actuals (Month)</th>
                                <th className="px-5 py-2.5 font-medium w-24 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {cptRows.map((row) => (
                                <tr key={row.id} className="hover:bg-surface/30 transition-colors">
                                    <td className="px-5 py-2 text-text-muted border-r border-dashed border-blue-400/30 text-right tabular-nums text-xs">{row.team > 0 ? row.team : "-"}</td>
                                    <td className={cn("px-5 py-2 font-medium border-r border-dashed border-blue-400/30", row.isOverMonthlyMax || row.isUnderMonthlyMin || row.isPlannedOverMonthlyMax ? "text-red-400" : "text-text-main")}>
                                        <span className="text-xs font-medium">{row.client}</span>
                                    </td>
                                    <td className="px-5 py-2 border-r border-dashed border-blue-400/30 text-[11px] text-text-main">{row.sa || "-"}</td>
                                    <td className="px-5 py-2 border-r border-dashed border-blue-400/30 text-[11px] text-text-main">{row.dealType || "-"}</td>
                                    <td className="px-5 py-2 border-r border-dashed border-blue-400/30 text-text-main text-right tabular-nums text-xs">{row.wkMax > 0 ? row.wkMax.toFixed(1) : "-"}</td>
                                    <td className="px-5 py-2 border-r border-dashed border-blue-400/30 text-text-main text-right tabular-nums text-xs">{row.monthlyMax > 0 ? row.monthlyMax.toFixed(1) : "-"}</td>
                                    <td className="px-5 py-2 bg-indigo-500/10 font-bold text-white text-right border-r border-dashed border-blue-400/30">{row.plannedHours > 0 ? row.plannedHours.toFixed(1) : "0"}</td>
                                    <td className={cn("px-5 py-2 font-bold text-right border-r border-dashed border-blue-400/30", row.isOverMonthlyMax ? "bg-red-500/15 text-red-300" : "bg-cyan-500/10 text-cyan-100")}>{row.billedHours > 0 ? row.billedHours.toFixed(1) : "0"}</td>
                                    <td className={cn("px-5 py-2 text-center text-xs font-semibold", row.isOverMonthlyMax || row.isUnderMonthlyMin || row.isPlannedOverMonthlyMax ? "text-red-400" : "text-emerald-400")}>{row.statusLabel}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-indigo-500/10 font-bold border-t border-border/50">
                            <tr>
                                <td colSpan={4} className="px-5 py-2.5 text-text-main text-[12px] uppercase tracking-wider text-right">TOTAL</td>
                                <td className="px-5 py-2.5 text-text-main text-[13px] text-right">{cptTotals.max > 0 ? cptTotals.max.toFixed(1) : "0"}</td>
                                <td className="px-5 py-2.5 text-text-main text-[13px] text-right">{cptTotals.monthlyMax > 0 ? cptTotals.monthlyMax.toFixed(1) : "0"}</td>
                                <td className="px-5 py-2.5 text-white font-bold text-[13px] text-right">{cptTotals.plannedHours > 0 ? cptTotals.plannedHours.toFixed(1) : "0"}</td>
                                <td className="px-5 py-2.5 text-white font-bold text-[13px] text-right">{cptTotals.billedHours > 0 ? cptTotals.billedHours.toFixed(1) : "0"}</td>
                                <td className="px-5 py-2.5 text-center text-xs"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
}

export function CommandCenter({ tasksPromise, timeEntriesPromise, tasks, timeEntries, activeWeekStr, dbConfig, onNavigateWeek, isWeekLoading = false }: CommandCenterProps) {
    const router = useRouter();
    const activeWeekDate = useMemo(() => new Date(activeWeekStr + 'T00:00:00'), [activeWeekStr]);
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const currentWeekStartStr = format(currentWeekStart, 'yyyy-MM-dd');
    const isPastWeek = activeWeekStr < currentWeekStartStr;
    const isCurrentWeek = activeWeekStr === currentWeekStartStr;
    const isNavigationBlocked = !onNavigateWeek && isWeekLoading;

    const handlePrevWeek = () => {
        const nextWeek = format(subWeeks(activeWeekDate, 1), "yyyy-MM-dd");
        if (onNavigateWeek) onNavigateWeek(nextWeek);
        else router.push(`/?week=${nextWeek}&tab=command-center`);
    };
    const handleNextWeek = () => {
        const nextWeek = format(addWeeks(activeWeekDate, 1), "yyyy-MM-dd");
        if (onNavigateWeek) onNavigateWeek(nextWeek);
        else router.push(`/?week=${nextWeek}&tab=command-center`);
    };
    const handleCurrentWeek = () => {
        if (onNavigateWeek) onNavigateWeek(currentWeekStartStr);
        else router.push(`/?tab=command-center`);
    };

    return (
        <div className="flex flex-col space-y-8 pb-32 px-1">
            <div className="flex flex-col gap-5 shrink-0">
                <div className="space-y-4">
                    <div className="flex items-center gap-4">
                        <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
                            Command Center
                        </h2>

                        <div className="flex items-center bg-surface border border-border rounded overflow-hidden">
                            <button disabled={isNavigationBlocked} onClick={handlePrevWeek} className="px-2 py-1 hover:bg-surface-hover text-text-muted transition-colors disabled:opacity-50">
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button disabled={isWeekLoading} onClick={handleCurrentWeek} className="px-3 py-1 text-xs font-medium text-white hover:bg-surface-hover transition-colors border-l border-r border-border disabled:opacity-50">
                                {isCurrentWeek ? "Current Week" : format(activeWeekDate, "MMM d, yyyy")}
                            </button>
                            <button disabled={isNavigationBlocked} onClick={handleNextWeek} className="px-2 py-1 hover:bg-surface-hover text-text-muted transition-colors disabled:opacity-50">
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>

                        {isPastWeek && (
                            <span className="text-xs font-medium text-amber-500 bg-amber-500/10 px-2 py-1 rounded">
                                Read-Only History
                            </span>
                        )}
                    </div>

                    <div className="text-xs text-text-muted bg-surface-hover px-3 py-1.5 rounded border border-border inline-flex">
                        Based on imported time history
                    </div>
                </div>
            </div>

            <Suspense fallback={
                <div className="space-y-8 animate-pulse">
                    <div className="h-64 w-full bg-slate-900/50 rounded-2xl border border-white/5" />
                    <div className="h-96 w-full bg-slate-900/50 rounded-2xl border border-white/5" />
                </div>
            }>
                <CommandMetrics
                    tasksPromise={tasksPromise}
                    timeEntriesPromise={timeEntriesPromise}
                    tasks={tasks}
                    timeEntries={timeEntries}
                    activeWeekStr={activeWeekStr}
                    dbConfig={dbConfig}
                    activeWeekDate={activeWeekDate}
                    isCurrentWeek={isCurrentWeek}
                    isPastWeek={isPastWeek}
                />
            </Suspense>
        </div>
    );
}
