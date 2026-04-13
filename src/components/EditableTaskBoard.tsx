"use client";

import { useEffect, useMemo, useState, useTransition, type FocusEvent } from "react";
import { useRouter } from "next/navigation";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import { ChevronLeft, ChevronRight, GripVertical, Plus, Save, Trash2, Upload, X } from "lucide-react";
import {
    addEditableTaskBillableEntry,
    createEditableTask,
    deleteEditableTaskBillableEntry,
    deleteEditableTaskAttachment,
    EditableTaskAttachmentRecord,
    EditableTaskBillableEntryRecord,
    deleteEditableTask,
    EditableTaskRecord,
    EditableTaskSeed,
    getEditableTasks,
    removeTaskSidebarFolder,
    removeTaskSidebarBoard,
    updateEditableTask,
    updateEditableTaskBillableEntry,
} from "@/app/actions";
import { ImportedTask } from "@/lib/imported-data";
import {
    buildEditableTaskSeedFromImportedTask,
    getEffectiveEditableTaskStatus,
    isEditableTaskVisibleInWeek,
    normalizeDateKey,
} from "@/lib/editableTaskLifecycle";
import { cn } from "@/lib/utils";

interface EditableTaskBoardProps {
    activeWeekStr: string;
    tasks: ImportedTask[];
    scopeType: "all" | "list" | "folder";
    scopeId: string;
    scopeName: string;
    scopeParentFolderId?: string | null;
    assigneeOptions?: string[];
    initialAssigneeFilter?: string | null;
    tabId?: string;
    onNavigateWeek?: (nextWeek: string) => void;
    onAssigneeFilterChange?: (assignee: string | null) => void;
    weekDataVersion?: number;
    onWeekDataRefresh?: () => Promise<void> | void;
}

type EditableStatus = "backlog" | "open" | "closed";

type EditableTaskFormState = {
    id: string;
    isDraft: boolean;
    subject: string;
    description: string;
    assignee: string;
    isAi: boolean;
    /** When true, NetSuite time entries are billable unless the actuals line is marked value-add. */
    isBillable: boolean;
    week: string;
    plannedWeek: string;
    closedDate: string;
    estimateHours: number;
    status: EditableStatus;
};

type TaskEditorTab = "details" | "billable";

type BillableEntryDraft = {
    entryDate: string;
    hours: string;
    note: string;
    /** Maps to DB isValueAdd — when true, hours are non-billable in NetSuite. */
    isValueAdd: boolean;
};

const STATUS_COLUMNS: Array<{ id: EditableStatus; label: string }> = [
    { id: "backlog", label: "Backlog" },
    { id: "open", label: "Open" },
    { id: "closed", label: "Closed" },
];

const NEW_TASK_DRAFT_ID = "draft:new-task";

function defaultBillableForTeamScope(_scopeType: EditableTaskBoardProps["scopeType"]): boolean {
    return true;
}

function sanitizeDecimalDraft(value: string) {
    const sanitized = String(value || "").replace(/[^0-9.]/g, "");
    const firstDotIndex = sanitized.indexOf(".");
    if (firstDotIndex === -1) return sanitized;
    return `${sanitized.slice(0, firstDotIndex + 1)}${sanitized.slice(firstDotIndex + 1).replace(/\./g, "")}`;
}

function formatEditableNumber(value: number | string | null | undefined) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? String(numeric) : "";
}

function selectInputValueOnFocus(event: FocusEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    requestAnimationFrame(() => {
        input.select();
    });
}

function normalizeScopeValue(value: string): string {
    return String(value || "").trim().toLowerCase();
}

function getClientLabelForTask(task: ImportedTask): string {
    const listName = String(task?.list?.name ?? "").trim();
    const projectName = String(task?.project?.name ?? "").trim();
    const folderName = String(task?.folder?.name ?? "").trim();
    return listName || projectName || folderName || "Unassigned Client";
}

function filterTasksByScope(
    tasks: ImportedTask[],
    scopeType: "all" | "list" | "folder",
    scopeId: string,
    scopeName: string
) {
    const normalizedScopeId = String(scopeId || "").trim();
    const normalizedScopeName = normalizeScopeValue(scopeName);

    if (scopeType === "list") {
        return tasks.filter((task) => {
            const listId = String(task?.list?.id ?? "").trim();
            const projectId = String(task?.project?.id ?? "").trim();
            const listName = normalizeScopeValue(task?.list?.name ?? "");
            const projectName = normalizeScopeValue(task?.project?.name ?? "");
            return (
                listId === normalizedScopeId ||
                projectId === normalizedScopeId ||
                (normalizedScopeName.length > 0 && (listName === normalizedScopeName || projectName === normalizedScopeName))
            );
        });
    }
    if (scopeType === "folder") {
        return tasks.filter((task) => {
            const folderId = String(task?.folder?.id ?? "").trim();
            const folderName = normalizeScopeValue(task?.folder?.name ?? "");
            return (
                folderId === normalizedScopeId ||
                (normalizedScopeName.length > 0 && folderName === normalizedScopeName)
            );
        });
    }
    return tasks;
}

function buildSeedTasks(
    tasks: ImportedTask[],
    activeWeekStr: string
): EditableTaskSeed[] {
    return tasks.map((task) => buildEditableTaskSeedFromImportedTask(task, activeWeekStr));
}

