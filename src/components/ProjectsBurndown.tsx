"use client";

import { useEffect, useMemo, useState } from "react";
import { ImportedTask } from "@/lib/imported-data";

interface ProjectOption {
    id: string;
    name: string;
}

interface ProjectsBurndownProps {
    tasks: ImportedTask[];
    projectOptions: ProjectOption[];
}

interface DrillTask {
    id: string;
    name: string;
    status: string;
    effort: number;
}

type BurndownSegment = "remaining" | "newScope" | "completed";

const MONTH_LOOKBACK_LIMIT = 12;
const monthFmtUtc = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" });
const monthYearFmtUtc = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

function toEffortHours(task: ImportedTask): number {
    if (task.time_estimate && task.time_estimate > 0) {
        return task.time_estimate / (1000 * 60 * 60);
    }
    if (task.time_spent && task.time_spent > 0) {
        return task.time_spent / (1000 * 60 * 60);
    }
    return 1;
}

function parseTimestampMs(value: string | null | undefined): number | null {
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isDoneStatus(task: ImportedTask): boolean {
    const statusType = String(task.status?.type ?? "").toLowerCase();
    const statusLabel = String(task.status?.status ?? "");
    if (statusType === "closed" || statusType === "done") return true;
    return /(done|complete|completed|closed|resolved)/i.test(statusLabel);
}

function taskCompletionMs(task: ImportedTask): number | null {
    const closedMs = parseTimestampMs(task.date_closed);
    if (closedMs !== null) return closedMs;

    const dateDone = parseTimestampMs((task as any).date_done);
    if (dateDone !== null) return dateDone;

    if (isDoneStatus(task)) {
        return parseTimestampMs(task.date_updated);
    }
    return null;
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

function buildDrillTask(task: ImportedTask, effort: number): DrillTask {
    return {
        id: task.id,
        name: task.name,
        status: task.status?.status ?? "unknown",
        effort,
    };
}

export function ProjectsBurndown({ tasks, projectOptions }: ProjectsBurndownProps) {
    const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
        const preferred = projectOptions.find((p) => /MIK\s*\|\s*Deliverables/i.test(p.name));
        return preferred?.id ?? projectOptions[0]?.id ?? "";
    });
    const [selectedSegment, setSelectedSegment] = useState<{ monthKey: string; segment: BurndownSegment } | null>(null);

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
            const remainingTasks: DrillTask[] = [];
            const newScopeTasks: DrillTask[] = [];
            const completedTasks: DrillTask[] = [];

            let remaining = 0;
            let newScope = 0;
            let completed = 0;

            projectTasks.forEach((task) => {
                const effort = toEffortHours(task);
                const createdMs = parseTimestampMs(task.date_created);
                const completedMs = taskCompletionMs(task);
                if (createdMs === null) return;

                const createdInMonth = createdMs >= monthStartMs && createdMs < monthEndExclusiveMs;
                const completedInMonth = completedMs !== null && completedMs >= monthStartMs && completedMs < monthEndExclusiveMs;
                const openAtMonthEnd = createdMs < monthEndExclusiveMs && (completedMs === null || completedMs >= monthEndExclusiveMs);

                if (openAtMonthEnd && createdInMonth) {
                    newScope += effort;
                    newScopeTasks.push(buildDrillTask(task, effort));
                } else if (openAtMonthEnd && createdMs < monthStartMs) {
                    remaining += effort;
                    remainingTasks.push(buildDrillTask(task, effort));
                }

                if (completedInMonth) {
                    completed += effort;
                    completedTasks.push(buildDrillTask(task, effort));
                }
            });

            return {
                monthKey: new Date(monthStartMs).toISOString(),
                monthLabel: monthFmtUtc.format(monthStartMs),
                monthYearLabel: monthYearFmtUtc.format(monthStartMs),
                remaining,
                newScope,
                completed,
                total: remaining + newScope + completed,
                remainingTasks,
                newScopeTasks,
                completedTasks,
            };
        });
    }, [projectTasks]);

    useEffect(() => {
        if (!selectedSegment) return;
        const stillExists = monthlyData.some((row) => row.monthKey === selectedSegment.monthKey);
        if (!stillExists) setSelectedSegment(null);
    }, [monthlyData, selectedSegment]);

    const velocityWindow = monthlyData.slice(Math.max(0, monthlyData.length - 3));
    const averageVelocity = velocityWindow.length > 0
        ? velocityWindow.reduce((sum, row) => sum + row.completed, 0) / velocityWindow.length
        : 0;
    const remainingNow = monthlyData[monthlyData.length - 1]?.remaining ?? 0;
    const projectedMonthsRemaining = averageVelocity > 0 ? Math.ceil(remainingNow / averageVelocity) : null;
    const maxCandle = Math.max(1, ...monthlyData.map((row) => row.total));

    const selectedDetails = useMemo(() => {
        if (!selectedSegment) return null;
        const row = monthlyData.find((m) => m.monthKey === selectedSegment.monthKey);
        if (!row) return null;
        if (selectedSegment.segment === "remaining") {
            return {
                title: "Remaining backlog",
                monthLabel: row.monthYearLabel,
                tasks: row.remainingTasks,
                totalHours: row.remaining,
            };
        }
        if (selectedSegment.segment === "newScope") {
            return {
                title: "New scope in month",
                monthLabel: row.monthYearLabel,
                tasks: row.newScopeTasks,
                totalHours: row.newScope,
            };
        }
        return {
            title: "Completed in month",
            monthLabel: row.monthYearLabel,
            tasks: row.completedTasks,
            totalHours: row.completed,
        };
    }, [monthlyData, selectedSegment]);

    if (projectOptions.length === 0) {
        return (
            <div className="border border-border/50 bg-surface/20 rounded-xl p-6 text-sm text-text-muted">
                No project lists are available yet for burndown tracking.
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
                    <h3 className="text-sm font-semibold text-text-main">Release Burndown</h3>
                    <span className="text-xs text-text-muted">
                        {selectedProjectName}
                        {monthlyData.length > 0 ? ` • ${monthlyData[0].monthYearLabel} to ${monthlyData[monthlyData.length - 1].monthYearLabel}` : ""}
                    </span>
                </div>

                <div className="p-5">
                    <div className="flex items-center gap-5 text-xs text-text-muted mb-4">
                        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-[#1f3b73]" /> Remaining backlog</div>
                        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-[#69a8ff]" /> New scope in month</div>
                        <div className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-[#1fbf7a]" /> Completed in month</div>
                    </div>

                    <div className="flex gap-3 items-end h-[320px] overflow-x-auto pb-2">
                        {monthlyData.map((row) => {
                            const remH = (row.remaining / maxCandle) * 240;
                            const newH = (row.newScope / maxCandle) * 240;
                            const doneH = (row.completed / maxCandle) * 240;
                            return (
                                <div key={row.monthKey} className="min-w-[64px] flex flex-col items-center">
                                    <div className="w-12 h-[240px] border border-border/40 rounded overflow-hidden flex flex-col justify-end bg-background/50">
                                        {row.remaining > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setSelectedSegment((prev) => prev?.monthKey === row.monthKey && prev.segment === "remaining" ? null : { monthKey: row.monthKey, segment: "remaining" })}
                                                className="w-full bg-[#1f3b73] hover:brightness-110 transition"
                                                style={{ height: `${Math.max(remH, 6)}px` }}
                                                title={`${row.monthYearLabel} • Remaining backlog • ${row.remaining.toFixed(1)}h`}
                                            />
                                        )}
                                        {row.newScope > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setSelectedSegment((prev) => prev?.monthKey === row.monthKey && prev.segment === "newScope" ? null : { monthKey: row.monthKey, segment: "newScope" })}
                                                className="w-full bg-[#69a8ff] hover:brightness-110 transition"
                                                style={{ height: `${Math.max(newH, 6)}px` }}
                                                title={`${row.monthYearLabel} • New scope in month • ${row.newScope.toFixed(1)}h`}
                                            />
                                        )}
                                        {row.completed > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => setSelectedSegment((prev) => prev?.monthKey === row.monthKey && prev.segment === "completed" ? null : { monthKey: row.monthKey, segment: "completed" })}
                                                className="w-full bg-[#1fbf7a] hover:brightness-110 transition"
                                                style={{ height: `${Math.max(doneH, 6)}px` }}
                                                title={`${row.monthYearLabel} • Completed in month • ${row.completed.toFixed(1)}h`}
                                            />
                                        )}
                                    </div>
                                    <div className="mt-2 text-xs text-text-main">{row.monthLabel}</div>
                                    <div className="text-[10px] text-text-muted">{row.total.toFixed(0)}h</div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-border/50 bg-surface/30">
                    <h3 className="text-sm font-semibold text-text-main">Velocity Projection</h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/40">
                    <div className="p-4">
                        <div className="text-[11px] uppercase text-text-muted">Avg Velocity (last 3 months)</div>
                        <div className="text-3xl font-bold text-white mt-1">{averageVelocity.toFixed(1)}</div>
                    </div>
                    <div className="p-4">
                        <div className="text-[11px] uppercase text-text-muted">Remaining Backlog</div>
                        <div className="text-3xl font-bold text-white mt-1">{remainingNow.toFixed(1)}</div>
                    </div>
                    <div className="p-4">
                        <div className="text-[11px] uppercase text-text-muted">Projected Months Remaining</div>
                        <div className="text-3xl font-bold text-white mt-1">
                            {projectedMonthsRemaining === null ? "—" : projectedMonthsRemaining}
                        </div>
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
