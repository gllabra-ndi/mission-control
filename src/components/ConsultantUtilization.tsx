"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, Users } from "lucide-react";
import { updateConsultantConfig, CapacityGridPayload } from "@/app/actions";
import { cn } from "@/lib/utils";

interface ConsultantUtilizationProps {
    activeWeekStr: string;
    consultants: Array<{ id: number; name: string }>;
    consultantConfigsById: Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>;
    capacityGrid: CapacityGridPayload;
    onConsultantConfigChange?: (
        consultantId: number,
        patch: Partial<{ maxCapacity: number; billableCapacity: number; notes: string }>
    ) => void;
}

function normalizeName(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function ConsultantUtilization({
    activeWeekStr,
    consultants,
    consultantConfigsById,
    capacityGrid,
    onConsultantConfigChange,
}: ConsultantUtilizationProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [isWeekNavLocked, setIsWeekNavLocked] = useState(false);
    const navUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeWeekDate = new Date(activeWeekStr + "T00:00:00");
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const isPastWeek = activeWeekStr < format(currentWeekStart, "yyyy-MM-dd");
    const isCurrentWeek = activeWeekStr === format(currentWeekStart, "yyyy-MM-dd");
    const weekNumber = format(activeWeekDate, "II");
    const weekRangeLabel = `${format(activeWeekDate, "MMM d")} to ${format(addDays(activeWeekDate, 4), "MMM d")}`;
    const weekLabel = `${format(activeWeekDate, "MM/dd")} to ${format(addDays(activeWeekDate, 4), "MM/dd")}`;

    const weekParamFor = (nextDate: Date) => `/?week=${format(nextDate, "yyyy-MM-dd")}&tab=consultant-utilization`;
    const navigateToWeek = (nextDate: Date | null) => {
        if (isWeekNavLocked) return;
        const currentWeekStr = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
        if (nextDate === null && activeWeekStr === currentWeekStr) return;
        if (nextDate && format(nextDate, "yyyy-MM-dd") === activeWeekStr) return;

        const href = nextDate ? weekParamFor(nextDate) : "/?tab=consultant-utilization";
        setIsWeekNavLocked(true);
        router.push(href);
        navUnlockTimerRef.current = setTimeout(() => {
            setIsWeekNavLocked(false);
            navUnlockTimerRef.current = null;
        }, 500);
    };
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
        setIsWeekNavLocked(false);
        if (navUnlockTimerRef.current) {
            clearTimeout(navUnlockTimerRef.current);
            navUnlockTimerRef.current = null;
        }
    }, [activeWeekStr]);

    useEffect(() => {
        return () => {
            if (navUnlockTimerRef.current) clearTimeout(navUnlockTimerRef.current);
        };
    }, []);

    const consultantsForDisplay = useMemo(
        () => consultants.slice().sort((a, b) => a.name.localeCompare(b.name)),
        [consultants]
    );

    const capacityHoursByConsultant = useMemo(() => {
        const byId = new Map<number, { mtHrs: number; wPlusHrs: number }>();
        const byName = new Map<string, { mtHrs: number; wPlusHrs: number }>();

        const resources = Array.isArray(capacityGrid?.resources) ? capacityGrid.resources : [];
        const rows = Array.isArray(capacityGrid?.rows) ? capacityGrid.rows : [];

        resources.forEach((resource: any) => {
            const consultantId = Number(resource?.consultantId ?? 0);
            if (consultantId > 0 && !byId.has(consultantId)) byId.set(consultantId, { mtHrs: 0, wPlusHrs: 0 });
            const nameKey = normalizeName(resource?.name ?? "");
            if (nameKey && !byName.has(nameKey)) byName.set(nameKey, { mtHrs: 0, wPlusHrs: 0 });
        });

        rows.forEach((row: any) => {
            const allocations = row?.allocations || {};
            resources.forEach((resource: any) => {
                const cell = allocations[resource.id] || {};
                const wt = Number(cell.wt ?? 0);
                const wPlus = Number(cell.wPlus ?? 0);
                const consultantId = Number(resource?.consultantId ?? 0);
                if (consultantId > 0) {
                    const current = byId.get(consultantId) || { mtHrs: 0, wPlusHrs: 0 };
                    current.mtHrs += wt;
                    current.wPlusHrs += wPlus;
                    byId.set(consultantId, current);
                }
                const nameKey = normalizeName(resource?.name ?? "");
                if (nameKey) {
                    const currentName = byName.get(nameKey) || { mtHrs: 0, wPlusHrs: 0 };
                    currentName.mtHrs += wt;
                    currentName.wPlusHrs += wPlus;
                    byName.set(nameKey, currentName);
                }
            });
        });

        return { byId, byName };
    }, [capacityGrid]);

    const persistConsultant = (
        consultantId: number,
        patch: Partial<{ maxCapacity: number; billableCapacity: number; notes: string }>
    ) => {
        const current = consultantConfigsById[consultantId] || { maxCapacity: 40, billableCapacity: 40, notes: "" };
        const next = { ...current, ...patch };
        startTransition(() => {
            updateConsultantConfig(activeWeekStr, consultantId, {
                maxCapacity: Number(next.maxCapacity ?? 40),
                billableCapacity: Number(next.billableCapacity ?? 40),
                notes: String(next.notes ?? ""),
            });
        });
    };

    const totalsRow = consultantsForDisplay.reduce((acc, consultant) => {
        const cfg = consultantConfigsById[consultant.id] || { maxCapacity: 40, billableCapacity: 40, notes: "" };
        const hours =
            capacityHoursByConsultant.byId.get(consultant.id) ||
            capacityHoursByConsultant.byName.get(normalizeName(consultant.name)) ||
            { mtHrs: 0, wPlusHrs: 0 };
        const total = Number(hours.mtHrs || 0) + Number(hours.wPlusHrs || 0);
        acc.max += Number(cfg.maxCapacity || 0);
        acc.billable += Number(cfg.billableCapacity || 0);
        acc.mt += Number(hours.mtHrs || 0);
        acc.wPlus += Number(hours.wPlusHrs || 0);
        acc.total += total;
        acc.available += Math.max(0, Number(cfg.billableCapacity || 0) - total);
        return acc;
    }, { max: 0, billable: 0, mt: 0, wPlus: 0, total: 0, available: 0 });

    const utilizationPct = totalsRow.billable > 0 ? (totalsRow.total / totalsRow.billable) * 100 : 0;

    return (
        <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                    <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Consultant Utilization
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
                <span className="text-[11px] text-text-muted">{isPending ? "Saving..." : "Synced with capacity grid allocations"}</span>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden shrink-0">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30 flex items-center gap-2">
                    <Users className="w-4 h-4 text-cyan-400" />
                    <h3 className="text-sm font-semibold text-text-main">CONSULTANT UTILIZATION</h3>
                </div>
                <div className="overflow-x-auto text-[13px]">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b border-border/50 text-text-muted text-[11px] uppercase tracking-wider bg-surface/10">
                                <th className="px-5 py-2.5 font-medium min-w-[180px]">Consultant</th>
                                <th className="px-5 py-2.5 font-medium w-24 border-l border-border/30">Max Capacity</th>
                                <th className="px-5 py-2.5 font-medium w-36 border-l border-border/30 text-amber-500/80">Billable Capacity</th>
                                <th className="px-5 py-2.5 font-medium w-24 bg-indigo-500/5 text-indigo-200">M/T Hrs</th>
                                <th className="px-5 py-2.5 font-medium w-24 bg-indigo-500/5 text-indigo-200">W+ Hrs</th>
                                <th className="px-5 py-2.5 font-medium w-24 bg-indigo-500/5 text-white font-bold">Billable Total</th>
                                <th className="px-5 py-2.5 font-medium w-24">Util %</th>
                                <th className="px-5 py-2.5 font-medium w-28 text-right">Available Hrs</th>
                                <th className="px-5 py-2.5 font-medium min-w-[220px] border-l border-border/30">Notes</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/30">
                            {consultantsForDisplay.map((consultant) => {
                                const cfg = consultantConfigsById[consultant.id] || { maxCapacity: 40, billableCapacity: 40, notes: "" };
                                const hours =
                                    capacityHoursByConsultant.byId.get(consultant.id) ||
                                    capacityHoursByConsultant.byName.get(normalizeName(consultant.name)) ||
                                    { mtHrs: 0, wPlusHrs: 0 };
                                const total = Number(hours.mtHrs || 0) + Number(hours.wPlusHrs || 0);
                                const util = Number(cfg.billableCapacity || 0) > 0 ? (total / Number(cfg.billableCapacity || 0)) * 100 : 0;
                                const available = Math.max(0, Number(cfg.billableCapacity || 0) - total);

                                return (
                                    <tr key={consultant.id} className="hover:bg-surface/30 transition-colors">
                                        <td className="px-5 py-2 font-medium text-text-main">{consultant.name}</td>
                                        <td className="px-5 py-2 border-l border-border/30">
                                            <input
                                                type="number"
                                                disabled={isPastWeek}
                                                value={cfg.maxCapacity ?? 40}
                                                onChange={(e) => onConsultantConfigChange?.(consultant.id, { maxCapacity: Number(e.target.value) })}
                                                onBlur={(e) => persistConsultant(consultant.id, { maxCapacity: Number(e.target.value) })}
                                                className="w-16 bg-surface border border-border rounded px-2 py-1 focus:border-indigo-500 outline-none transition-colors text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                                            />
                                        </td>
                                        <td className="px-5 py-2 text-amber-400 font-medium bg-amber-500/5 border-l border-border/30">
                                            <input
                                                type="number"
                                                disabled={isPastWeek}
                                                value={cfg.billableCapacity ?? 40}
                                                onChange={(e) => onConsultantConfigChange?.(consultant.id, { billableCapacity: Number(e.target.value) })}
                                                onBlur={(e) => persistConsultant(consultant.id, { billableCapacity: Number(e.target.value) })}
                                                className="w-20 bg-transparent border border-amber-500/30 rounded px-2 py-1 focus:border-amber-500 outline-none transition-colors text-amber-400 font-medium disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                                            />
                                        </td>
                                        <td className="px-5 py-2 bg-indigo-500/5 text-indigo-200 text-right">{Number(hours.mtHrs || 0).toFixed(1)}</td>
                                        <td className="px-5 py-2 bg-indigo-500/5 text-indigo-200 text-right">{Number(hours.wPlusHrs || 0).toFixed(1)}</td>
                                        <td className="px-5 py-2 bg-indigo-500/5 font-semibold text-white text-right">{total.toFixed(1)}</td>
                                        <td className={cn("px-5 py-2 text-right", util > 100 ? "text-red-400 font-bold" : "text-text-muted")}>{util.toFixed(0)}%</td>
                                        <td className="px-5 py-2 text-right text-text-muted">{available.toFixed(1)}</td>
                                        <td className="px-5 py-2 border-l border-border/30">
                                            <input
                                                type="text"
                                                disabled={isPastWeek}
                                                value={cfg.notes || ""}
                                                onChange={(e) => onConsultantConfigChange?.(consultant.id, { notes: e.target.value })}
                                                onBlur={(e) => persistConsultant(consultant.id, { notes: e.target.value })}
                                                placeholder="..."
                                                className="w-full bg-transparent border-b border-transparent hover:border-border focus:border-indigo-500 outline-none transition-colors py-0.5 disabled:opacity-50 disabled:cursor-not-allowed text-xs text-text-muted"
                                            />
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                        <tfoot className="bg-indigo-500/10 font-bold border-t border-border/50">
                            <tr>
                                <td className="px-5 py-2.5 text-text-main text-[12px] uppercase tracking-wider">TOTAL</td>
                                <td className="px-5 py-2.5 text-text-main text-[13px] border-l border-border/30">{totalsRow.max.toFixed(1)}</td>
                                <td className="px-5 py-2.5 text-amber-500/80 text-[13px] border-l border-border/30">{totalsRow.billable.toFixed(1)}</td>
                                <td className="px-5 py-2.5 text-indigo-300 text-[13px] text-right">{totalsRow.mt.toFixed(1)}</td>
                                <td className="px-5 py-2.5 text-indigo-300 text-[13px] text-right">{totalsRow.wPlus.toFixed(1)}</td>
                                <td className="px-5 py-2.5 text-white text-[13px] text-right">{totalsRow.total.toFixed(1)}</td>
                                <td className="px-5 py-2.5 text-text-main text-[13px] text-right">{utilizationPct.toFixed(0)}%</td>
                                <td className="px-5 py-2.5 text-text-main text-[13px] text-right">{totalsRow.available.toFixed(1)}</td>
                                <td className="px-5 py-2.5 border-l border-border/30"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </section>
    );
}