function toWeekStart(value: string): string {
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return format(startOfWeek(parsed, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

function normalizeEstimateHours(value: number | string | null | undefined): number {
    const normalized = Number(value ?? 0);
    if (!Number.isFinite(normalized)) return 0;
    return Number(Math.max(0, normalized).toFixed(2));
}

function getDefaultBillableEntryDate(activeWeekStr: string): string {
    const start = new Date(`${activeWeekStr}T00:00:00`);
    const end = addDays(start, 4);
    const today = new Date();
    const todayKey = format(today, "yyyy-MM-dd");
    if (today >= start && today <= end) return todayKey;
    return activeWeekStr;
}

function getDefaultClosedDate(activeWeekStr: string): string {
    const start = new Date(`${activeWeekStr}T00:00:00`);
    const end = addDays(start, 6);
    const today = new Date();
    if (today >= start && today <= end) {
        return format(today, "yyyy-MM-dd");
    }
    return activeWeekStr;
}

function getTaskWeeklyBillableHours(task: EditableTaskRecord): number {
    return (task.billableEntries || []).reduce((sum, entry) => sum + Number(entry.hours ?? 0), 0);
}

function buildWeekNavigationHref(nextWeekStr: string, tabId: string): string {
    const params = new URLSearchParams(window.location.search);
    params.set("week", nextWeekStr);
    params.set("tab", tabId);
    return `/?${params.toString()}`;
}

function buildAssigneeFilterHref(assignee: string | null, tabId: string): string {
    const params = new URLSearchParams(window.location.search);
    params.set("tab", tabId);
    if (assignee && assignee.trim().length > 0) {
        params.set("assignee", assignee.trim());
    } else {
        params.delete("assignee");
    }
    return `/?${params.toString()}`;
}

function getTaskClientDisplayLabel(
    task: EditableTaskRecord,
    scopeType: "all" | "list" | "folder",
    scopeName: string,
    taskClientLabelBySourceTaskId: Map<string, string>
): string {
    if (scopeType !== "all") return scopeName;
    if (!task.sourceTaskId) return scopeName;
    return taskClientLabelBySourceTaskId.get(String(task.sourceTaskId)) ?? scopeName;
}

function formatAttachmentSize(sizeBytes: number) {
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EditableTaskBoard({
    activeWeekStr,
    tasks,
    scopeType,
    scopeId,
    scopeName,
    scopeParentFolderId = null,
    assigneeOptions = [],
    initialAssigneeFilter = null,
    tabId = "issues",
    onNavigateWeek,
    onAssigneeFilterChange,
    weekDataVersion = 0,
    onWeekDataRefresh,
}: EditableTaskBoardProps) {
    const router = useRouter();
    const [boardTasks, setBoardTasks] = useState<EditableTaskRecord[]>([]);
    const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
    const [editorState, setEditorState] = useState<EditableTaskFormState | null>(null);
    const [isCenteredEditorOpen, setIsCenteredEditorOpen] = useState(false);
    const [editorTab, setEditorTab] = useState<TaskEditorTab>("details");
    const [returnToHref, setReturnToHref] = useState<string | null>(null);
    const [estimateHoursInput, setEstimateHoursInput] = useState("0");
    const [billableEntryDraft, setBillableEntryDraft] = useState<BillableEntryDraft>({
        entryDate: getDefaultBillableEntryDate(activeWeekStr),
        hours: "",
        note: "",
        isValueAdd: false,
    });
    const [dragTaskId, setDragTaskId] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();
    const [isLoading, setIsLoading] = useState(false);
    const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
    const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
    const [boardDeleteOpen, setBoardDeleteOpen] = useState(false);
    const [folderDeleteOpen, setFolderDeleteOpen] = useState(false);
    const [taskFinderQuery, setTaskFinderQuery] = useState("");

    const activeWeekDate = useMemo(() => new Date(`${activeWeekStr}T00:00:00`), [activeWeekStr]);
    const weekRangeLabel = `${format(activeWeekDate, "MMM d")} to ${format(addDays(activeWeekDate, 4), "MMM d")}`;

    const scopedTasks = useMemo(
        () => filterTasksByScope(tasks, scopeType, scopeId, scopeName),
        [tasks, scopeType, scopeId, scopeName]
    );

    const seedTasks = useMemo(
        () => buildSeedTasks(scopedTasks, activeWeekStr),
        [scopedTasks, activeWeekStr]
    );

    const taskClientLabelBySourceTaskId = useMemo(() => {
        const entries = tasks
            .map((task) => [String(task?.id ?? "").trim(), getClientLabelForTask(task)] as const)
            .filter((entry) => entry[0].length > 0);
        return new Map(entries);
    }, [tasks]);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        (async () => {
            const rows = await getEditableTasks(activeWeekStr, scopeType, scopeId, seedTasks);
            if (cancelled) return;
            setBoardTasks(rows);
            setIsLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [activeWeekStr, scopeType, scopeId, seedTasks, weekDataVersion]);

    useEffect(() => {
        if (!selectedTaskId) {
            setEditorState(null);
            return;
        }
        const task = boardTasks.find((item) => item.id === selectedTaskId);
        if (!task) {
            setEditorState(null);
            setSelectedTaskId(null);
            return;
        }
        const taskBillable = task.isBillable === undefined
            ? defaultBillableForTeamScope(scopeType)
            : Boolean(task.isBillable);
        setEditorState({
            id: task.id,
            isDraft: false,
            subject: task.subject,
            description: task.description,
            assignee: task.assignee,
            isAi: Boolean(task.isAi ?? false),
            isBillable: taskBillable,
            week: task.week,
            plannedWeek: task.plannedWeek || "",
            closedDate: task.closedDate || "",
            estimateHours: Number(task.estimateHours ?? 0),
            status: task.status,
        });
        setEstimateHoursInput(formatEditableNumber(task.estimateHours ?? 0));
        setEditorTab("details");
        setBillableEntryDraft({
            entryDate: getDefaultBillableEntryDate(activeWeekStr),
            hours: "",
            note: "",
            isValueAdd: !taskBillable,
        });
    }, [selectedTaskId, boardTasks, activeWeekStr, scopeType]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const params = new URLSearchParams(window.location.search);
        const value = params.get("returnTo");
        setReturnToHref(value && value.trim().length > 0 ? value : null);
    }, [activeWeekStr, scopeId, scopeType, initialAssigneeFilter]);

    const groupedTasks = useMemo(() => {
        const map: Record<EditableStatus, EditableTaskRecord[]> = {
            backlog: [],
            open: [],
            closed: [],
        };
        const normalizedAssigneeFilter = normalizeScopeValue(initialAssigneeFilter ?? "");
        const normalizedTaskFinderQuery = normalizeScopeValue(taskFinderQuery);
        const assigneeFilteredTasks = normalizedAssigneeFilter
            ? boardTasks.filter((task) => normalizeScopeValue(task.assignee) === normalizedAssigneeFilter)
            : boardTasks;
        const visibleBoardTasks = normalizedTaskFinderQuery
            ? assigneeFilteredTasks.filter((task) => {
                const subjectKey = normalizeScopeValue(task.subject);
                return subjectKey.includes(normalizedTaskFinderQuery);
            })
            : assigneeFilteredTasks;

        visibleBoardTasks.forEach((task) => {
            map[getEffectiveEditableTaskStatus(task, activeWeekStr)].push(task);
        });
        (Object.keys(map) as EditableStatus[]).forEach((status) => {
            map[status] = map[status].slice().sort((a, b) => {
                const clientA = String(
                    a.sourceTaskId ? taskClientLabelBySourceTaskId.get(String(a.sourceTaskId)) ?? "" : ""
                );
                const clientB = String(
                    b.sourceTaskId ? taskClientLabelBySourceTaskId.get(String(b.sourceTaskId)) ?? "" : ""
                );
                if (scopeType === "all") {
                    const clientCompare = clientA.localeCompare(clientB);
                    if (clientCompare !== 0) return clientCompare;
                }
                return a.position - b.position || a.subject.localeCompare(b.subject);
            });
        });
        return map;
    }, [activeWeekStr, boardTasks, initialAssigneeFilter, scopeType, taskClientLabelBySourceTaskId, taskFinderQuery]);

    const persistTaskUpdate = (taskId: string, patch: Partial<EditableTaskRecord>) => {
        setBoardTasks((prev) => prev.map((task) => (task.id === taskId ? { ...task, ...patch } : task)));
        startTransition(() => {
            void updateEditableTask(taskId, patch).then(() => onWeekDataRefresh?.());
        });
    };

    const handleCreateTask = () => {
        setSelectedTaskId(null);
        setEditorState({
            id: NEW_TASK_DRAFT_ID,
            isDraft: true,
            subject: "New Task",
            description: "",
            assignee: String(initialAssigneeFilter ?? "").trim(),
            isAi: false,
            isBillable: defaultBillableForTeamScope(scopeType),
            week: activeWeekStr,
            plannedWeek: "",
            closedDate: "",
            estimateHours: 0,
            status: "backlog",
        });
        setEstimateHoursInput("0");
        setEditorTab("details");
        setIsCenteredEditorOpen(true);
    };

    const handleDeleteTask = async (taskId: string) => {
        setBoardTasks((prev) => prev.filter((item) => item.id !== taskId));
        if (selectedTaskId === taskId) setSelectedTaskId(null);
        setIsCenteredEditorOpen(false);
        await deleteEditableTask(taskId);
        await onWeekDataRefresh?.();
    };

    const handleDropToStatus = (status: EditableStatus) => {
        if (!dragTaskId) return;
        const draggedTask = boardTasks.find((task) => task.id === dragTaskId);
        if (!draggedTask) return;
        const nextPosition = Math.max(
            0,
            ...boardTasks.filter((task) => task.status === status && task.id !== dragTaskId).map((task) => Number(task.position || 0))
        ) + 1;
        const nextClosedDate = status === "closed" ? getDefaultClosedDate(activeWeekStr) : "";
        persistTaskUpdate(dragTaskId, {
            status,
            position: nextPosition,
            plannedWeek: status === "open"
                ? (draggedTask.plannedWeek || activeWeekStr)
                : status === "backlog"
                    ? ""
                    : draggedTask.plannedWeek,
            closedDate: nextClosedDate,
        });
        setDragTaskId(null);
    };

    const handleDiscardDraft = () => {
        setEditorState(null);
        setSelectedTaskId(null);
        setIsCenteredEditorOpen(false);
    };

    const handleSaveEditor = () => {
        if (!editorState) return;
        const normalizedWeek = editorState.isDraft
            ? toWeekStart(editorState.week)
            : toWeekStart(selectedTask?.week || editorState.week);
        const candidatePlannedWeek = editorState.status === "open"
            ? toWeekStart(editorState.plannedWeek || activeWeekStr)
            : toWeekStart(editorState.plannedWeek || "");
        const normalizedPlannedWeek = candidatePlannedWeek && candidatePlannedWeek < normalizedWeek
            ? normalizedWeek
            : candidatePlannedWeek;
        const candidateClosedDate = editorState.status === "closed"
            ? normalizeDateKey(editorState.closedDate || getDefaultClosedDate(activeWeekStr))
            : "";
        const normalizedClosedDate = candidateClosedDate && candidateClosedDate < normalizedWeek
            ? normalizedWeek
            : candidateClosedDate;
        const persistedStatus: EditableStatus = normalizedClosedDate
            ? "closed"
            : normalizedPlannedWeek && normalizedPlannedWeek <= activeWeekStr
                ? "open"
                : "backlog";
        const nextTaskPatch = {
            subject: editorState.subject.trim() || "Untitled Task",
            description: editorState.description,
            assignee: editorState.assignee,
            isAi: editorState.isAi,
            isBillable: editorState.isBillable,
            week: normalizedWeek,
            plannedWeek: normalizedPlannedWeek,
            closedDate: normalizedClosedDate,
            estimateHours: normalizeEstimateHours(estimateHoursInput),
            status: persistedStatus,
        };

        if (editorState.isDraft) {
            startTransition(async () => {
                const created = await createEditableTask({
                    ...nextTaskPatch,
                    scopeType,
                    scopeId,
                    billableHoursToday: 0,
                });
                if (!created) return;
                if (isEditableTaskVisibleInWeek(created, activeWeekStr)) {
                    setBoardTasks((prev) => [...prev, created]);
                    setSelectedTaskId(created.id);
                } else {
                    setSelectedTaskId(null);
                }
                setEditorState(null);
                setIsCenteredEditorOpen(false);
                await onWeekDataRefresh?.();
            });
            return;
        }

        const savedTaskId = editorState.id;
        persistTaskUpdate(editorState.id, nextTaskPatch);
        if (!isEditableTaskVisibleInWeek({ week: normalizedWeek, closedDate: normalizedClosedDate }, activeWeekStr)) {
            setBoardTasks((prev) => prev.filter((task) => task.id !== editorState.id));
        }
        if (selectedTaskId === savedTaskId) {
            setSelectedTaskId(null);
        }
        setEditorState(null);
        setIsCenteredEditorOpen(false);
    };

    const assigneePickList = useMemo(() => {
        const values = new Set(
            assigneeOptions
                .map((name) => String(name || "").trim())
                .filter(Boolean)
        );
        const currentAssignee = String(editorState?.assignee ?? "").trim();
        if (currentAssignee) values.add(currentAssignee);
        return Array.from(values).sort((a, b) => a.localeCompare(b));
    }, [assigneeOptions, editorState?.assignee]);

    const assigneeFilterOptions = useMemo(() => {
        const values = new Set(
            assigneeOptions
                .map((name) => String(name || "").trim())
                .filter(Boolean)
        );
        const currentFilter = String(initialAssigneeFilter ?? "").trim();
        if (currentFilter) values.add(currentFilter);
        return Array.from(values).sort((a, b) => a.localeCompare(b));
    }, [assigneeOptions, initialAssigneeFilter]);

    const selectedTask = useMemo(
        () => boardTasks.find((task) => task.id === selectedTaskId) ?? null,
        [boardTasks, selectedTaskId]
    );

    useEffect(() => {
        setAttachmentMessage(null);
    }, [selectedTaskId]);

    const handleAddBillableEntry = async () => {
        if (!selectedTask || !billableEntryDraft.entryDate) return;
        const created = await addEditableTaskBillableEntry({
            taskId: selectedTask.id,
            entryDate: billableEntryDraft.entryDate,
            hours: normalizeEstimateHours(billableEntryDraft.hours),
            note: billableEntryDraft.note,
            isValueAdd: billableEntryDraft.isValueAdd,
        });
        if (!created) return;

        setBoardTasks((prev) => prev.map((task) => {
            if (task.id !== selectedTask.id) return task;
            const nextEntries = [created, ...(task.billableEntries || [])].sort((a, b) => {
                if (a.entryDate !== b.entryDate) return b.entryDate.localeCompare(a.entryDate);
                return b.createdAt.localeCompare(a.createdAt);
            });
            return {
                ...task,
                billableEntries: nextEntries,
            };
        }));
        setBillableEntryDraft({
            entryDate: getDefaultBillableEntryDate(activeWeekStr),
            hours: "",
            note: "",
            isValueAdd: !Boolean(selectedTask.isBillable ?? defaultBillableForTeamScope(scopeType)),
        });
        await onWeekDataRefresh?.();
    };

    const handleDeleteBillableEntry = async (entry: EditableTaskBillableEntryRecord) => {
        await deleteEditableTaskBillableEntry(entry.id);
        setBoardTasks((prev) => prev.map((task) => {
            if (task.id !== entry.taskId) return task;
            return {
                ...task,
                billableEntries: (task.billableEntries || []).filter((item) => item.id !== entry.id),
            };
        }));
        await onWeekDataRefresh?.();
    };

    const handleToggleTaskAi = (task: EditableTaskRecord, nextValue: boolean) => {
        persistTaskUpdate(task.id, { isAi: nextValue });
        if (editorState?.id === task.id) {
            setEditorState((prev) => prev ? { ...prev, isAi: nextValue } : prev);
        }
    };

    const handleToggleTaskBillable = (task: EditableTaskRecord, nextValue: boolean) => {
        persistTaskUpdate(task.id, { isBillable: nextValue });
        if (editorState?.id === task.id) {
            setEditorState((prev) => prev ? { ...prev, isBillable: nextValue } : prev);
            setBillableEntryDraft((draft) => ({
                ...draft,
                isValueAdd: !nextValue,
            }));
        }
    };

    const handleToggleEntryValueAdd = async (entry: EditableTaskBillableEntryRecord, nextIsValueAdd: boolean) => {
        const updated = await updateEditableTaskBillableEntry(entry.id, { isValueAdd: nextIsValueAdd });
        if (!updated) return;
        setBoardTasks((prev) => prev.map((task) => {
            if (task.id !== entry.taskId) return task;
            return {
                ...task,
                billableEntries: (task.billableEntries || []).map((row) => (
                    row.id === entry.id ? updated : row
                )),
            };
        }));
        await onWeekDataRefresh?.();
    };

    const handleAttachmentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        if (!selectedTask || !selectedFile) return;

        setIsUploadingAttachment(true);
        setAttachmentMessage(null);

        try {
            const formData = new FormData();
            formData.set("taskId", selectedTask.id);
            formData.set("file", selectedFile);

            const response = await fetch("/api/task-attachments", {
                method: "POST",
                body: formData,
            });
            const payload = await response.json().catch(() => null);

            if (!response.ok) {
                throw new Error(String(payload?.error || "Upload failed."));
            }

            const created = payload as EditableTaskAttachmentRecord;
            setBoardTasks((prev) => prev.map((task) => {
                if (task.id !== selectedTask.id) return task;
                return {
                    ...task,
                    attachments: [created, ...(task.attachments || [])],
                };
            }));
            setAttachmentMessage(`${selectedFile.name} uploaded.`);
        } catch (error) {
            setAttachmentMessage(error instanceof Error ? error.message : "Upload failed.");
        } finally {
            event.target.value = "";
            setIsUploadingAttachment(false);
        }
    };

    const handleDeleteAttachment = async (attachment: EditableTaskAttachmentRecord) => {
        await deleteEditableTaskAttachment(attachment.id);
        setBoardTasks((prev) => prev.map((task) => {
            if (task.id !== attachment.taskId) return task;
            return {
                ...task,
                attachments: (task.attachments || []).filter((item) => item.id !== attachment.id),
            };
        }));
    };

    const handleReturnToCapacityGrid = () => {
        if (typeof window === "undefined") return;
        if (returnToHref) {
            window.location.href = returnToHref;
            return;
        }
        window.history.back();
    };

    const handleDeleteBoard = () => {
        if (scopeType !== "list") return;
        startTransition(async () => {
            await removeTaskSidebarBoard(scopeId);
            const params = new URLSearchParams();
            if (activeWeekStr) params.set("week", activeWeekStr);
            params.set("tab", tabId);
            if (initialAssigneeFilter) params.set("assignee", initialAssigneeFilter);
            if (scopeParentFolderId) {
                params.set("folderId", scopeParentFolderId);
            }
            window.location.href = `/?${params.toString()}`;
        });
    };

    const handleDeleteFolder = () => {
        if (scopeType !== "folder") return;
        startTransition(async () => {
            await removeTaskSidebarFolder(scopeId);
            const params = new URLSearchParams();
            if (activeWeekStr) params.set("week", activeWeekStr);
            params.set("tab", tabId);
            if (initialAssigneeFilter) params.set("assignee", initialAssigneeFilter);
            window.location.href = `/?${params.toString()}`;
        });
    };

    const renderTaskEditorFields = () => (
        <>
            {editorState && boardTasks.find((task) => task.id === editorState.id)?.sourceTaskId && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-text-muted">
                    Seeded from an original source task and editable locally on this weekly board.
                </div>
            )}
            <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Subject</span>
                <input
                    type="text"
                    value={editorState?.subject ?? ""}
                    onChange={(event) => setEditorState((prev) => prev ? { ...prev, subject: event.target.value } : prev)}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                />
            </label>

            <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Description</span>
                <textarea
                    value={editorState?.description ?? ""}
                    onChange={(event) => setEditorState((prev) => prev ? { ...prev, description: event.target.value } : prev)}
                    rows={5}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary resize-none"
                />
            </label>

            <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Assignee</span>
                <select
                    value={editorState?.assignee ?? ""}
                    onChange={(event) => setEditorState((prev) => prev ? { ...prev, assignee: event.target.value } : prev)}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                >
                    <option value="">Unassigned</option>
                    {assigneePickList.map((name) => (
                        <option key={name} value={name}>
                            {name}
                        </option>
                    ))}
                </select>
            </label>

            <label className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2">
                <input
                    type="checkbox"
                    checked={Boolean(editorState?.isAi)}
                    onChange={(event) => setEditorState((prev) => prev ? { ...prev, isAi: event.target.checked } : prev)}
                    className="h-4 w-4 rounded border-border bg-background/60 text-primary focus:ring-primary"
                />
                <div>
                    <div className="text-sm font-medium text-white">AI</div>
                    <div className="text-[11px] text-text-muted">Mark this task as AI-related work.</div>
                </div>
            </label>

            <label className="flex items-center gap-3 rounded-md border border-border bg-background/40 px-3 py-2">
                <input
                    type="checkbox"
                    checked={Boolean(editorState?.isBillable)}
                    onChange={(event) => setEditorState((prev) => prev ? { ...prev, isBillable: event.target.checked } : prev)}
                    className="h-4 w-4 rounded border-border bg-background/60 text-primary focus:ring-primary"
                />
                <div>
                    <div className="text-sm font-medium text-white">Billable</div>
                    <div className="text-[11px] text-text-muted">
                        Default for NetSuite time entries on this task. You can still mark individual actuals lines as non-billable (value-add).
                    </div>
                </div>
            </label>

            <div className="space-y-1 rounded-md border border-border bg-background/40 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-text-muted">Created Week</div>
                <div className="text-sm font-medium text-white">{editorState?.week ?? activeWeekStr}</div>
                <div className="text-[11px] text-text-muted">Reference only. This does not change after the task is created.</div>
            </div>

            <div className="space-y-1 rounded-md border border-border bg-background/40 px-3 py-2">
                <div className="text-[11px] uppercase tracking-wider text-text-muted">Closed Date</div>
                <div className="text-sm font-medium text-white">{editorState?.closedDate || "Open task"}</div>
                <div className="text-[11px] text-text-muted">Set automatically when the task is closed and cleared if it is reopened.</div>
            </div>

            <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Planned Week</span>
                <input
                    type="date"
                    value={editorState?.plannedWeek ?? ""}
                    min={editorState?.week ?? activeWeekStr}
                    onChange={(event) => setEditorState((prev) => prev ? {
                        ...prev,
                        plannedWeek: event.target.value && event.target.value < prev.week ? prev.week : event.target.value,
                    } : prev)}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                />
                <div className="text-[11px] text-text-muted">
                    Planned Week controls when the task becomes open and when its estimate appears in weekly task-estimate rollups.
                </div>
            </label>

            <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Estimate (Hours)</span>
                <input
                    type="text"
                    inputMode="decimal"
                    value={estimateHoursInput}
                    onFocus={selectInputValueOnFocus}
                    onChange={(event) => setEstimateHoursInput(sanitizeDecimalDraft(event.target.value))}
                    onBlur={() => {
                        setEstimateHoursInput((prev) => (
                            prev.trim().length > 0
                                ? formatEditableNumber(normalizeEstimateHours(prev))
                                : ""
                        ));
                    }}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                />
            </label>

            <label className="block space-y-1">
                <span className="text-[11px] uppercase tracking-wider text-text-muted">Status</span>
                <select
                    value={editorState?.status ?? "backlog"}
                    onChange={(event) => {
                        const nextStatus = event.target.value as EditableStatus;
                        setEditorState((prev) => prev ? {
                            ...prev,
                            status: nextStatus,
                            plannedWeek: nextStatus === "open"
                                ? (prev.plannedWeek || activeWeekStr)
                                : nextStatus === "backlog" && prev.plannedWeek <= activeWeekStr
                                    ? ""
                                    : prev.plannedWeek,
                            closedDate: nextStatus === "closed"
                                ? (prev.closedDate || getDefaultClosedDate(activeWeekStr))
                                : "",
                        } : prev);
                    }}
                    className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                >
                    {STATUS_COLUMNS.map((column) => (
                        <option key={column.id} value={column.id}>
                            {column.label}
                        </option>
                    ))}
                </select>
            </label>

            {editorState?.isDraft && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-text-muted">
                    The task stays as a draft until you click Save Task.
                </div>
            )}

            {!editorState?.isDraft && (
            <div className="space-y-3 rounded-xl border border-border/60 bg-surface/20 p-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-sm font-semibold text-white">Attachments</div>
                        <div className="text-[11px] text-text-muted">
                            Quick MVP upload for task files. Supports common document types up to 15MB.
                        </div>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 text-xs font-medium text-text-main hover:bg-surface-hover">
                        <Upload className="h-3.5 w-3.5" />
                        {isUploadingAttachment ? "Uploading..." : "Add File"}
                        <input
                            type="file"
                            onChange={handleAttachmentUpload}
                            disabled={!selectedTask || isUploadingAttachment}
                            className="hidden"
                        />
                    </label>
                </div>

                {attachmentMessage && (
                    <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-text-muted">
                        {attachmentMessage}
                    </div>
                )}

                <div className="space-y-2">
                    {(selectedTask?.attachments || []).length === 0 && (
                        <div className="rounded-lg border border-dashed border-border/40 px-3 py-4 text-xs text-text-muted">
                            No attachments yet.
                        </div>
                    )}
                    {(selectedTask?.attachments || []).map((attachment) => (
                        <div
                            key={attachment.id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-background/40 px-3 py-3"
                        >
                            <div className="min-w-0">
                                <div className="flex items-center gap-2 text-sm font-medium text-white">
                                    <Upload className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                                    <a
                                        href={attachment.downloadUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="truncate hover:text-primary"
                                    >
                                        {attachment.originalName}
                                    </a>
                                </div>
                                <div className="mt-1 text-[11px] text-text-muted">
                                    {formatAttachmentSize(attachment.sizeBytes)} · {attachment.mimeType}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleDeleteAttachment(attachment)}
                                className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-xs text-red-200 hover:bg-red-500/10"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                            </button>
                        </div>
                    ))}
                </div>
            </div>
            )}

            <div className="flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={handleSaveEditor}
                    className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                >
                    <Save className="w-4 h-4" />
                    Save Task
                </button>
                {editorState && (
                    <button
                        type="button"
                        onClick={() => editorState.isDraft ? handleDiscardDraft() : handleDeleteTask(editorState.id)}
                        className={cn(
                            "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                            editorState.isDraft
                                ? "border border-border/60 text-text-main hover:bg-surface-hover"
                                : "border border-red-500/30 text-red-200 hover:bg-red-500/10"
                        )}
                    >
                        {editorState.isDraft ? <X className="w-4 h-4" /> : <Trash2 className="w-4 h-4" />}
                        {editorState.isDraft ? "Discard Draft" : "Delete"}
                    </button>
                )}
            </div>
        </>
    );

    const renderBillableHistoryTab = () => {
        const entries = selectedTask?.billableEntries || [];
        const totalHours = selectedTask ? getTaskWeeklyBillableHours(selectedTask) : 0;

        return (
            <div className="space-y-4">
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-text-muted">
                    Logged actuals here will roll up into Plan vs Actuals for this consultant and client.
                    NetSuite receives the billable flag from the task default unless you mark a line as value-add (non-billable) below.
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_120px_minmax(0,1fr)_auto]">
                    <label className="block space-y-1">
                        <span className="text-[11px] uppercase tracking-wider text-text-muted">Date</span>
                        <input
                            type="date"
                            value={billableEntryDraft.entryDate}
                            onChange={(event) => setBillableEntryDraft((prev) => ({ ...prev, entryDate: event.target.value }))}
                            className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                        />
                    </label>
                    <label className="block space-y-1">
                        <span className="text-[11px] uppercase tracking-wider text-text-muted">Hours</span>
                        <input
                            type="text"
                            inputMode="decimal"
                            value={billableEntryDraft.hours}
                            onFocus={selectInputValueOnFocus}
                            onChange={(event) => setBillableEntryDraft((prev) => ({
                                ...prev,
                                hours: sanitizeDecimalDraft(event.target.value),
                            }))}
                            onBlur={() => {
                                setBillableEntryDraft((prev) => ({
                                    ...prev,
                                    hours: prev.hours.trim().length > 0
                                        ? formatEditableNumber(normalizeEstimateHours(prev.hours))
                                        : "",
                                }));
                            }}
                            className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                        />
                    </label>
                    <label className="block space-y-1">
                        <span className="text-[11px] uppercase tracking-wider text-text-muted">Note</span>
                        <input
                            type="text"
                            value={billableEntryDraft.note}
                            onChange={(event) => setBillableEntryDraft((prev) => ({ ...prev, note: event.target.value }))}
                            placeholder="Optional actuals note"
                            className="w-full rounded-md border border-border bg-background/60 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                        />
                    </label>
                    <div className="flex items-end">
                        <button
                            type="button"
                            onClick={handleAddBillableEntry}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                        >
                            <Plus className="w-4 h-4" />
                            Add Entry
                        </button>
                    </div>
                </div>

                <label className="flex items-center gap-3 rounded-md border border-border/60 bg-background/30 px-3 py-2">
                    <input
                        type="checkbox"
                        checked={!billableEntryDraft.isValueAdd}
                        onChange={(event) => setBillableEntryDraft((prev) => ({
                            ...prev,
                            isValueAdd: !event.target.checked,
                        }))}
                        className="h-4 w-4 rounded border-border bg-background/60 text-primary focus:ring-primary"
                    />
                    <div>
                        <div className="text-sm font-medium text-white">Billable in NetSuite</div>
                        <div className="text-[11px] text-text-muted">Uncheck for value-add / non-billable hours on this line only.</div>
                    </div>
                </label>

                <div className="rounded-xl border border-border/50 bg-background/30">
                    <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
                        <div>
                            <div className="text-sm font-semibold text-white">Actuals History</div>
                            <div className="text-xs text-text-muted">{totalHours.toFixed(2)}h logged for this week</div>
                        </div>
                    </div>
                    <div className="divide-y divide-border/30">
                        {entries.length === 0 && (
                            <div className="px-4 py-8 text-sm text-text-muted">No actuals entries logged yet for this task.</div>
                        )}
                        {entries.map((entry) => {
                            const isSyncLocked = entry.nsSyncStatus === "synced" && !!entry.netsuiteId;
                            return (
                            <div key={entry.id} className="flex items-start justify-between gap-3 px-4 py-3">
                                <div className="flex items-start gap-2 min-w-0">
                                    <span
                                        className={cn(
                                            "mt-1 h-2 w-2 shrink-0 rounded-full",
                                            entry.nsSyncStatus === "synced" ? "bg-green-500" :
                                            entry.nsSyncStatus === "failed" ? "bg-red-500" :
                                            "bg-gray-500"
                                        )}
                                        title={
                                            entry.nsSyncStatus === "synced" ? `Synced to NetSuite (${entry.netsuiteId})` :
                                            entry.nsSyncStatus === "failed" ? `Sync failed: ${entry.nsSyncError || "unknown error"}` :
                                            "Pending sync"
                                        }
                                    />
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-white">
                                            {entry.hours.toFixed(2)}h on {format(new Date(`${entry.entryDate}T00:00:00`), "MMM d, yyyy")}
                                        </div>
                                        <div className="mt-2 text-xs text-text-muted">
                                            {entry.note || "No note"}
                                        </div>
                                        <label
                                            className="mt-2 inline-flex items-center gap-2 text-xs text-text-muted"
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={!entry.isValueAdd}
                                                onChange={(event) => void handleToggleEntryValueAdd(entry, !event.target.checked)}
                                                className="h-3.5 w-3.5 rounded border-border bg-background/60 text-primary focus:ring-primary"
                                            />
                                            <span>Billable in NetSuite</span>
                                        </label>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {entry.nsSyncStatus === "failed" && (
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                const { retryTimeEntrySync } = await import("@/app/actions");
                                                await retryTimeEntrySync(entry.id);
                                            }}
                                            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors"
                                            title={`Retry sync (${entry.nsSyncError || "failed"})`}
                                        >
                                            ↻ Retry
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        disabled={isSyncLocked}
                                        onClick={() => handleDeleteBillableEntry(entry)}
                                        title={isSyncLocked ? "Cannot delete entries synced to NetSuite" : undefined}
                                        className={cn(
                                            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs",
                                            isSyncLocked
                                                ? "border-border/40 text-text-muted opacity-50 cursor-not-allowed"
                                                : "border-red-500/30 text-red-200 hover:bg-red-500/10"
                                        )}
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        Delete
                                    </button>
                                </div>
                            </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-4 flex-wrap">
                    <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                        Editable Tasks
                    </h2>
                    {returnToHref && (
                        <button
                            type="button"
                            onClick={handleReturnToCapacityGrid}
                            className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-surface/20 px-3 py-1.5 text-xs font-semibold text-text-main hover:bg-surface-hover"
                        >
                            <ChevronLeft className="w-3.5 h-3.5" />
                            Back To Capacity Grid
                        </button>
                    )}
                    <div className="flex items-center rounded-md border border-border/70 overflow-hidden bg-surface/20">
                        <button
                            onClick={() => {
                                const nextWeek = format(subWeeks(activeWeekDate, 1), "yyyy-MM-dd");
                                if (onNavigateWeek) {
                                    onNavigateWeek(nextWeek);
                                } else {
                                    router.push(buildWeekNavigationHref(nextWeek, tabId), { scroll: false });
                                }
                            }}
                            className="h-9 w-9 flex items-center justify-center text-text-muted hover:text-white hover:bg-surface-hover transition-colors border-r border-border/70"
                            aria-label="Previous week"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="px-3 py-1.5 min-w-[190px]">
                            <div className="text-[10px] uppercase tracking-wider text-text-muted">Week</div>
                            <div className="text-xs font-semibold text-white">{weekRangeLabel}</div>
                        </div>
                        <button
                            onClick={() => {
                                const nextWeek = format(addWeeks(activeWeekDate, 1), "yyyy-MM-dd");
                                if (onNavigateWeek) {
                                    onNavigateWeek(nextWeek);
                                } else {
                                    router.push(buildWeekNavigationHref(nextWeek, tabId), { scroll: false });
                                }
                            }}
                            className="h-9 w-9 flex items-center justify-center text-text-muted hover:text-white hover:bg-surface-hover transition-colors border-l border-border/70"
                            aria-label="Next week"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    <span className="text-xs text-text-muted">Scope: {scopeName}</span>
                </div>
                <div className="flex items-center gap-3">
                    {scopeType === "folder" && (
                        <button
                            type="button"
                            onClick={() => setFolderDeleteOpen(true)}
                            className="inline-flex items-center gap-2 rounded-md border border-red-500/35 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete Team
                        </button>
                    )}
                    {scopeType === "list" && (
                        <button
                            type="button"
                            onClick={() => setBoardDeleteOpen(true)}
                            className="inline-flex items-center gap-2 rounded-md border border-red-500/35 bg-red-500/10 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete Board
                        </button>
                    )}
                    <label className="flex items-center gap-2 text-xs text-text-muted">
                        <span>Assignee</span>
                        <select
                            value={initialAssigneeFilter ?? ""}
                            onChange={(event) => {
                                const nextAssignee = event.target.value || null;
                                if (onAssigneeFilterChange) {
                                    onAssigneeFilterChange(nextAssignee);
                                } else {
                                    router.push(buildAssigneeFilterHref(nextAssignee, tabId), { scroll: false });
                                }
                            }}
                            className="rounded-md border border-border bg-surface/30 px-2 py-1.5 text-xs text-white outline-none focus:border-primary"
                        >
                            <option value="">All Active Consultants</option>
                            {assigneeFilterOptions.map((name) => (
                                <option key={name} value={name}>
                                    {name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-text-muted">
                        <span>Task Finder</span>
                        <div className="flex items-center rounded-md border border-border bg-surface/30 px-2 py-1.5">
                            <input
                                type="text"
                                value={taskFinderQuery}
                                onChange={(event) => setTaskFinderQuery(event.target.value)}
                                placeholder="Find task by name..."
                                className="w-[220px] bg-transparent text-xs text-white outline-none placeholder:text-text-muted"
                            />
                            {taskFinderQuery.trim().length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setTaskFinderQuery("")}
                                    className="inline-flex items-center justify-center rounded-sm p-1 text-text-muted hover:bg-surface-hover hover:text-white"
                                    aria-label="Clear task finder"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    </label>
                    <button
                        type="button"
                        onClick={handleCreateTask}
                        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs text-text-main hover:bg-surface-hover"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Add Task
                    </button>
                    <span className="text-[11px] text-text-muted">
                        {isPending
                            ? "Saving..."
                            : isLoading
                                ? "Loading..."
                                : `${Object.values(groupedTasks).reduce((sum, items) => sum + items.length, 0)} editable tasks in this scope`}
                    </span>
                </div>
            </div>

            <div className="text-xs text-text-muted">
                Tasks in this board are saved locally and roll up into planning and actuals views.
            </div>

            <div className="border border-border/50 bg-surface/20 rounded-xl p-4 overflow-hidden min-h-[640px]">
                <div className="flex gap-4 overflow-x-auto pb-2 h-full">
                    {STATUS_COLUMNS.map((column) => {
                        const columnTasks = groupedTasks[column.id];
                        return (
                            <div
                                key={column.id}
                                className="flex-shrink-0 w-[320px] rounded-xl border border-border/40 bg-background/40 p-3 flex flex-col"
                                onDragOver={(event) => event.preventDefault()}
                                onDrop={() => handleDropToStatus(column.id)}
                            >
                                <div className="flex items-center justify-between px-1 pb-3 border-b border-border/30">
                                    <h3 className="text-sm font-semibold text-white">{column.label}</h3>
                                    <span className="text-xs bg-surface-hover text-text-muted px-1.5 py-0.5 rounded-full font-mono">
                                        {columnTasks.length}
                                    </span>
                                </div>
                                <div className="pt-3 space-y-2 overflow-y-auto custom-scrollbar min-h-[540px]">
                                    {columnTasks.map((task) => (
                                        <div
                                            key={task.id}
                                            draggable
                                            onDragStart={() => setDragTaskId(task.id)}
                                            onClick={() => {
                                                setSelectedTaskId(task.id);
                                                setIsCenteredEditorOpen(true);
                                            }}
                                            onDoubleClick={() => {
                                                setSelectedTaskId(task.id);
                                                setIsCenteredEditorOpen(true);
                                            }}
                                            className={cn(
                                                "rounded-lg border border-border/40 bg-surface/30 p-3 cursor-pointer hover:bg-surface-hover/50 transition-colors",
                                                selectedTaskId === task.id && "border-primary/50 bg-primary/10"
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.16em] text-text-muted">
                                                        {getTaskClientDisplayLabel(task, scopeType, scopeName, taskClientLabelBySourceTaskId)}
                                                    </div>
                                                    <div className="text-sm font-semibold text-white truncate">{task.subject}</div>
                                                    {task.description && (
                                                        <div className="mt-1 text-xs text-text-muted line-clamp-3">{task.description}</div>
                                                    )}
                                                    {task.sourceTaskId && (
                                                        <div className="mt-2">
                                                            <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                                                                Seeded Task
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                                <GripVertical className="w-4 h-4 text-text-muted shrink-0" />
                                            </div>
                                            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-muted">
                                                <label
                                                    className="inline-flex items-center gap-2"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={Boolean(task.isAi)}
                                                        onChange={(event) => handleToggleTaskAi(task, event.target.checked)}
                                                        className="h-3.5 w-3.5 rounded border-border bg-background/60 text-primary focus:ring-primary"
                                                    />
                                                    <span>AI</span>
                                                </label>
                                                <label
                                                    className="inline-flex items-center gap-2"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={task.isBillable !== false}
                                                        onChange={(event) => handleToggleTaskBillable(task, event.target.checked)}
                                                        className="h-3.5 w-3.5 rounded border-border bg-background/60 text-primary focus:ring-primary"
                                                    />
                                                    <span>Billable</span>
                                                </label>
                                            </div>
                                            <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-text-muted">
                                                <span className="truncate">{task.assignee || "Unassigned"}</span>
                                                <div className="flex items-center gap-3">
                                                    <span>{getTaskWeeklyBillableHours(task).toFixed(2)}h logged</span>
                                                    <span>{format(new Date(`${task.week}T00:00:00`), "'Wk Of' MMM d")}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {columnTasks.length === 0 && (
                                        <div className="rounded-lg border border-dashed border-border/40 py-10 text-center text-xs text-text-muted">
                                            Drop tasks here
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            {isCenteredEditorOpen && editorState && (
                <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                        <div className="flex items-center justify-between border-b border-border/50 bg-surface/80 px-5 py-4">
                            <div>
                                <div className="text-sm font-semibold text-text-main">Task Editor</div>
                                <div className="mt-1 text-xs text-text-muted">
                                    {scopeName} · {editorState.subject || "Untitled Task"}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsCenteredEditorOpen(false)}
                                className="inline-flex items-center justify-center rounded-md border border-border/60 p-2 text-text-muted hover:bg-surface-hover hover:text-white"
                                aria-label="Close task editor"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="max-h-[75vh] overflow-y-auto p-5 space-y-4">
                            <div className="inline-flex rounded-lg border border-border/50 bg-background/40 p-1">
                                <button
                                    type="button"
                                    onClick={() => setEditorTab("details")}
                                    className={cn(
                                        "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                        editorTab === "details" ? "bg-primary/15 text-white" : "text-text-muted hover:text-white"
                                    )}
                                >
                                    Details
                                </button>
                                {!editorState.isDraft && (
                                    <button
                                        type="button"
                                        onClick={() => setEditorTab("billable")}
                                        className={cn(
                                            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                                            editorTab === "billable" ? "bg-primary/15 text-white" : "text-text-muted hover:text-white"
                                        )}
                                    >
                                        Actuals Log
                                    </button>
                                )}
                            </div>
                            {editorTab === "details" || editorState.isDraft ? renderTaskEditorFields() : renderBillableHistoryTab()}
                        </div>
                    </div>
                </div>
            )}
            {boardDeleteOpen && scopeType === "list" && (
                <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                        <div className="border-b border-border/50 bg-surface/80 px-5 py-4">
                            <div className="text-sm font-semibold text-text-main">Delete Board</div>
                            <div className="mt-1 text-xs text-text-muted">
                                This will remove <span className="font-medium text-white">{scopeName}</span> from this screen.
                            </div>
                        </div>
                        <div className="px-5 py-4 text-sm text-text-muted">
                            Any editable tasks and actuals history saved inside this board will also be removed from Mission Control.
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setBoardDeleteOpen(false)}
                                className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteBoard}
                                disabled={isPending}
                                className="inline-flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-60"
                            >
                                <Trash2 className="w-4 h-4" />
                                Delete Board
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {folderDeleteOpen && scopeType === "folder" && (
                <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                    <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                        <div className="border-b border-border/50 bg-surface/80 px-5 py-4">
                            <div className="text-sm font-semibold text-text-main">Delete Team</div>
                            <div className="mt-1 text-xs text-text-muted">
                                This will remove <span className="font-medium text-white">{scopeName}</span> from this screen.
                            </div>
                        </div>
                        <div className="px-5 py-4 text-sm text-text-muted">
                            Boards inside this team will no longer appear in Mission Control until the folder is restored or recreated.
                        </div>
                        <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                            <button
                                type="button"
                                onClick={() => setFolderDeleteOpen(false)}
                                className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleDeleteFolder}
                                disabled={isPending}
                                className="inline-flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20 disabled:opacity-60"
                            >
                                <Trash2 className="w-4 h-4" />
                                Delete Team
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
