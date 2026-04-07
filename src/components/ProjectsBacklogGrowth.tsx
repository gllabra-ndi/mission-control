"use client";

import { useEffect, useMemo, useState } from "react";
import { ClickUpTask } from "@/lib/clickup";

interface ProjectOption {
    id: string;
    name: string;
}

interface ProjectsBacklogGrowthProps {
    tasks: ClickUpTask[];
    projectOptions: ProjectOption[];
}

interface DrillTask {
    id: string;
    name: string;
    status: string;
    effort: number;
}

type GrowthSegment = "existing" | "new" | "completed";

const MONTH_LOOKBACK_LIMIT = 12;
const monthFmtUtc = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const monthYearFmtUtc = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function parseTimestampMs(value: string | null | undefined): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toEffortHours(task: ClickUpTask): number {
    if (task.time_estimate && task.time_estimate > 0) {
        return task.time_estimate / (1000 * 60 * 60);
    }
    if (task.time_spent && task.time_spent > 0) {
        return task.time_spent / (1000 * 60 * 60);
    }
    return 1;
}

function utcMonthStart(ms: number): number {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function utcNextMonthStart(ms: number): number {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

function addUtcMonths(monthStartMs: number, offset: number): number {
    const d = new Date(monthStartMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1);
}

function buildDrillTask(task: ClickUpTask, effort: number): DrillTask {
    return {
        id: task.id,
        name: task.name,
        status: task.status?.status ?? "unknown",
        effort,
    };
}

function isCompletedTask(task: ClickUpTask) {
    const statusText = String(task.status?.status ?? "").toLowerCase();
    const statusType = String(task.status?.type ?? "").toLowerCase();
    return statusType === "closed" || /(complete|completed|done|closed|resolved|shipped)/.test(statusText);
}

export function ProjectsBacklogGrowth({ tasks, projectOptions }: ProjectsBacklogGrowthProps) {
    const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
        const preferred = projectOptions.find((p) => /MIK\s*\|\s*Deliverables/i.test(p.name));
        return preferred?.id ?? projectOptions[0]?.id ?? "";
    });
    const [selectedSegment, setSelectedSegment] = useState<{ monthKey: string; segment: GrowthSegment } | null>(null);

    useEffect(() => {
        if (projectOptions.length === 0) {
            setSelectedProjectId("");
            return;
        }
        const stillExists = projectOptions.some((p) => p.id === selectedProjectId);
        if (!stillExists) {
            const preferred = projectOptions.find((p) => /MIK\s*\|\s*Deliverables/i.test(p.name));
            setSelectedProjectId(preferred?.id ?? projectOptions[0].id);
        }
    }, [projectOptions, selectedProjectId]);

    const selectedProjectName = useMemo(() => {
        return projectOptions.find((p) => p.id === selectedProjectId)?.name ?? "No project selected";
    }, [projectOptions, selectedProjectId]);

    const projectTasks = useMemo(() => {
        if (!selectedProjectId) return [];
        return tasks.filter((task) => task.list?.id === selectedProjectId);
    }, [tasks, selectedProjectId]);

    const monthlyData = useMemo(() => {
        const nowMonthStartMs = utcMonthStart(Date.now());
        const earliestCreatedMs = projectTasks
            .map((task) => parseTimestampMs(task.date_created))
            .filter((ms): ms is number => ms !== null)
            .reduce((min, ms) => Math.min(min, ms), Number.POSITIVE_INFINITY);

        const projectStartMonthMs = Number.isFinite(earliestCreatedMs)
            ? utcMonthStart(earliestCreatedMs)
            : nowMonthStartMs;
        const twelveMonthsBackMs = addUtcMonths(nowMonthStartMs, -(MONTH_LOOKBACK_LIMIT - 1));
        const rangeStartMonthMs = Math.max(projectStartMonthMs, twelveMonthsBackMs);

        const monthStarts: number[] = [];
        let cursor = rangeStartMonthMs;
        while (cursor <= nowMonthStartMs) {
            monthStarts.push(cursor);
            cursor = addUtcMonths(cursor, 1);
        }

        return monthStarts.map((monthStartMs) => {
            const monthEndExclusiveMs = utcNextMonthStart(monthStartMs);
            let existingBacklog = 0;
            let newAdded = 0;
            let completed = 0;
            const existingTasks: DrillTask[] = [];
            const newTasks: DrillTask[] = [];
            const completedTasks: DrillTask[] = [];

            projectTasks.forEach((task) => {
                const createdMs = parseTimestampMs(task.date_created);
                if (createdMs === null) return;
                const effort = toEffortHours(task);
                const closedMs = parseTimestampMs(task.date_closed);
                const completedThisMonth = closedMs !== null
                    && closedMs >= monthStartMs
                    && closedMs < monthEndExclusiveMs
                    && isCompletedTask(task);
                const wasClosedBeforeMonth = closedMs !== null && closedMs < monthStartMs;

                if (completedThisMonth) {
                    completed += effort;
                    completedTasks.push(buildDrillTask(task, effort));
                    return;
                }

                if (wasClosedBeforeMonth) return;

                if (createdMs < monthStartMs) {
                    existingBacklog += effort;
                    existingTasks.push(buildDrillTask(task, effort));
                    return;
                }

                if (createdMs < monthEndExclusiveMs) {
                    newAdded += effort;
                    newTasks.push(buildDrillTask(task, effort));
                }
            });

            return {
                monthKey: new Date(monthStartMs).toISOString(),
                monthLabel: monthFmtUtc.format(monthStartMs),
                monthYearLabel: monthYearFmtUtc.format(monthStartMs),
                existingBacklog,
                newAdded,
                completed,
                totalBacklog: existingBacklog + newAdded,
                totalBar: existingBacklog + newAdded + completed,
                existingTasks,
                newTasks,
                completedTasks,
            };
        });
    }, [projectTasks]);

    useEffect(() => {
        if (!selectedSegment) return;
        const stillExists = monthlyData.some((row) => row.monthKey === selectedSegment.monthKey);
        if (!stillExists) setSelectedSegment(null);
    }, [monthlyData, selectedSegment]);

    const maxTotal = Math.max(1, ...monthlyData.map((row) => row.totalBar));
    const currentTotal = monthlyData[monthlyData.length - 1]?.totalBacklog ?? 0;
    const currentNewAdded = monthlyData[monthlyData.length - 1]?.newAdded ?? 0;
    const currentCompleted = monthlyData[monthlyData.length - 1]?.completed ?? 0;
    const startTotal = monthlyData[0]?.totalBacklog ?? 0;
    const growthAbsolute = currentTotal - startTotal;

    const selectedDetails = useMemo(() => {
        if (!selectedSegment) return null;
        const row = monthlyData.find((m) => m.monthKey === selectedSegment.monthKey);
        if (!row) return null;
        if (selectedSegment.segment === "existing") {
            return {
                title: "Existing backlog",
                monthLabel: row.monthYearLabel,
                tasks: row.existingTasks,
                totalHours: row.existingBacklog,
            };
        }
        if (selectedSegment.segment === "completed") {
            return {
                title: "Work completed in month",
                monthLabel: row.monthYearLabel,
                tasks: row.completedTasks,
                totalHours: row.completed,
            };
        }
        return {
            title: "New work added in month",
            monthLabel: row.monthYearLabel,
            tasks: row.newTasks,
            totalHours: row.newAdded,
        };
    }, [monthlyData, selectedSegment]);

    if (projectOptions.length === 0) {
        return (
            <div className="border border-border/50 bg-surface/20 rounded-xl p-6 text-sm text-text-muted">
                No project lists are available yet in ClickUp for backlog growth tracking.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                    Projects
                </h2>

                <div className="flex items-center gap-3">
                    <label className="text-xs text-text-muted">Project</label>
                    <select
                        value={selectedProjectId}
                        onChange={(e) => {
                            setSelectedSegment(null);
                            setSelectedProjectId(e.target.value);
                        }}
                        className="bg-surface border border-border rounded px-3 py-1.5 text-sm text-text-main min-w-[240px]"
                    >
                        {projectOptions.map((project) => (
                            <option key={project.id} value={project.id}>
                                {project.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-text-main">Backlog Growth</h3>
                    <span className="text-xs text-text-muted">
                        {selectedProjectName}
                        {monthlyData.length > 0 ? ` • ${monthlyData[0].monthYearLabel} to ${monthlyData[monthlyData.length - 1].monthYearLabel}` : ""}
                    </span>
                </div>

                <div className="p-5">
                    <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-text-muted">
                        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#1f3b73]" /> Existing backlog</div>
                        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-[#69a8ff]" /> New work still open</div>
                        <div className="flex items-center gap-2"><span className="h-3 w-3 rounded bg-emerald-500" /> Work completed in month</div>
                    </div>

                    <div className="overflow-x-auto pb-2">
                        <div
                            className="grid min-w-full items-end gap-4 rounded-2xl border border-border/35 bg-background/25 px-5 py-5"
                            style={{ gridTemplateColumns: `repeat(${Math.max(monthlyData.length, 1)}, minmax(78px, 1fr))` }}
                        >
                        {monthlyData.map((row) => {
                            const existingH = (row.existingBacklog / maxTotal) * 240;
                            const newH = (row.newAdded / maxTotal) * 240;
                            const completedH = (row.completed / maxTotal) * 240;
                            return (
                                <div key={row.monthKey} className="flex min-w-[78px] flex-col items-center">
                                    <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-text-muted">
                                        {row.totalBacklog.toFixed(0)}h
                                    </div>
                                    <div className="relative flex h-[240px] w-full max-w-[72px] items-end overflow-hidden rounded-2xl border border-border/40 bg-[linear-gradient(180deg,rgba(255,255,255,0.02)_0%,rgba(255,255,255,0.00)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                                        <div className="pointer-events-none absolute inset-x-0 bottom-[25%] border-t border-dashed border-white/8" />
                                        <div className="pointer-events-none absolute inset-x-0 bottom-[50%] border-t border-dashed border-white/8" />
                                        <div className="pointer-events-none absolute inset-x-0 bottom-[75%] border-t border-dashed border-white/8" />
                                        <div className="flex w-full flex-col justify-end">
                                        {row.existingBacklog > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setSelectedSegment((prev) => prev?.monthKey === row.monthKey && prev.segment === "existing" ? null : { monthKey: row.monthKey, segment: "existing" })}
                                                className="w-full bg-[#1f3b73] transition hover:brightness-110"
                                                style={{ height: `${Math.max(existingH, 6)}px` }}
                                                title={`${row.monthYearLabel} • Existing backlog • ${row.existingBacklog.toFixed(1)}h`}
                                            />
                                        )}
                                        {row.newAdded > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setSelectedSegment((prev) => prev?.monthKey === row.monthKey && prev.segment === "new" ? null : { monthKey: row.monthKey, segment: "new" })}
                                                className="w-full bg-[#69a8ff] transition hover:brightness-110"
                                                style={{ height: `${Math.max(newH, 6)}px` }}
                                                title={`${row.monthYearLabel} • New work still open • ${row.newAdded.toFixed(1)}h`}
                                            />
                                        )}
                                        {row.completed > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setSelectedSegment((prev) => prev?.monthKey === row.monthKey && prev.segment === "completed" ? null : { monthKey: row.monthKey, segment: "completed" })}
                                                className="w-full bg-emerald-500 transition hover:brightness-110"
                                                style={{ height: `${Math.max(completedH, 6)}px` }}
                                                title={`${row.monthYearLabel} • Work completed in month • ${row.completed.toFixed(1)}h`}
                                            />
                                        )}
                                    </div>
                                    </div>
                                    <div className="mt-3 text-xs font-medium text-text-main">{row.monthLabel}</div>
                                    <div className="text-[10px] text-text-muted">{row.monthYearLabel}</div>
                                </div>
                            );
                        })}
                    </div>
                    </div>
                </div>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30">
                    <h3 className="text-sm font-semibold text-text-main">Growth Snapshot</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-border/40">
                    <div className="p-4">
                        <div className="text-[11px] uppercase text-text-muted">Backlog Total (Current Month)</div>
                        <div className="text-3xl font-bold text-white mt-1">{currentTotal.toFixed(1)}</div>
                    </div>
                    <div className="p-4">
                        <div className="text-[11px] uppercase text-text-muted">New Added (Current Month)</div>
                        <div className="text-3xl font-bold text-white mt-1">{currentNewAdded.toFixed(1)}</div>
                    </div>
                    <div className="p-4">
                        <div className="text-[11px] uppercase text-text-muted">Work Completed (Current Month)</div>
                        <div className="mt-1 text-3xl font-bold text-emerald-400">{currentCompleted.toFixed(1)}</div>
                    </div>
                    <div className="p-4">
                        <div className="text-[11px] uppercase text-text-muted">Growth Since Start</div>
                        <div className="text-3xl font-bold text-white mt-1">{growthAbsolute.toFixed(1)}</div>
                    </div>
                </div>
            </div>

            {selectedDetails && (
                <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden">
                    <div className="px-5 py-3 border-b border-border/50 bg-surface/30 flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-text-main">{selectedDetails.title} • {selectedDetails.monthLabel}</h3>
                        <span className="text-xs text-text-muted">{selectedDetails.tasks.length} tasks • {selectedDetails.totalHours.toFixed(1)}h</span>
                    </div>
                    <div className="max-h-72 overflow-y-auto custom-scrollbar">
                        {selectedDetails.tasks.length === 0 ? (
                            <div className="p-4 text-xs text-text-muted">No tasks in this segment.</div>
                        ) : (
                            <div className="divide-y divide-border/40">
                                {selectedDetails.tasks
                                    .slice()
                                    .sort((a, b) => b.effort - a.effort)
                                    .map((task) => (
                                        <div key={task.id} className="px-4 py-3 flex items-center justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="text-sm text-text-main truncate">{task.name}</div>
                                                <div className="text-[11px] text-text-muted truncate">{task.status}</div>
                                            </div>
                                            <div className="text-xs text-text-muted shrink-0">{task.effort.toFixed(1)}h</div>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
