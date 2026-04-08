"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { Check, ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import {
    addEditableTaskBillableEntry,
    CapacityGridPayload,
    ClientDirectoryRecord,
    deleteEditableTaskBillableEntry,
    EditableTaskBillableEntryRecord,
    EditableTaskRecord,
    EditableTaskSeed,
    getEditableTasks,
    updateEditableTaskBillableEntry,
} from "@/app/actions";
import { ClickUpTask } from "@/lib/clickup";
import { buildEditableTaskSeedFromClickUp, isEditableTaskVisibleInWeek } from "@/lib/editableTaskLifecycle";
import { cn } from "@/lib/utils";
import type { FolderWithLists } from "@/components/Sidebar";

interface TimesheetsProps {
    activeWeekStr: string;
    tasks: ClickUpTask[];
    consultants: Array<{ id: number; name: string }>;
    capacityGrid: CapacityGridPayload;
    folders?: FolderWithLists[];
    clientDirectory?: ClientDirectoryRecord[];
    initialAssigneeFilter?: string | null;
    onNavigateWeek?: (nextWeek: string) => void;
    onAssigneeFilterChange?: (assignee: string | null) => void;
    weekDataVersion?: number;
    onWeekDataRefresh?: () => Promise<void> | void;
    isWeekLoading?: boolean;
}

type TimesheetTaskRow = {
    task: EditableTaskRecord;
    clientId: string;
    clientLabel: string;
    dayEntriesByDate: Record<string, EditableTaskBillableEntryRecord[]>;
    dayHoursByDate: Record<string, number>;
    dayPrimaryEntryByDate: Record<string, EditableTaskBillableEntryRecord | null>;
    totalActuals: number;
};

type TimesheetCellDraft = {
    hours: string;
    note: string;
};

type TimesheetCellNoteEditorState = {
    taskId: string;
    dateKey: string;
    taskSubject: string;
    dateLabel: string;
    note: string;
};

type ClientGroup = {
    clientId: string;
    clientLabel: string;
    plannedHours: number;
    actualsHours: number;
    remainingHours: number;
    actualsByDate: Record<string, number>;
    tasks: TimesheetTaskRow[];
};

function normalizeName(value: string) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function formatInputHours(value: number) {
    if (!Number.isFinite(value) || Math.abs(value) < 0.001) return "";
    return String(Number(value.toFixed(2)));
}

function buildSeedTasks(tasks: ClickUpTask[], activeWeekStr: string): EditableTaskSeed[] {
    return tasks
        .map((task) => buildEditableTaskSeedFromClickUp(task, activeWeekStr))
        .filter((task) => isEditableTaskVisibleInWeek(task, activeWeekStr));
}

function getTaskScopeCandidates(task: ClickUpTask | null) {
    return [
        String(task?.list?.id ?? "").trim(),
        String(task?.list?.name ?? "").trim(),
        String(task?.project?.name ?? "").trim(),
        String(task?.folder?.name ?? "").trim(),
    ].filter(Boolean);
}

function getDayHours(entries: EditableTaskBillableEntryRecord[]) {
    return entries.reduce((sum, entry) => sum + Number(entry.hours ?? 0), 0);
}

function getPrimaryDayEntry(entries: EditableTaskBillableEntryRecord[]) {
    return entries[0] ?? null;
}

function buildWeekdays(activeWeekStr: string) {
    const start = new Date(`${activeWeekStr}T00:00:00`);
    return Array.from({ length: 5 }, (_, index) => {
        const date = addDays(start, index);
        return {
            key: format(date, "yyyy-MM-dd"),
            shortLabel: format(date, "EEE"),
            dateLabel: format(date, "MMM d"),
        };
    });
}

