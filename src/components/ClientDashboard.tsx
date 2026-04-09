"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ImportedTask, TimeEntry } from "@/lib/imported-data";
import { Download, ArrowRight, CheckCircle2, Circle, ChevronLeft, ChevronRight } from "lucide-react";
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, subWeeks, addWeeks, format } from "date-fns";
import { cn } from "@/lib/utils";
import { generateClientDashboardNarratives, type ClientDashboardNarrativeInput, type ClientDashboardTaskNarrative } from "@/app/actions";

interface ClientDashboardProps {
    clientId: string;
    clientName: string;
    activeWeekStr: string;
    tasks: ImportedTask[];
    timeEntries: TimeEntry[];
    clientOptions: { id: string | number; name: string }[];
    onSelectClient: (clientId: string) => void;
    onNavigateWeek?: (nextWeek: string) => void;
    isWeekLoading?: boolean;
}

type ClientDashboardNarrativeResult = {
    detailedWorkPerformed: string;
    valueDelivered: string;
    taskNarratives?: ClientDashboardTaskNarrative[];
    source: "llm" | "fallback";
    generatedAt: string;
};

export function ClientDashboard({
    clientId,
    clientName,
    activeWeekStr,
    tasks,
    timeEntries,
    clientOptions,
    onSelectClient,
    onNavigateWeek,
    isWeekLoading = false,
}: ClientDashboardProps) {
    const dashboardRef = useRef<HTMLDivElement>(null);
    const [viewMode, setViewMode] = useState<"weekly" | "monthly">("weekly");
    const [isDownloading, setIsDownloading] = useState(false);
    const [isNarrativeLoading, setIsNarrativeLoading] = useState(false);
    const [narratives, setNarratives] = useState<ClientDashboardNarrativeResult | null>(null);
    const narrativeRequestId = useRef(0);
    const taskNarrativeLookup = useMemo(() => {
        const map = new Map<string, ClientDashboardTaskNarrative>();
        (narratives?.taskNarratives || []).forEach((entry) => {
            if (entry?.taskId) {
                map.set(entry.taskId, entry);
            }
        });
        return map;
    }, [narratives?.taskNarratives]);

    const handleDownloadPdf = async () => {
        if (!dashboardRef.current) return;
        setIsDownloading(true);
        try {
            // @ts-ignore
            const html2pdf = (await import("html2pdf.js")).default;
            const element = dashboardRef.current;
            const opt = {
                margin: 10,
                filename: `${clientName.replace(/\s+/g, "_")}_Dashboard_${viewMode}.pdf`,
                image: { type: "jpeg" as const, quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true },
                // @ts-ignore
                jsPDF: { unit: "mm", format: "a4", orientation: "landscape" as const },
            };
            await html2pdf().set(opt).from(element).save();
        } catch (error) {
            console.error("PDF generation failed:", error);
        } finally {
            setIsDownloading(false);
        }
    };

    const activeWeekDate = useMemo(() => new Date(`${activeWeekStr}T00:00:00`), [activeWeekStr]);

    const handlePrevWeek = () => {
        if (onNavigateWeek) {
            onNavigateWeek(format(subWeeks(activeWeekDate, 1), "yyyy-MM-dd"));
        }
    };

    const handleNextWeek = () => {
        if (onNavigateWeek) {
            onNavigateWeek(format(addWeeks(activeWeekDate, 1), "yyyy-MM-dd"));
        }
    };

    const handleCurrentWeek = () => {
        if (onNavigateWeek) {
            onNavigateWeek(format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd"));
        }
    };

    const dateBoundary = useMemo(() => {
        const referenceDate = activeWeekDate;
        if (viewMode === "weekly") {
            return {
                start: startOfWeek(referenceDate, { weekStartsOn: 1 }),
                end: endOfWeek(referenceDate, { weekStartsOn: 1 }),
            };
        }

        return {
            start: startOfMonth(referenceDate),
            end: endOfMonth(referenceDate),
        };
    }, [activeWeekDate, viewMode]);

    const periodStartLabel = format(dateBoundary.start, "MMM d, yyyy");
    const periodEndLabel = format(dateBoundary.end, "MMM d, yyyy");

    const timeEntriesInRange = useMemo(() => {
        if (!timeEntries || !Array.isArray(timeEntries)) return [] as TimeEntry[];
        return timeEntries.filter((entry) => {
            if (!entry?.start) return false;
            const startNum = Number(entry.start);
            if (Number.isNaN(startNum)) return false;
            const entryStart = new Date(startNum);
            return isWithinInterval(entryStart, dateBoundary);
        });
    }, [timeEntries, dateBoundary]);

    const totalBilledHours = useMemo(() => {
        return timeEntriesInRange.reduce((sum, entry) => (
            sum + ((Number(entry.duration) || 0) / (1000 * 60 * 60))
        ), 0);
    }, [timeEntriesInRange]);

    const tasksInRange = useMemo(() => {
        const taskIds = new Set(timeEntriesInRange.map((entry) => String(entry.task?.id || "")));
        const scoped = tasks.filter((task) => taskIds.has(String(task.id)));
        return scoped.length > 0 ? scoped : tasks;
    }, [tasks, timeEntriesInRange]);

    const categorizedTasks = useMemo(() => {
        const backlog: ImportedTask[] = [];
        const inProgress: ImportedTask[] = [];
        const completed: ImportedTask[] = [];

        tasksInRange.forEach((task) => {
            const statusType = task.status.type.toLowerCase();
            const statusName = task.status.status.toLowerCase();

            // Check if task closed date is within boundary for completed tasks
            if (statusType === "closed" || statusName === "complete" || statusName === "done") {
                if (task.date_closed) {
                    const closedDate = new Date(Number(task.date_closed));
                    if (isWithinInterval(closedDate, dateBoundary)) {
                        completed.push(task);
                    }
                } else {
                    completed.push(task);
                }
            } else if (statusType === "open" && !statusName.includes("in progress") && !statusName.includes("doing") && !statusName.includes("active")) {
                backlog.push(task);
            } else {
                inProgress.push(task);
            }
        });

        return { backlog, inProgress, completed };
    }, [tasksInRange, dateBoundary]);

    const narrativeInputs = useMemo<ClientDashboardNarrativeInput>(() => ({
        clientId: String(clientId || "").trim(),
        clientName: String(clientName || "Client"),
        viewMode,
        periodStart: format(dateBoundary.start, "yyyy-MM-dd"),
        periodEnd: format(dateBoundary.end, "yyyy-MM-dd"),
        tasks: tasksInRange.map((task) => ({
            id: String(task.id),
            name: String(task.name || "").trim(),
            description: String((task as any).description || "").trim(),
            listName: String(task.list?.name || ""),
            assignees: Array.isArray(task.assignees)
                ? task.assignees.map((assignee) => String(assignee.username || "")).filter(Boolean).join(", ")
                : "",
            status: String(task.status?.status || ""),
        })),
        timeEntries: timeEntriesInRange.map((entry) => ({
            id: String(entry.id || ""),
            taskId: String(entry.task?.id || ""),
            hours: (Number(entry.duration) || 0) / (1000 * 60 * 60),
            assignee: String(entry.user?.username || ""),
        })),
    }), [clientId, clientName, viewMode, dateBoundary.end, dateBoundary.start, tasksInRange, timeEntriesInRange]);

    useEffect(() => {
        const requestId = ++narrativeRequestId.current;
        setIsNarrativeLoading(true);

        generateClientDashboardNarratives(narrativeInputs)
            .then((nextNarratives) => {
                if (requestId !== narrativeRequestId.current) return;
                setNarratives(nextNarratives);
            })
            .catch(() => {
                if (requestId !== narrativeRequestId.current) return;
                setNarratives({
                    detailedWorkPerformed: "Unable to generate detailed work performed for this period.",
                    valueDelivered: "Unable to generate value delivered for this period.",
                    source: "fallback",
                    generatedAt: new Date().toISOString(),
                });
            })
            .finally(() => {
                if (requestId === narrativeRequestId.current) {
                    setIsNarrativeLoading(false);
                }
            });
    }, [narrativeInputs]);

    const narrativeSourceLabel = isNarrativeLoading
        ? "Generating..."
        : narratives?.source === "llm"
            ? "LLM-assisted"
            : "Rule-based";

    const detailedWorkPerformed = isNarrativeLoading
        ? "Generating client-facing detail for the selected period..."
        : narratives?.detailedWorkPerformed || "No detailed work performed was found for this period.";

    const valueDelivered = isNarrativeLoading
        ? "Generating value summary for the selected period..."
        : narratives?.valueDelivered || "No value statement was generated for this period.";

    const narrativeGeneratedAt = narratives?.generatedAt
        ? new Date(narratives.generatedAt).toLocaleString()
        : "Not generated yet";

    const getTaskNarrative = (taskId: string) => taskNarrativeLookup.get(taskId);

    return (
        <div className="flex flex-col h-full bg-background relative overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-border shrink-0">
                <div className="flex items-center gap-4">
                    <div>
                        <h2 className="text-xl font-bold text-text-main flex items-center gap-3">
                            <select
                                value={clientId}
                                onChange={(e) => onSelectClient(e.target.value)}
                                className="bg-transparent font-bold text-xl border-none focus:ring-0 cursor-pointer hover:bg-surface rounded-md px-2 py-1 -ml-2 text-text-main"
                            >
                                {clientOptions.map((c) => (
                                    <option key={c.id} value={String(c.id)} className="text-base font-medium bg-background">
                                        {c.name}
                                    </option>
                                ))}
                            </select>
                            <span className="text-text-muted font-medium text-lg">Dashboard</span>
                        </h2>
                    </div>
                </div>
                <div className="flex gap-4 items-center">
                    <div className="flex items-center bg-surface border border-border rounded overflow-hidden">
                        <button
                            disabled={isWeekLoading}
                            onClick={handlePrevWeek}
                            className="px-2 py-1 hover:bg-surface-hover text-text-muted transition-colors disabled:opacity-50 cursor-pointer"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                            disabled={isWeekLoading}
                            onClick={handleCurrentWeek}
                            className="px-3 py-1 text-xs font-medium text-white hover:bg-surface-hover transition-colors border-l border-r border-border disabled:opacity-50 cursor-pointer"
                        >
                            {format(activeWeekDate, "MMM d, yyyy")}
                        </button>
                        <button
                            disabled={isWeekLoading}
                            onClick={handleNextWeek}
                            className="px-2 py-1 hover:bg-surface-hover text-text-muted transition-colors disabled:opacity-50 cursor-pointer"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>

                    <div className="flex items-center p-1 bg-surface rounded-lg border border-border">
                        <button
                            onClick={() => setViewMode("weekly")}
                            className={cn(
                                "px-4 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
                                viewMode === "weekly"
                                    ? "bg-primary text-white shadow-sm"
                                    : "text-text-muted hover:text-text-main hover:bg-surface-hover"
                            )}
                        >
                            Weekly
                        </button>
                        <button
                            onClick={() => setViewMode("monthly")}
                            className={cn(
                                "px-4 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
                                viewMode === "monthly"
                                    ? "bg-primary text-white shadow-sm"
                                    : "text-text-muted hover:text-text-main hover:bg-surface-hover"
                            )}
                        >
                            Monthly
                        </button>
                    </div>

                    <button
                        onClick={handleDownloadPdf}
                        disabled={isDownloading}
                        className="flex items-center gap-2 px-4 py-2 bg-text-main text-background rounded-lg text-sm font-semibold hover:bg-white transition-all disabled:opacity-50"
                    >
                        <Download className="w-4 h-4" />
                        {isDownloading ? "Generating..." : "Download PDF"}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6" ref={dashboardRef}>
                <div className="space-y-6 max-w-6xl mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                        <div className="bg-surface rounded-xl p-5 border border-border shadow-sm">
                            <h3 className="text-sm font-medium text-text-muted mb-1">Time Billed ({viewMode})</h3>
                            <div className="text-3xl font-bold text-text-main">
                                {totalBilledHours.toFixed(1)} <span className="text-lg text-text-muted font-medium">hrs</span>
                            </div>
                        </div>
                        <div className="bg-surface rounded-xl p-5 border border-border shadow-sm">
                            <h3 className="text-sm font-medium text-text-muted mb-1">In Progress</h3>
                            <div className="text-3xl font-bold text-blue-400">{categorizedTasks.inProgress.length}</div>
                        </div>
                        <div className="bg-surface rounded-xl p-5 border border-border shadow-sm">
                            <h3 className="text-sm font-medium text-text-muted mb-1">Completed</h3>
                            <div className="text-3xl font-bold text-green-400">{categorizedTasks.completed.length}</div>
                        </div>
                        <div className="bg-surface rounded-xl p-5 border border-border shadow-sm">
                            <h3 className="text-sm font-medium text-text-muted mb-1">Backlog</h3>
                            <div className="text-3xl font-bold text-orange-400">{categorizedTasks.backlog.length}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <div className="bg-surface rounded-xl border border-border shadow-sm p-5">
                            <h3 className="text-sm font-medium text-text-muted mb-2">Period</h3>
                            <div className="text-xl font-semibold text-text-main">{periodStartLabel} - {periodEndLabel}</div>
                            <div className="mt-2 text-sm text-text-muted">
                                Showing actuals-based activity for {viewMode === "monthly" ? "the full month" : "the selected week"}.
                            </div>
                        </div>
                        <div className="bg-surface rounded-xl border border-border shadow-sm p-5">
                            <h3 className="text-sm font-medium text-text-muted mb-2">Detailed Work Performed</h3>
                            <p className="text-sm leading-6 text-text-main whitespace-pre-wrap">{detailedWorkPerformed}</p>
                            <div className="mt-3 text-xs text-text-muted">
                                Source: {narrativeSourceLabel} · {narrativeGeneratedAt}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-border bg-surface p-5">
                        <h3 className="text-sm font-medium text-text-muted mb-2">Value Delivered</h3>
                        <p className="text-sm leading-6 text-text-main whitespace-pre-wrap">{valueDelivered}</p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="flex flex-col bg-surface/30 rounded-xl border border-border shadow-sm p-4 h-[600px]">
                            <h3 className="font-semibold text-text-main mb-4 flex items-center gap-2">
                                <Circle className="w-4 h-4 text-orange-400" />
                                Backlog Tasks
                            </h3>
                            <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                                {categorizedTasks.backlog.map((task) => (
                                    <div key={task.id} className="bg-surface p-3 rounded-lg border border-border/50 text-sm hover:border-orange-400/30 transition-colors">
                                        <div className="font-medium text-text-main mb-1 truncate">{task.name}</div>
                                        {(() => {
                                            const narrative = getTaskNarrative(task.id);
                                            if (!narrative) return null;
                                            return (
                                                <div className="space-y-1 mb-2">
                                                    <p className="text-xs text-text-muted whitespace-pre-wrap">{narrative.workSummary}</p>
                                                    <p className="text-xs text-emerald-200 whitespace-pre-wrap">{narrative.valueContribution}</p>
                                                </div>
                                            );
                                        })()}
                                        <div className="text-xs text-text-muted flex justify-between">
                                            <span>{Array.isArray(task.assignees) && task.assignees[0] ? task.assignees[0].username : "Unassigned"}</span>
                                            <span style={{ color: task.status.color }}>{task.status.status}</span>
                                        </div>
                                    </div>
                                ))}
                                {categorizedTasks.backlog.length === 0 && (
                                    <div className="text-sm text-text-muted italic flex items-center justify-center p-4">No backlog items.</div>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col bg-surface/30 rounded-xl border border-border shadow-sm p-4 h-[600px]">
                            <h3 className="font-semibold text-text-main mb-4 flex items-center gap-2">
                                <ArrowRight className="w-4 h-4 text-blue-400" />
                                In Progress
                            </h3>
                            <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                                {categorizedTasks.inProgress.map((task) => (
                                    <div key={task.id} className="bg-surface p-3 rounded-lg border border-border/50 text-sm hover:border-blue-400/30 transition-colors">
                                        <div className="font-medium text-text-main mb-1 truncate">{task.name}</div>
                                        {(() => {
                                            const narrative = getTaskNarrative(task.id);
                                            if (!narrative) return null;
                                            return (
                                                <div className="space-y-1 mb-2">
                                                    <p className="text-xs text-text-muted whitespace-pre-wrap">{narrative.workSummary}</p>
                                                    <p className="text-xs text-emerald-200 whitespace-pre-wrap">{narrative.valueContribution}</p>
                                                </div>
                                            );
                                        })()}
                                        <div className="text-xs text-text-muted flex justify-between">
                                            <span>{Array.isArray(task.assignees) && task.assignees[0] ? task.assignees[0].username : "Unassigned"}</span>
                                            <span style={{ color: task.status.color }}>{task.status.status}</span>
                                        </div>
                                    </div>
                                ))}
                                {categorizedTasks.inProgress.length === 0 && (
                                    <div className="text-sm text-text-muted italic flex items-center justify-center p-4">No active items.</div>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col bg-surface/30 rounded-xl border border-border shadow-sm p-4 h-[600px]">
                            <h3 className="font-semibold text-text-main mb-4 flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-400" />
                                Completed ({viewMode})
                            </h3>
                            <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pr-2">
                                {categorizedTasks.completed.map((task) => (
                                    <div key={task.id} className="bg-surface p-3 rounded-lg border border-border/50 text-sm hover:border-green-400/30 transition-colors">
                                        <div className="font-medium text-text-main mb-1 truncate">{task.name}</div>
                                        {(() => {
                                            const narrative = getTaskNarrative(task.id);
                                            if (!narrative) return null;
                                            return (
                                                <div className="space-y-1 mb-2">
                                                    <p className="text-xs text-text-muted whitespace-pre-wrap">{narrative.workSummary}</p>
                                                    <p className="text-xs text-emerald-200 whitespace-pre-wrap">{narrative.valueContribution}</p>
                                                </div>
                                            );
                                        })()}
                                        <div className="text-xs text-text-muted flex justify-between">
                                            <span>{Array.isArray(task.assignees) && task.assignees[0] ? task.assignees[0].username : "Unassigned"}</span>
                                            <span style={{ color: task.status.color }}>{task.status.status}</span>
                                        </div>
                                    </div>
                                ))}
                                {categorizedTasks.completed.length === 0 && (
                                    <div className="text-sm text-text-muted italic flex items-center justify-center p-4">No completed items.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