export function Timesheets({
    activeWeekStr,
    tasks,
    consultants,
    capacityGrid,
    folders = [],
    clientDirectory = [],
    initialAssigneeFilter = null,
    onNavigateWeek,
    onAssigneeFilterChange,
    weekDataVersion = 0,
    onWeekDataRefresh,
    isWeekLoading = false,
}: TimesheetsProps) {
    const router = useRouter();
    const [editableTasks, setEditableTasks] = useState<EditableTaskRecord[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [selectedConsultant, setSelectedConsultant] = useState<string>(initialAssigneeFilter || consultants[0]?.name || "");
    const [cellDrafts, setCellDrafts] = useState<Record<string, Record<string, TimesheetCellDraft>>>({});
    const [noteEditor, setNoteEditor] = useState<TimesheetCellNoteEditorState | null>(null);
    const [savingTaskId, setSavingTaskId] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const activeWeekDate = useMemo(() => new Date(`${activeWeekStr}T00:00:00`), [activeWeekStr]);
    const weekLabel = `${format(activeWeekDate, "MM/dd")} to ${format(addDays(activeWeekDate, 4), "MM/dd")}`;
    const weekRangeLabel = `${format(activeWeekDate, "MMM d")} to ${format(addDays(activeWeekDate, 4), "MMM d")}`;
    const weekNumber = format(activeWeekDate, "II");
    const weekdays = useMemo(() => buildWeekdays(activeWeekStr), [activeWeekStr]);

    const consultantOptions = useMemo(
        () => Array.from(new Set(
            [
                ...consultants.map((consultant) => String(consultant.name || "").trim()),
                ...editableTasks.map((task) => String(task.assignee || "").trim()),
            ].filter(Boolean)
        )).sort((a, b) => a.localeCompare(b)),
        [consultants, editableTasks]
    );

    useEffect(() => {
        if (!selectedConsultant && consultantOptions[0]) {
            setSelectedConsultant(consultantOptions[0]);
            return;
        }
        if (selectedConsultant && !consultantOptions.includes(selectedConsultant) && consultantOptions[0]) {
            setSelectedConsultant(consultantOptions[0]);
        }
    }, [consultantOptions, selectedConsultant]);

    useEffect(() => {
        if (!initialAssigneeFilter) return;
        if (consultantOptions.includes(initialAssigneeFilter)) {
            setSelectedConsultant(initialAssigneeFilter);
        }
    }, [consultantOptions, initialAssigneeFilter]);

    const seedTasks = useMemo(() => buildSeedTasks(tasks, activeWeekStr), [tasks, activeWeekStr]);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        (async () => {
            const rows = await getEditableTasks(activeWeekStr, "all", "all", seedTasks);
            if (cancelled) return;
            setEditableTasks(rows);
            setIsLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [activeWeekStr, seedTasks, weekDataVersion]);

    const sourceTaskById = useMemo(() => {
        const byId = new Map<string, ClickUpTask>();
        tasks.forEach((task) => {
            const id = String(task?.id ?? "").trim();
            if (!id) return;
            byId.set(id, task);
        });
        return byId;
    }, [tasks]);

    const clientDirectoryLookup = useMemo(() => {
        const byId = new Map<string, ClientDirectoryRecord>();
        const byName = new Map<string, ClientDirectoryRecord>();
        clientDirectory.forEach((client) => {
            const id = String(client?.id ?? "").trim();
            const name = String(client?.name ?? "").trim();
            if (id) byId.set(id, client);
            if (name) byName.set(normalizeName(name), client);
        });
        return { byId, byName };
    }, [clientDirectory]);

    const boardClientByScope = useMemo(() => {
        const byListId = new Map<string, { clientId: string; clientName: string }>();
        const byListName = new Map<string, { clientId: string; clientName: string }>();
        folders.forEach((folder) => {
            folder.lists.forEach((list) => {
                const clientId = String(list.clientId ?? "").trim();
                const clientName = String(list.clientName ?? "").trim() || String(list.name ?? "").trim();
                const listId = String(list.id ?? "").trim();
                const listName = String(list.name ?? "").trim();
                if (clientId && listId) byListId.set(listId, { clientId, clientName });
                if (clientName && listName) byListName.set(normalizeName(listName), { clientId: clientId || clientName, clientName });
            });
        });
        return { byListId, byListName };
    }, [folders]);

    const visibleTasks = useMemo(() => {
        const selectedKey = normalizeName(selectedConsultant);
        return editableTasks
            .filter((task) => normalizeName(task.assignee) === selectedKey)
            .filter((task) => task.status === "open")
            .sort((a, b) => a.subject.localeCompare(b.subject));
    }, [editableTasks, selectedConsultant]);

    const capacityRows = useMemo(
        () => Array.isArray(capacityGrid?.rows) ? capacityGrid.rows : [],
        [capacityGrid]
    );

    const plannedHoursByClient = useMemo(() => {
        const selectedKey = normalizeName(selectedConsultant);
        const resources = Array.isArray(capacityGrid?.resources) ? capacityGrid.resources : [];
        const matchedResource = resources.find((resource) => normalizeName(String(resource?.name ?? "")) === selectedKey);
        if (!matchedResource) return new Map<string, number>();

        const nextMap = new Map<string, number>();
        capacityRows.forEach((row) => {
            const clientId = String(row?.id ?? "").trim();
            const clientLabel = String(row?.client ?? "").trim();
            const hours = Number(row?.allocations?.[matchedResource.id]?.hours ?? 0);
            if (hours <= 0) return;
            if (clientId) nextMap.set(clientId, Number(((nextMap.get(clientId) ?? 0) + hours).toFixed(1)));
            if (clientLabel) {
                const fallbackKey = `name:${normalizeName(clientLabel)}`;
                nextMap.set(fallbackKey, Number(((nextMap.get(fallbackKey) ?? 0) + hours).toFixed(1)));
            }
        });
        return nextMap;
    }, [capacityGrid, capacityRows, selectedConsultant]);

    const resolveClientMeta = useMemo(() => {
        return (task: ClickUpTask | null) => {
            const listId = String(task?.list?.id ?? "").trim();
            const directBoardMatch = listId ? boardClientByScope.byListId.get(listId) : null;
            if (directBoardMatch) {
                const canonicalClient = clientDirectoryLookup.byId.get(directBoardMatch.clientId);
                return {
                    clientId: directBoardMatch.clientId,
                    clientLabel: canonicalClient?.name || directBoardMatch.clientName,
                };
            }

            const candidates = getTaskScopeCandidates(task);
            for (const candidate of candidates) {
                const normalized = normalizeName(candidate);
                const boardMatch = boardClientByScope.byListName.get(normalized);
                if (boardMatch) {
                    const canonicalClient = clientDirectoryLookup.byId.get(boardMatch.clientId);
                    return {
                        clientId: boardMatch.clientId,
                        clientLabel: canonicalClient?.name || boardMatch.clientName,
                    };
                }
                const directoryMatch = clientDirectoryLookup.byName.get(normalized);
                if (directoryMatch) {
                    return {
                        clientId: directoryMatch.id,
                        clientLabel: directoryMatch.name,
                    };
                }
            }

            const firstLabel = candidates[1] || candidates[2] || candidates[3] || "Unassigned Client";
            return {
                clientId: `name:${normalizeName(firstLabel) || "unassigned-client"}`,
                clientLabel: firstLabel,
            };
        };
    }, [boardClientByScope.byListId, boardClientByScope.byListName, clientDirectoryLookup.byId, clientDirectoryLookup.byName]);

    const taskRows = useMemo<TimesheetTaskRow[]>(() => {
        return visibleTasks
            .map((task) => {
                const sourceTask = task.sourceTaskId ? sourceTaskById.get(String(task.sourceTaskId)) ?? null : null;
                const clientMeta = resolveClientMeta(sourceTask);
                const dayEntriesByDate = weekdays.reduce<Record<string, EditableTaskBillableEntryRecord[]>>((acc, weekday) => {
                    acc[weekday.key] = (task.billableEntries || [])
                        .filter((entry) => entry.entryDate === weekday.key)
                        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
                    return acc;
                }, {});
                const dayHoursByDate = weekdays.reduce<Record<string, number>>((acc, weekday) => {
                    acc[weekday.key] = Number(getDayHours(dayEntriesByDate[weekday.key] || []).toFixed(2));
                    return acc;
                }, {});
                const dayPrimaryEntryByDate = weekdays.reduce<Record<string, EditableTaskBillableEntryRecord | null>>((acc, weekday) => {
                    acc[weekday.key] = getPrimaryDayEntry(dayEntriesByDate[weekday.key] || []);
                    return acc;
                }, {});
                const totalActuals = weekdays.reduce((sum, weekday) => sum + Number(dayHoursByDate[weekday.key] ?? 0), 0);

                return {
                    task,
                    clientId: clientMeta.clientId,
                    clientLabel: clientMeta.clientLabel,
                    dayEntriesByDate,
                    dayHoursByDate,
                    dayPrimaryEntryByDate,
                    totalActuals: Number(totalActuals.toFixed(2)),
                };
            })
            .sort((a, b) => {
                const clientCompare = a.clientLabel.localeCompare(b.clientLabel);
                if (clientCompare !== 0) return clientCompare;
                return a.task.subject.localeCompare(b.task.subject);
            });
    }, [resolveClientMeta, sourceTaskById, visibleTasks, weekdays]);

    useEffect(() => {
        setCellDrafts((current) => {
            const next: Record<string, Record<string, TimesheetCellDraft>> = {};
            taskRows.forEach((row) => {
                next[row.task.id] = weekdays.reduce<Record<string, TimesheetCellDraft>>((draft, weekday) => {
                    const primaryEntry = row.dayPrimaryEntryByDate[weekday.key];
                    const currentDraft = current[row.task.id]?.[weekday.key];
                    draft[weekday.key] = currentDraft ?? {
                        hours: formatInputHours(row.dayHoursByDate[weekday.key] ?? 0),
                        note: String(primaryEntry?.note ?? ""),
                    };
                    return draft;
                }, {});
            });
            return next;
        });
    }, [taskRows, weekdays]);

    const clientGroups = useMemo<ClientGroup[]>(() => {
        const groups = new Map<string, ClientGroup>();

        taskRows.forEach((row) => {
            const plannedHours = Number(
                plannedHoursByClient.get(row.clientId)
                ?? plannedHoursByClient.get(`name:${normalizeName(row.clientLabel)}`)
                ?? 0
            );
            const existing = groups.get(row.clientId) ?? {
                clientId: row.clientId,
                clientLabel: row.clientLabel,
                plannedHours,
                actualsHours: 0,
                remainingHours: 0,
                actualsByDate: weekdays.reduce<Record<string, number>>((acc, weekday) => {
                    acc[weekday.key] = 0;
                    return acc;
                }, {}),
                tasks: [],
            };

            existing.actualsHours += row.totalActuals;
            weekdays.forEach((weekday) => {
                existing.actualsByDate[weekday.key] = Number(
                    (existing.actualsByDate[weekday.key] + Number(row.dayHoursByDate[weekday.key] ?? 0)).toFixed(2)
                );
            });
            existing.tasks.push(row);
            groups.set(row.clientId, existing);
        });

        return Array.from(groups.values())
            .map((group) => ({
                ...group,
                actualsHours: Number(group.actualsHours.toFixed(2)),
                remainingHours: Number(Math.max(0, group.plannedHours - group.actualsHours).toFixed(2)),
                tasks: group.tasks.sort((a, b) => a.task.subject.localeCompare(b.task.subject)),
            }))
            .sort((a, b) => a.clientLabel.localeCompare(b.clientLabel));
    }, [plannedHoursByClient, taskRows, weekdays]);

    const overallSummary = useMemo(() => {
        const plannedHours = clientGroups.reduce((sum, group) => sum + Number(group.plannedHours ?? 0), 0);
        const actualsHours = clientGroups.reduce((sum, group) => sum + Number(group.actualsHours ?? 0), 0);
        return {
            plannedHours: Number(plannedHours.toFixed(1)),
            actualsHours: Number(actualsHours.toFixed(1)),
            remainingHours: Number(Math.max(0, plannedHours - actualsHours).toFixed(1)),
        };
    }, [clientGroups]);

    const handleCellChange = (taskId: string, dateKey: string, value: string) => {
        const cleaned = value.replace(/[^0-9.]/g, "");
        setCellDrafts((prev) => ({
            ...prev,
            [taskId]: {
                ...(prev[taskId] ?? {}),
                [dateKey]: {
                    ...(prev[taskId]?.[dateKey] ?? { note: "" }),
                    hours: cleaned,
                },
            },
        }));
    };

    const getSuggestedHours = (group: ClientGroup, dateKey: string) => {
        const currentDayHours = Number(group.actualsByDate[dateKey] ?? 0);
        if (currentDayHours > 0) return Number(currentDayHours.toFixed(1));

        const populatedDayValues = weekdays
            .map((weekday) => Number(group.actualsByDate[weekday.key] ?? 0))
            .filter((hours) => hours > 0.05);
        const emptyDayCount = weekdays.filter((weekday) => Number(group.actualsByDate[weekday.key] ?? 0) <= 0.05).length;
        if (group.remainingHours <= 0.05) return 0;

        if (populatedDayValues.length > 0) {
            const average = populatedDayValues.reduce((sum, hours) => sum + hours, 0) / populatedDayValues.length;
            const evenSpread = group.remainingHours / Math.max(1, emptyDayCount);
            return Number(Math.min(group.remainingHours, average, evenSpread).toFixed(1));
        }

        return Number((group.remainingHours / Math.max(1, emptyDayCount)).toFixed(1));
    };

    const applySuggestedHours = (taskId: string, dateKey: string, suggestedHours: number) => {
        if (suggestedHours <= 0) return;
        setCellDrafts((prev) => ({
            ...prev,
            [taskId]: {
                ...(prev[taskId] ?? {}),
                [dateKey]: {
                    ...(prev[taskId]?.[dateKey] ?? { note: "" }),
                    hours: formatInputHours(suggestedHours),
                },
            },
        }));
    };

    const openNoteEditor = (row: TimesheetTaskRow, dateKey: string) => {
        const weekday = weekdays.find((day) => day.key === dateKey);
        const draft = cellDrafts[row.task.id]?.[dateKey];
        setNoteEditor({
            taskId: row.task.id,
            dateKey,
            taskSubject: row.task.subject,
            dateLabel: weekday ? `${weekday.shortLabel} ${weekday.dateLabel}` : dateKey,
            note: String(draft?.note ?? ""),
        });
    };

    const saveNoteEditor = () => {
        if (!noteEditor) return;
        setCellDrafts((prev) => ({
            ...prev,
            [noteEditor.taskId]: {
                ...(prev[noteEditor.taskId] ?? {}),
                [noteEditor.dateKey]: {
                    ...(prev[noteEditor.taskId]?.[noteEditor.dateKey] ?? { hours: "" }),
                    note: noteEditor.note,
                },
            },
        }));
        setNoteEditor(null);
    };

    const taskHasChanges = (row: TimesheetTaskRow) => {
        return weekdays.some((weekday) => {
            const draft = cellDrafts[row.task.id]?.[weekday.key];
            const draftValue = Number(draft?.hours || 0);
            const currentValue = Number(row.dayHoursByDate[weekday.key] ?? 0);
            const currentEntry = row.dayPrimaryEntryByDate[weekday.key];
            const currentNote = String(currentEntry?.note ?? "");
            return (
                Math.abs(draftValue - currentValue) > 0.01
                || String(draft?.note ?? "") !== currentNote
            );
        });
    };

    const refreshEditableTasks = async () => {
        const rows = await getEditableTasks(activeWeekStr, "all", "all", seedTasks);
        setEditableTasks(rows);
        await onWeekDataRefresh?.();
    };

    const handleSaveRow = (row: TimesheetTaskRow) => {
        startTransition(async () => {
            setSavingTaskId(row.task.id);
            try {
                for (const weekday of weekdays) {
                    const draft = cellDrafts[row.task.id]?.[weekday.key];
                    const draftValue = Number(draft?.hours || 0);
                    const targetHours = Number.isFinite(draftValue) ? Number(draftValue.toFixed(2)) : 0;
                    const currentEntries = row.dayEntriesByDate[weekday.key] || [];
                    const currentTotal = Number(getDayHours(currentEntries).toFixed(2));
                    const primaryEntry = row.dayPrimaryEntryByDate[weekday.key];
                    const note = String(draft?.note ?? "");
                    const noteChanged = note !== String(primaryEntry?.note ?? "");
                    const hoursChanged = Math.abs(targetHours - currentTotal) > 0.01;
                    if (!hoursChanged && !noteChanged) continue;

                    if (targetHours <= 0.01) {
                        for (const entry of currentEntries) {
                            await deleteEditableTaskBillableEntry(entry.id);
                        }
                        continue;
                    }

                    if (currentEntries.length === 0) {
                        await addEditableTaskBillableEntry({
                            taskId: row.task.id,
                            entryDate: weekday.key,
                            hours: targetHours,
                            note,
                        });
                        continue;
                    }

                    const [primary, ...duplicates] = currentEntries;
                    if (primary) {
                        await updateEditableTaskBillableEntry(primary.id, {
                            hours: targetHours,
                            note,
                        });
                    }
                    for (const entry of duplicates) {
                        await deleteEditableTaskBillableEntry(entry.id);
                    }
                }

                await refreshEditableTasks();
            } finally {
                setSavingTaskId(null);
            }
        });
    };

    return (
        <section className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3 flex-wrap rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(21,26,43,0.96)_0%,rgba(13,18,29,0.96)_100%)] px-5 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
                <div className="flex items-center gap-4 flex-wrap">
                    <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Timesheets
                    </h2>
                    <div className="flex items-center overflow-hidden rounded-xl border border-border/60 bg-[#0f1320]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                        <button
                            onClick={() => {
                                const nextWeek = format(subWeeks(activeWeekDate, 1), "yyyy-MM-dd");
                                if (onNavigateWeek) {
                                    onNavigateWeek(nextWeek);
                                } else {
                                    router.push(`/?week=${nextWeek}&tab=timesheets`, { scroll: false });
                                }
                            }}
                            disabled={!onNavigateWeek && isWeekLoading}
                            aria-label="Previous week"
                            className="flex h-10 w-10 items-center justify-center border-r border-border/60 text-text-muted transition-colors hover:bg-surface-hover hover:text-white disabled:opacity-50"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="min-w-[220px] px-4 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Week W{weekNumber}</div>
                            <div className="mt-1 text-sm font-semibold text-white">{weekRangeLabel}</div>
                        </div>
                        <button
                            onClick={() => {
                                const nextWeek = format(addWeeks(activeWeekDate, 1), "yyyy-MM-dd");
                                if (onNavigateWeek) {
                                    onNavigateWeek(nextWeek);
                                } else {
                                    router.push(`/?week=${nextWeek}&tab=timesheets`, { scroll: false });
                                }
                            }}
                            disabled={!onNavigateWeek && isWeekLoading}
                            aria-label="Next week"
                            className="flex h-10 w-10 items-center justify-center border-l border-border/60 text-text-muted transition-colors hover:bg-surface-hover hover:text-white disabled:opacity-50"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    <span className="rounded-full border border-border/50 bg-surface/20 px-3 py-1 text-xs text-text-muted">{weekLabel}</span>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2 text-xs text-text-muted">
                        <span>Consultant</span>
                        <select
                            value={selectedConsultant}
                            onChange={(event) => {
                                const nextConsultant = event.target.value;
                                setSelectedConsultant(nextConsultant);
                                onAssigneeFilterChange?.(nextConsultant || null);
                            }}
                            className="rounded-md border border-border bg-surface/30 px-3 py-2 text-xs text-white outline-none focus:border-primary"
                        >
                            {consultantOptions.map((name) => (
                                <option key={name} value={name}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <span className="rounded-full border border-border/50 bg-surface/20 px-3 py-1 text-[11px] text-text-muted">
                        {isWeekLoading ? "Loading..." : isLoading ? "Loading tasks..." : isPending ? "Saving..." : `${taskRows.length} active tasks · ${overallSummary.remainingHours.toFixed(1)}h remaining`}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] px-5 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Planned This Week</div>
                    <div className="mt-2 text-4xl font-bold text-white">{overallSummary.plannedHours.toFixed(1)}</div>
                </div>
                <div className="rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] px-5 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Actuals This Week</div>
                    <div className="mt-2 text-4xl font-bold text-white">{overallSummary.actualsHours.toFixed(1)}</div>
                </div>
                <div className="rounded-[24px] border border-primary/30 bg-[linear-gradient(180deg,rgba(29,39,69,0.98)_0%,rgba(16,24,44,0.98)_100%)] px-5 py-5 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Remaining Planned</div>
                    <div className="mt-2 text-5xl font-bold text-white">{overallSummary.remainingHours.toFixed(1)}</div>
                    <div className="mt-2 text-xs text-text-muted">Grouped by client, with Monday through Friday entry cells per task.</div>
                </div>
            </div>

            <div className="rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] px-5 py-4 text-xs text-text-muted shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                This grid uses the Plan vs Actuals client plan as the weekly target, groups tasks under their canonical client, and suggests weekday entries from each client&apos;s current actual pattern.
            </div>

            {clientGroups.length === 0 && (
                <div className="rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] px-6 py-12 text-center text-sm text-text-muted shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
                    {selectedConsultant
                        ? `No active timesheet tasks found for ${selectedConsultant} in this week.`
                        : "Select a consultant to view timesheets."}
                </div>
            )}

            <div className="space-y-5">
                {clientGroups.map((group) => (
                    <div
                        key={group.clientId}
                        className="overflow-hidden rounded-[28px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] shadow-[0_24px_70px_rgba(0,0,0,0.28)]"
                    >
                        <div className="border-b border-border/40 px-5 py-4">
                            <div className="flex items-center justify-between gap-4 flex-wrap">
                                <div>
                                    <div className="text-lg font-semibold text-white">{group.clientLabel}</div>
                                    <div className="mt-1 text-xs text-text-muted">{group.tasks.length} active task{group.tasks.length === 1 ? "" : "s"} for {selectedConsultant || "this consultant"}</div>
                                </div>
                                <div className="flex items-center gap-3 flex-wrap">
                                    <div className="rounded-xl border border-border/50 bg-background/30 px-4 py-2">
                                        <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Planned</div>
                                        <div className="mt-1 text-xl font-semibold text-white">{group.plannedHours.toFixed(1)}</div>
                                    </div>
                                    <div className="rounded-xl border border-border/50 bg-background/30 px-4 py-2">
                                        <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Actuals</div>
                                        <div className="mt-1 text-xl font-semibold text-white">{group.actualsHours.toFixed(1)}</div>
                                    </div>
                                    <div className="rounded-xl border border-primary/30 bg-primary/10 px-4 py-2">
                                        <div className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Remaining</div>
                                        <div className="mt-1 text-2xl font-semibold text-white">{group.remainingHours.toFixed(1)}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="min-w-[1120px] w-full border-collapse text-[12px]">
                                <thead>
                                    <tr className="border-b border-border/40 bg-[#13192b]/80 text-[11px] uppercase tracking-[0.16em] text-text-muted">
                                        <th className="px-4 py-3 text-left min-w-[260px]">Task</th>
                                        {weekdays.map((weekday) => (
                                            <th key={weekday.key} className="px-3 py-3 text-center min-w-[140px]">
                                                <div className="text-white">{weekday.shortLabel}</div>
                                                <div className="mt-1 text-[10px] text-text-muted">{weekday.dateLabel}</div>
                                            </th>
                                        ))}
                                        <th className="px-3 py-3 text-right min-w-[110px]">Actuals</th>
                                        <th className="px-3 py-3 text-center min-w-[110px]">Save</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/30">
                                    {group.tasks.map((row, index) => {
                                        const rowChanged = taskHasChanges(row);
                                        return (
                                            <tr key={row.task.id} className={index % 2 === 0 ? "bg-[#0d121d]/68" : "bg-[#101622]/74"}>
                                                <td className="px-4 py-4 align-top">
                                                    <div className="text-sm font-semibold text-white">{row.task.subject}</div>
                                                    <div className="mt-1 text-[11px] uppercase tracking-[0.16em] text-text-muted">{row.task.status}</div>
                                                </td>
                                                {weekdays.map((weekday) => {
                                                    const cellDraft = cellDrafts[row.task.id]?.[weekday.key] ?? { hours: "", note: "" };
                                                    const draftValue = cellDraft.hours;
                                                    const suggestion = getSuggestedHours(group, weekday.key);
                                                    const hasExistingActuals = Number(row.dayHoursByDate[weekday.key] ?? 0) > 0.01;
                                                    return (
                                                        <td key={`${row.task.id}-${weekday.key}`} className="px-3 py-3 align-top">
                                                            <div
                                                                className={cn(
                                                                    "rounded-2xl border bg-background/35 p-2.5 transition-colors",
                                                                    cellDraft.note ? "border-primary/40" : "border-border/50"
                                                                )}
                                                                onDoubleClick={() => openNoteEditor(row, weekday.key)}
                                                            >
                                                                <input
                                                                    type="text"
                                                                    inputMode="decimal"
                                                                    value={draftValue}
                                                                    onChange={(event) => handleCellChange(row.task.id, weekday.key, event.target.value)}
                                                                    placeholder="0.0"
                                                                    className="w-full rounded-lg border border-border/60 bg-[#0f1320] px-3 py-2 text-right text-sm font-semibold text-white outline-none transition-colors focus:border-primary"
                                                                />
                                                                <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-text-muted">
                                                                    <span>{hasExistingActuals ? `Current ${Number(row.dayHoursByDate[weekday.key] ?? 0).toFixed(1)}h` : "Empty"}</span>
                                                                    {!hasExistingActuals && suggestion > 0 && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => applySuggestedHours(row.task.id, weekday.key, suggestion)}
                                                                            className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/15"
                                                                        >
                                                                            <Sparkles className="h-2.5 w-2.5" />
                                                                            {suggestion.toFixed(1)}h
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => openNoteEditor(row, weekday.key)}
                                                                    className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-border/40 bg-[#0f1320]/60 px-2.5 py-1.5 text-[10px] font-medium text-text-muted hover:border-primary/30 hover:text-white"
                                                                >
                                                                    {cellDraft.note ? "Edit Comment" : "Add Comment"}
                                                                </button>
                                                            </div>
                                                        </td>
                                                    );
                                                })}
                                                <td className="px-3 py-3 text-right align-middle">
                                                    <div className="text-base font-semibold text-white">{row.totalActuals.toFixed(1)}</div>
                                                </td>
                                                <td className="px-3 py-3 align-middle">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSaveRow(row)}
                                                        disabled={isPending || savingTaskId === row.task.id || !rowChanged}
                                                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border/60 bg-surface/25 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-45"
                                                    >
                                                        <Check className="h-3.5 w-3.5" />
                                                        {savingTaskId === row.task.id ? "Saving" : "Save"}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ))}
            </div>
            {noteEditor && (
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                        <div className="flex items-center justify-between border-b border-border/50 bg-[#151a2b] px-5 py-4">
                            <div>
                                <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Timesheet Comment</div>
                                <div className="mt-1 text-base font-semibold text-white">{noteEditor.taskSubject}</div>
                                <div className="mt-1 text-xs text-text-muted">{noteEditor.dateLabel}</div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setNoteEditor(null)}
                                className="inline-flex items-center justify-center rounded-md border border-border/60 p-2 text-text-muted hover:bg-surface-hover hover:text-white"
                                aria-label="Close note editor"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="space-y-4 bg-[linear-gradient(180deg,#0f1424_0%,#0d121d_100%)] p-5">
                            <textarea
                                value={noteEditor.note}
                                onChange={(event) => setNoteEditor((prev) => prev ? { ...prev, note: event.target.value } : prev)}
                                rows={10}
                                placeholder="Add timesheet context, blockers, or follow-up detail for this day."
                                className="min-h-[240px] w-full resize-none rounded-xl border border-border/60 bg-[#0f1320] px-4 py-4 text-sm leading-7 text-white outline-none placeholder:text-text-muted focus:border-border/80"
                                autoFocus
                            />
                            <div className="text-[11px] text-text-muted">
                                Double-click any timesheet cell to edit its comment.
                            </div>
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setNoteEditor(null)}
                                className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={saveNoteEditor}
                                className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/15 px-3 py-2 text-sm font-medium text-white hover:bg-primary/25"
                            >
                                Save Comment
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
