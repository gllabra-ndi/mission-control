"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useTransition, type FocusEvent } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addDays, addWeeks, format, startOfWeek, subWeeks } from "date-fns";
import {
    CapacityGridAllocation,
    CapacityGridPayload,
    CapacityGridResource,
    CapacityGridRow,
    ClientDirectoryRecord,
    EditableTaskBillableRollupRecord,
    EditableTaskPlannedRollupRecord,
    copyCapacityGridFromPriorWeek,
    updateCapacityGridConfig
} from "@/app/actions";
import { ArrowUpRight, ChevronLeft, ChevronRight, Copy, Grid2x2, Save, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImportedTask } from "@/lib/imported-data";
import type { FolderWithLists } from "@/components/Sidebar";

interface CapacityGridProps {
    activeWeekStr: string;
    initialGrid: CapacityGridPayload;
    onGridChange?: (nextGrid: CapacityGridPayload) => void;
    consultants?: Array<{ id: number; name: string }>;
    consultantConfigsById?: Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>;
    clientDirectory?: ClientDirectoryRecord[];
    tasks?: ImportedTask[];
    folders?: FolderWithLists[];
    activeAssigneeFilter?: string | null;
    plannedRollups?: EditableTaskPlannedRollupRecord[];
    billableRollups?: EditableTaskBillableRollupRecord[];
    onNavigateWeek?: (nextWeek: string) => void;
    onOpenTaskBoard?: (target: {
        listId?: string | null;
        folderId?: string | null;
        assignee?: string | null;
        returnTo?: string | null;
    }) => void;
    isWeekLoading?: boolean;
}

function toNumber(value: string): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function normalizeName(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getTaskScopeLabels(task: ImportedTask | null) {
    return [
        String(task?.list?.name ?? "").trim(),
        String(task?.project?.name ?? "").trim(),
        String(task?.folder?.name ?? "").trim(),
    ].filter(Boolean);
}

function formatConsultantHeaderName(value: string) {
    const tokens = String(value || "").trim().split(/\s+/).filter(Boolean);
    if (tokens.length <= 1) return tokens[0] ?? "";
    return [tokens[0], ...tokens.slice(1).map((token) => `${token[0]?.toUpperCase() || ""}.`)].join(" ");
}

function isClairioClient(value: string) {
    return normalizeName(value) === "clairio";
}

function clientIdFromName(value: string) {
    const normalized = normalizeName(value);
    return normalized.length > 0 ? normalized : `client-${Date.now()}`;
}

function clampNonNegative(value: number) {
    return Math.max(0, value);
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

function sanitizeCapacityRows(rows: CapacityGridRow[] = []): CapacityGridRow[] {
    return rows.map((row) => ({
        ...row,
        team: clampNonNegative(Number(row.team ?? 0)),
        wkMin: clampNonNegative(Number(row.wkMin ?? 0)),
        wkMax: clampNonNegative(Number(row.wkMax ?? 0)),
        allocations: Object.fromEntries(
            Object.entries(row.allocations ?? {}).map(([resourceId, allocation]) => [
                resourceId,
                {
                    ...allocation,
                    hours: clampNonNegative(Number(allocation?.hours ?? 0)),
                },
            ])
        ),
    }));
}

type AllocationNoteEditorState = {
    rowId: string;
    resourceId: string;
    clientName: string;
    consultantName: string;
    note: string;
};

type RemoveClientConfirmState = {
    rowId: string;
    clientName: string;
};

const clientHeaderStickyClass = "sticky left-0 z-50 bg-[#111626] shadow-[6px_0_8px_-8px_rgba(15,23,42,0.9)]";
const clientBodyStickyClass = "sticky left-0 z-20 bg-[#0f1529] shadow-[6px_0_8px_-8px_rgba(15,23,42,0.9)]";
const clientFooterStickyClass = "sticky left-0 z-20 shadow-[6px_0_8px_-8px_rgba(15,23,42,0.9)]";
const headerTopRowStickyClass = "sticky top-0 z-40 bg-[#111626]";
const monochromeMetricCardClass = "rounded-[22px] border border-border/50 bg-[linear-gradient(180deg,rgba(23,27,39,0.92)_0%,rgba(13,18,29,0.92)_100%)] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.18)]";

export function CapacityGrid({
    activeWeekStr,
    initialGrid,
    onGridChange,
    consultants = [],
    consultantConfigsById = {},
    clientDirectory = [],
    tasks = [],
    folders = [],
    activeAssigneeFilter = null,
    plannedRollups = [],
    billableRollups = [],
    onNavigateWeek,
    onOpenTaskBoard,
    isWeekLoading = false,
}: CapacityGridProps) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const [isWeekNavLocked, setIsWeekNavLocked] = useState(false);

    const [resources, setResources] = useState<CapacityGridResource[]>(initialGrid?.resources ?? []);
    const [rows, setRows] = useState<CapacityGridRow[]>(sanitizeCapacityRows(initialGrid?.rows ?? []));
    const [consultantConfigs, setConsultantConfigs] = useState<Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>>(consultantConfigsById);
    const [noteEditor, setNoteEditor] = useState<AllocationNoteEditorState | null>(null);
    const [removeClientConfirm, setRemoveClientConfirm] = useState<RemoveClientConfirmState | null>(null);
    const [gridMode, setGridMode] = useState<"plan" | "view">("plan");
    const [allocationInputDrafts, setAllocationInputDrafts] = useState<Record<string, string>>({});
    const initializedWeekRef = useRef<string>("");
    const navUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const gridScrollRef = useRef<HTMLDivElement | null>(null);
    const restoredViewKeyRef = useRef<string>("");

    useEffect(() => {
        // Prevent render loops: only rehydrate local grid state when week changes.
        if (initializedWeekRef.current === activeWeekStr) return;
        initializedWeekRef.current = activeWeekStr;
        setResources(initialGrid?.resources ?? []);
        setRows(sanitizeCapacityRows(initialGrid?.rows ?? []));
        setAllocationInputDrafts({});
    }, [activeWeekStr, initialGrid?.resources, initialGrid?.rows]);

    useEffect(() => {
        setConsultantConfigs(consultantConfigsById);
    }, [activeWeekStr, consultantConfigsById]);

    const visibleResources = useMemo(
        () => resources.filter((resource) => !resource.removed),
        [resources]
    );

    const clientDirectoryLookup = useMemo(() => {
        const byId = new Map<string, ClientDirectoryRecord>();
        const byName = new Map<string, ClientDirectoryRecord>();
        clientDirectory.forEach((client) => {
            if (!client || client.isActive === false) return;
            const idKey = normalizeName(String(client.id ?? ""));
            const nameKey = normalizeName(String(client.name ?? ""));
            if (idKey) byId.set(idKey, client);
            if (nameKey) byName.set(nameKey, client);
        });
        return { byId, byName };
    }, [clientDirectory]);

    const sourceTaskById = useMemo(() => {
        const byId = new Map<string, ImportedTask>();
        tasks.forEach((task) => {
            const id = String(task?.id ?? "").trim();
            if (!id) return;
            byId.set(id, task);
        });
        return byId;
    }, [tasks]);

    const folderBoardEntries = useMemo(() => (
        folders.flatMap((folder) =>
            folder.lists.map((list) => ({
                id: String(list.id),
                name: String(list.name),
                folderId: String(folder.id),
                folderName: String(folder.name),
            }))
        )
    ), [folders]);

    const getClientMetadata = useCallback((row: CapacityGridRow) => {
        const idKey = normalizeName(String(row.id ?? ""));
        const nameKey = normalizeName(String(row.client ?? ""));
        return clientDirectoryLookup.byId.get(idKey) ?? clientDirectoryLookup.byName.get(nameKey) ?? null;
    }, [clientDirectoryLookup]);

    const activeWeekDate = useMemo(() => new Date(activeWeekStr + "T00:00:00"), [activeWeekStr]);
    const isNavigationBlocked = !onNavigateWeek && (isWeekNavLocked || isWeekLoading);
    const weekParamFor = useCallback((nextDate: Date) => {
        const params = new URLSearchParams(searchParams?.toString() ?? "");
        params.set("week", format(nextDate, "yyyy-MM-dd"));
        params.set("tab", "capacity-grid");
        params.delete("gridScrollLeft");
        params.delete("gridScrollTop");
        params.delete("gridRowId");
        params.delete("gridResourceId");
        return `${pathname}?${params.toString()}`;
    }, [pathname, searchParams]);
    const buildCapacityReturnTo = useCallback((rowId?: string | null, resourceId?: string | null) => {
        const params = new URLSearchParams(searchParams?.toString() ?? "");
        params.set("tab", "capacity-grid");
        params.set("week", activeWeekStr);
        const scrollLeft = Number(gridScrollRef.current?.scrollLeft ?? 0);
        const scrollTop = Number(gridScrollRef.current?.scrollTop ?? 0);
        params.set("gridScrollLeft", String(Math.round(scrollLeft)));
        params.set("gridScrollTop", String(Math.round(scrollTop)));
        if (rowId) {
            params.set("gridRowId", rowId);
        }
        if (resourceId) {
            params.set("gridResourceId", resourceId);
        }
        return `${pathname}?${params.toString()}`;
    }, [activeWeekStr, pathname, searchParams]);

    const resolveClientBoardTarget = useCallback((row: CapacityGridRow, resource: CapacityGridResource, consultantName?: string | null) => {
        const clientName = row.client;
        const normalizedClient = normalizeName(clientName);
        if (!normalizedClient) return null;
        const returnTo = buildCapacityReturnTo(row.id, resource.id);
        const assignee = consultantName && consultantName.trim().length > 0
            ? consultantName.trim()
            : activeAssigneeFilter && activeAssigneeFilter.trim().length > 0
                ? activeAssigneeFilter.trim()
                : null;
        const assigneeParam = consultantName && consultantName.trim().length > 0
            ? `&assignee=${encodeURIComponent(consultantName.trim())}`
            : activeAssigneeFilter && activeAssigneeFilter.trim().length > 0
                ? `&assignee=${encodeURIComponent(activeAssigneeFilter.trim())}`
                : "";

        const exactList = folderBoardEntries.find((entry) => normalizeName(entry.name) === normalizedClient);

        if (exactList) {
            return {
                listId: exactList.id,
                folderId: null,
                assignee,
                returnTo,
                href: `/?week=${activeWeekStr}&tab=issues&listId=${encodeURIComponent(exactList.id)}${assigneeParam}&returnTo=${encodeURIComponent(returnTo)}`,
            };
        }

        const fuzzyList = folderBoardEntries.find((entry) => {
            const entryName = normalizeName(entry.name);
            return entryName.includes(normalizedClient) || normalizedClient.includes(entryName);
        });

        if (fuzzyList) {
            return {
                listId: fuzzyList.id,
                folderId: null,
                assignee,
                returnTo,
                href: `/?week=${activeWeekStr}&tab=issues&listId=${encodeURIComponent(fuzzyList.id)}${assigneeParam}&returnTo=${encodeURIComponent(returnTo)}`,
            };
        }

        const exactFolder = folders.find((folder) => normalizeName(folder.name) === normalizedClient);
        if (exactFolder) {
            return {
                listId: null,
                folderId: String(exactFolder.id),
                assignee,
                returnTo,
                href: `/?week=${activeWeekStr}&tab=issues&folderId=${encodeURIComponent(exactFolder.id)}${assigneeParam}&returnTo=${encodeURIComponent(returnTo)}`,
            };
        }

        const fuzzyFolder = folders.find((folder) => {
            const folderName = normalizeName(folder.name);
            return folderName.includes(normalizedClient) || normalizedClient.includes(folderName);
        });
        if (fuzzyFolder) {
            return {
                listId: null,
                folderId: String(fuzzyFolder.id),
                assignee,
                returnTo,
                href: `/?week=${activeWeekStr}&tab=issues&folderId=${encodeURIComponent(fuzzyFolder.id)}${assigneeParam}&returnTo=${encodeURIComponent(returnTo)}`,
            };
        }

        return null;
    }, [activeAssigneeFilter, activeWeekStr, buildCapacityReturnTo, folderBoardEntries, folders]);

    const handleOpenTaskBoard = useCallback((target: {
        listId?: string | null;
        folderId?: string | null;
        assignee?: string | null;
        returnTo?: string | null;
        href: string;
    } | null) => {
        if (!target) return;
        if (onOpenTaskBoard) {
            onOpenTaskBoard({
                listId: target.listId ?? null,
                folderId: target.folderId ?? null,
                assignee: target.assignee ?? null,
                returnTo: target.returnTo ?? null,
            });
            return;
        }
        window.location.href = target.href;
    }, [onOpenTaskBoard]);

    useEffect(() => {
        const rowId = searchParams?.get("gridRowId") ?? "";
        const resourceId = searchParams?.get("gridResourceId") ?? "";
        const scrollLeft = Number(searchParams?.get("gridScrollLeft") ?? 0);
        const scrollTop = Number(searchParams?.get("gridScrollTop") ?? 0);
        const restoreKey = `${activeWeekStr}|${rowId}|${resourceId}|${scrollLeft}|${scrollTop}`;
        if (!rowId && !resourceId && !scrollLeft && !scrollTop) return;
        if (restoredViewKeyRef.current === restoreKey) return;

        const restore = () => {
            const container = gridScrollRef.current;
            if (!container) return;
            container.scrollTo({
                left: Number.isFinite(scrollLeft) ? scrollLeft : 0,
                top: Number.isFinite(scrollTop) ? scrollTop : 0,
                behavior: "auto",
            });

            if (rowId && resourceId) {
                const target = container.querySelector<HTMLElement>(`[data-grid-cell="${rowId}:${resourceId}"]`);
                if (target) {
                    target.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
                }
            }

            restoredViewKeyRef.current = restoreKey;
        };

        const timer = window.setTimeout(restore, 80);
        return () => window.clearTimeout(timer);
    }, [activeWeekStr, rows, visibleResources, searchParams]);

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
        if (isNavigationBlocked) return;
        const currentWeekStr = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
        if (nextDate === null && activeWeekStr === currentWeekStr) return;
        if (nextDate && format(nextDate, "yyyy-MM-dd") === activeWeekStr) return;

        const href = nextDate ? weekParamFor(nextDate) : `${pathname}?tab=capacity-grid`;
        if (onNavigateWeek) {
            onNavigateWeek(nextDate ? format(nextDate, "yyyy-MM-dd") : currentWeekStr);
        } else {
            setIsWeekNavLocked(true);
            router.push(href, { scroll: false });
            navUnlockTimerRef.current = setTimeout(() => {
                setIsWeekNavLocked(false);
                navUnlockTimerRef.current = null;
            }, 500);
        }
    }, [activeWeekStr, isNavigationBlocked, onNavigateWeek, pathname, router, weekParamFor]);

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
        if (!onNavigateWeek) {
            router.prefetch(previousWeekHref);
            router.prefetch(nextWeekHref);
            router.prefetch("/?tab=capacity-grid");
        }
    }, [router, activeWeekDate, activeWeekStr, onNavigateWeek, weekParamFor]);

    const persist = useCallback((nextRows: CapacityGridRow[], nextResources: CapacityGridResource[] = resources) => {
        const sanitizedRows = sanitizeCapacityRows(nextRows);
        const nextPayload: CapacityGridPayload = {
            resources: nextResources,
            rows: sanitizedRows,
        };
        onGridChange?.(nextPayload);
        startTransition(() => {
            updateCapacityGridConfig(activeWeekStr, {
                resources: nextPayload.resources,
                rows: nextPayload.rows,
            });
        });
    }, [activeWeekStr, onGridChange, resources, startTransition]);

    const handleCopyPriorWeek = () => {
        startTransition(async () => {
            const copied = await copyCapacityGridFromPriorWeek(activeWeekStr, consultants);
            setResources(copied.resources ?? []);
            setRows(sanitizeCapacityRows(copied.rows ?? []));
            onGridChange?.(copied);
        });
    };

    const updateRow = (rowId: string, patch: Partial<CapacityGridRow>) => {
        setRows((prev) => {
            const nextRows = sanitizeCapacityRows(
                prev.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
            );
            onGridChange?.({ resources, rows: nextRows });
            return nextRows;
        });
    };

    const getAllocationDraftKey = useCallback((rowId: string, resourceId: string) => `${rowId}:${resourceId}`, []);

    const commitAllocationInput = useCallback((rowId: string, resourceId: string) => {
        const draftKey = getAllocationDraftKey(rowId, resourceId);
        const currentRow = rows.find((row) => row.id === rowId);
        const currentHours = Number(currentRow?.allocations?.[resourceId]?.hours ?? 0);
        const currentSource = String(currentRow?.allocations?.[resourceId]?.source ?? "empty");
        const rawDraft = allocationInputDrafts[draftKey];
        const nextValue = clampNonNegative(toNumber(rawDraft ?? formatEditableNumber(currentHours)));
        const shouldLockManual = rawDraft !== undefined && currentSource !== "manual";
        if (nextValue !== currentHours || shouldLockManual) {
            const nextRows = rows.map((row) => {
                if (row.id !== rowId) return row;
                const nextAllocations: Record<string, CapacityGridAllocation> = {
                    ...row.allocations,
                    [resourceId]: {
                        ...row.allocations[resourceId],
                        hours: nextValue,
                        source: "manual",
                    },
                };
                return {
                    ...row,
                    allocations: nextAllocations,
                };
            });
            setRows(nextRows);
            onGridChange?.({ resources, rows: nextRows });
            persist(nextRows);
        }
        setAllocationInputDrafts((prev) => {
            const next = { ...prev };
            delete next[draftKey];
            return next;
        });
    }, [allocationInputDrafts, getAllocationDraftKey, onGridChange, persist, resources, rows]);

    const updateAllocationNote = (
        rowId: string,
        resourceId: string,
        note: string
    ) => {
        setRows((prev) => {
            const nextRows = prev.map((row) => {
                if (row.id !== rowId) return row;
                return {
                    ...row,
                    allocations: {
                        ...row.allocations,
                        [resourceId]: {
                            ...row.allocations[resourceId],
                            note,
                            source: "manual" as const,
                        },
                    },
                };
            });
            onGridChange?.({ resources, rows: nextRows });
            return nextRows;
        });
    };

    const handleEditAllocationNote = (rowId: string, resourceId: string, clientName: string, consultantName: string) => {
        const currentRow = rows.find((row) => row.id === rowId);
        const currentNote = String(currentRow?.allocations?.[resourceId]?.note ?? "");
        setNoteEditor({
            rowId,
            resourceId,
            clientName,
            consultantName,
            note: currentNote,
        });
    };

    const handleSaveAllocationNote = () => {
        if (!noteEditor) return;
        const nextNote = noteEditor.note.replace(/\r\n/g, "\n");
        updateAllocationNote(noteEditor.rowId, noteEditor.resourceId, nextNote);
        const nextRows = rows.map((row) => {
            if (row.id !== noteEditor.rowId) return row;
            return {
                ...row,
                allocations: {
                    ...row.allocations,
                    [noteEditor.resourceId]: {
                        ...row.allocations[noteEditor.resourceId],
                        note: nextNote,
                        source: "manual" as const,
                    },
                },
            };
        });
        persist(nextRows);
        setNoteEditor(null);
    };

    const handleAddClient = () => {
        const name = window.prompt("Client name");
        if (!name) return;
        const trimmed = name.trim();
        if (!trimmed) return;

        const existingIds = new Set(rows.map((row) => String(row.id)));
        let nextId = clientIdFromName(trimmed);
        let suffix = 2;
        while (existingIds.has(nextId)) {
            nextId = `${clientIdFromName(trimmed)}-${suffix++}`;
        }

            const allocations = resources.reduce<Record<string, { hours: number; source: "empty"; note: string }>>((acc, resource) => {
                acc[resource.id] = { hours: 0, source: "empty", note: "" };
                return acc;
            }, {});

        const nextRows = [
            ...rows,
            {
                id: nextId,
                team: 0,
                teamSa: "",
                dealType: "",
                wkMin: 0,
                wkMax: 0,
                client: trimmed,
                notes: "",
                allocations,
            },
        ];

        setRows(nextRows);
        persist(nextRows);
    };

    const handleRemoveClient = (rowId: string, clientName: string) => {
        setRemoveClientConfirm({ rowId, clientName });
    };

    const handleConfirmRemoveClient = () => {
        if (!removeClientConfirm) return;
        const nextRows = rows.filter((row) => row.id !== removeClientConfirm.rowId);
        setRows(nextRows);
        persist(nextRows);
        setRemoveClientConfirm(null);
    };

    const rowStats = useMemo(() => {
        return rows.map((row) => {
            const clientMeta = getClientMetadata(row);
            const rowMin = Number(row.wkMin ?? clientMeta?.min ?? 0);
            const rowMax = Number(row.wkMax ?? clientMeta?.max ?? 0);
            const total = visibleResources.reduce((sum, resource) => sum + Number(row.allocations[resource.id]?.hours ?? 0), 0);
            return {
                id: row.id,
                total,
                gapToMin: total - rowMin,
                gapToMax: rowMax - total,
            };
        });
    }, [getClientMetadata, rows, visibleResources]);

    const displayRows = useMemo(() => {
        const regularRows: CapacityGridRow[] = [];
        const clairioRows: CapacityGridRow[] = [];

        rows.forEach((row) => {
            const clientMeta = getClientMetadata(row);
            const clientName = String(clientMeta?.name ?? row.client ?? "");
            if (isClairioClient(clientName)) {
                clairioRows.push(row);
            } else {
                regularRows.push(row);
            }
        });

        return [...regularRows, ...clairioRows];
    }, [getClientMetadata, rows]);

    const totals = useMemo(() => {
        const hoursByResource: Record<string, number> = {};
        visibleResources.forEach((resource) => {
            hoursByResource[resource.id] = rows.reduce((sum, row) => sum + Number(row.allocations[resource.id]?.hours ?? 0), 0);
        });

        const wkMinTotal = rows.reduce((sum, row) => {
            const clientMeta = getClientMetadata(row);
            return sum + Number(row.wkMin ?? clientMeta?.min ?? 0);
        }, 0);
        const wkMaxTotal = rows.reduce((sum, row) => {
            const clientMeta = getClientMetadata(row);
            return sum + Number(row.wkMax ?? clientMeta?.max ?? 0);
        }, 0);
        const totalHours = Object.values(hoursByResource).reduce((a, b) => a + b, 0);

        return {
            hoursByResource,
            wkMinTotal,
            wkMaxTotal,
            totalHours,
            gapToMin: totalHours - wkMinTotal,
            gapToMax: wkMaxTotal - totalHours,
        };
    }, [getClientMetadata, rows, visibleResources]);

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
        visibleResources.forEach((resource) => {
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
    }, [visibleResources, consultants, consultantConfigs]);

    const totalCapacity = useMemo(
        () => Object.values(billableCapacityByResource).reduce((sum, hours) => sum + Number(hours || 0), 0),
        [billableCapacityByResource]
    );

    const getConsultantHeaderNameClass = (resourceId: string) => {
        const cap = Number(billableCapacityByResource[resourceId] ?? 0);
        const allocated = Number(totals.hoursByResource[resourceId] ?? 0);
        const bothZero = Math.abs(allocated) < 0.01 && Math.abs(cap) < 0.01;
        if (bothZero) return "text-white";
        if (Math.abs(allocated - cap) < 0.01) return "text-emerald-400";
        if (allocated > cap) return "text-red-400";
        return "text-white";
    };

    const getConsultantHeaderDetailClass = (resourceId: string) => {
        const cap = Number(billableCapacityByResource[resourceId] ?? 0);
        const allocated = Number(totals.hoursByResource[resourceId] ?? 0);
        const bothZero = Math.abs(allocated) < 0.01 && Math.abs(cap) < 0.01;
        if (bothZero) return "text-white";
        if (Math.abs(allocated - cap) < 0.01) return "text-emerald-400";
        if (Math.abs(allocated) > 0.01 || Math.abs(cap) > 0.01) return "text-amber-300";
        return "text-white";
    };

    const getClientStatusClass = (total: number, wkMin: number, wkMax: number) => {
        if (total < wkMin) return "text-white";
        if (wkMax > 0 && total > wkMax) return "text-red-400";
        return "text-emerald-400";
    };

    const getClientMetaLineClass = (total: number, wkMin: number, wkMax: number) => {
        if (total < wkMin) return "text-slate-300";
        if (wkMax > 0 && total > wkMax) return "text-red-300";
        return "text-emerald-300";
    };

    const getClientMaxStatusLabel = (total: number, wkMax: number) => {
        if (wkMax <= 0) return "No Max Set";
        const diff = Number((total - wkMax).toFixed(1));
        if (Math.abs(diff) < 0.05) return "On Max";
        if (diff > 0) return `${diff.toFixed(1)} Over Max`;
        return `${Math.abs(diff).toFixed(1)} Under Max`;
    };

    const getClientMaxStatusClass = (total: number, wkMin: number, wkMax: number) => {
        if (wkMax <= 0) return "text-text-muted";
        if (total < wkMin) return "text-white";
        if (total > wkMax) return "text-red-300";
        return "text-emerald-300";
    };

    const getScopeLabels = useCallback((scopeType: string, scopeId: string, sourceTaskId?: string | null) => {
        const sourceTask = sourceTaskId ? sourceTaskById.get(String(sourceTaskId).trim()) ?? null : null;
        if (sourceTask && (scopeType === "all" || scopeId === "all")) {
            const taskLabels = getTaskScopeLabels(sourceTask);
            if (taskLabels.length > 0) return taskLabels;
        }
        if (scopeType === "list") {
            const match = folders.flatMap((folder) => folder.lists).find((list) => String(list.id) === String(scopeId));
            return [match?.name ?? scopeId].filter(Boolean);
        }
        if (scopeType === "folder") {
            const match = folders.find((folder) => String(folder.id) === String(scopeId));
            return [match?.name ?? scopeId].filter(Boolean);
        }
        return [scopeId].filter(Boolean);
    }, [folders, sourceTaskById]);

    const getBillableActualsForCell = useCallback((row: CapacityGridRow, resource: CapacityGridResource) => {
        const rowClientKey = normalizeName(String(row.client || ""));
        const rowIdKey = normalizeName(String(row.id || ""));
        if (!rowClientKey && !rowIdKey) return 0;

        const resourceFullKey = normalizeName(String(resource.name || ""));
        const resourceFirstKey = normalizeName(String(resource.name || "").split(/\s+/)[0] || "");
        if (!resourceFullKey && !resourceFirstKey) return 0;

        return billableRollups.reduce((sum, rollup) => {
            const assigneeFullKey = normalizeName(String(rollup.assignee || ""));
            const assigneeFirstKey = normalizeName(String(rollup.assignee || "").split(/\s+/)[0] || "");
            const consultantMatch = (
                (resourceFullKey && assigneeFullKey === resourceFullKey)
                || (resourceFirstKey && assigneeFullKey === resourceFirstKey)
                || (resourceFullKey && assigneeFirstKey === resourceFullKey)
                || (resourceFirstKey && assigneeFirstKey === resourceFirstKey)
            );
            if (!consultantMatch) return sum;

            const scopeMatches = getScopeLabels(
                String(rollup.scopeType || ""),
                String(rollup.scopeId || ""),
                rollup.sourceTaskId
            ).some((label) => {
                const labelKey = normalizeName(label);
                return labelKey.length > 0 && (
                    labelKey === rowClientKey
                    || labelKey === rowIdKey
                    || labelKey.includes(rowClientKey)
                    || rowClientKey.includes(labelKey)
                    || (rowIdKey.length > 0 && (labelKey.includes(rowIdKey) || rowIdKey.includes(labelKey)))
                );
            });

            if (!scopeMatches) return sum;
            return sum + Number(rollup.hours ?? 0);
        }, 0);
    }, [billableRollups, getScopeLabels]);

    const getTaskEstimateForCell = useCallback((row: CapacityGridRow, resource: CapacityGridResource) => {
        const rowClientKey = normalizeName(String(row.client || ""));
        const rowIdKey = normalizeName(String(row.id || ""));
        if (!rowClientKey && !rowIdKey) return 0;

        const resourceFullKey = normalizeName(String(resource.name || ""));
        const resourceFirstKey = normalizeName(String(resource.name || "").split(/\s+/)[0] || "");
        if (!resourceFullKey && !resourceFirstKey) return 0;

        return plannedRollups.reduce((sum, rollup) => {
            const assigneeFullKey = normalizeName(String(rollup.assignee || ""));
            const assigneeFirstKey = normalizeName(String(rollup.assignee || "").split(/\s+/)[0] || "");
            const consultantMatch = (
                (resourceFullKey && assigneeFullKey === resourceFullKey)
                || (resourceFirstKey && assigneeFullKey === resourceFirstKey)
                || (resourceFullKey && assigneeFirstKey === resourceFullKey)
                || (resourceFirstKey && assigneeFirstKey === resourceFirstKey)
            );
            if (!consultantMatch) return sum;

            const scopeMatches = getScopeLabels(
                String(rollup.scopeType || ""),
                String(rollup.scopeId || ""),
                rollup.sourceTaskId
            ).some((label) => {
                const labelKey = normalizeName(label);
                return labelKey.length > 0 && (
                    labelKey === rowClientKey
                    || labelKey === rowIdKey
                    || labelKey.includes(rowClientKey)
                    || rowClientKey.includes(labelKey)
                    || (rowIdKey.length > 0 && (labelKey.includes(rowIdKey) || rowIdKey.includes(labelKey)))
                );
            });

            if (!scopeMatches) return sum;
            return sum + Number(rollup.hours ?? 0);
        }, 0);
    }, [getScopeLabels, plannedRollups]);

    const actualsByResource = useMemo(() => {
        const result: Record<string, number> = {};
        visibleResources.forEach((resource) => {
            result[resource.id] = rows.reduce((sum, row) => {
                return sum + Number(getBillableActualsForCell(row, resource) ?? 0);
            }, 0);
        });
        return result;
    }, [rows, visibleResources, getBillableActualsForCell]);

    const totalActuals = useMemo(() => {
        return Object.values(actualsByResource).reduce((sum, value) => sum + Number(value ?? 0), 0);
    }, [actualsByResource]);

    const weekLabel = `${format(activeWeekDate, "MM/dd")} to ${format(addDays(activeWeekDate, 4), "MM/dd")}`;
    const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
    const isCurrentWeek = activeWeekStr === format(currentWeekStart, "yyyy-MM-dd");
    const weekNumber = format(activeWeekDate, "II");
    const weekRangeLabel = `${format(activeWeekDate, "MMM d")} to ${format(addDays(activeWeekDate, 4), "MMM d")}`;

    return (
        <>
        <section className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3 flex-wrap rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(21,26,43,0.96)_0%,rgba(13,18,29,0.96)_100%)] px-5 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
                <div className="flex items-center gap-4 flex-wrap">
                    <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shadow-[0_0_10px_rgba(148,163,184,0.35)]" />
                        Plan vs Actuals
                    </h2>
                    <div className="flex items-center overflow-hidden rounded-xl border border-border/60 bg-[#0f1320]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                        <button
                            onClick={handlePrevWeek}
                            disabled={isNavigationBlocked}
                            className="flex h-10 w-10 items-center justify-center border-r border-border/60 text-text-muted transition-colors hover:bg-surface-hover hover:text-white"
                            aria-label="Previous week"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <div className="min-w-[220px] px-4 py-2">
                            <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Week W{weekNumber}</div>
                            <div className="mt-1 text-sm font-semibold text-white">{weekRangeLabel}</div>
                        </div>
                        <button
                            onClick={handleNextWeek}
                            disabled={isNavigationBlocked}
                            className="flex h-10 w-10 items-center justify-center border-l border-border/60 text-text-muted transition-colors hover:bg-surface-hover hover:text-white"
                            aria-label="Next week"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                    <button
                        onClick={handleCurrentWeek}
                        disabled={isNavigationBlocked}
                        className={cn(
                            "h-10 rounded-xl border px-4 text-xs font-semibold transition-colors",
                            isCurrentWeek
                                ? "border-border/70 bg-white/[0.05] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.06)]"
                                : "border-border/60 bg-[#0f1320]/70 text-text-muted hover:bg-surface-hover hover:text-white"
                        )}
                    >
                        Current Week
                    </button>
                    <span className="rounded-full border border-border/50 bg-surface/20 px-3 py-1 text-xs text-text-muted">{weekLabel}</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex items-center rounded-xl border border-border/60 bg-[#0f1320]/80 p-1">
                        <button
                            type="button"
                            onClick={() => setGridMode("plan")}
                            className={cn(
                                "rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                                gridMode === "plan" ? "bg-white/[0.08] text-white" : "text-text-muted hover:text-white"
                            )}
                        >
                            Plan View
                        </button>
                        <button
                            type="button"
                            onClick={() => setGridMode("view")}
                            className={cn(
                                "rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                                gridMode === "view" ? "bg-white/[0.08] text-white" : "text-text-muted hover:text-white"
                            )}
                        >
                            View Mode
                        </button>
                    </div>
                    <button
                        type="button"
                        onClick={handleCopyPriorWeek}
                        className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-[#0f1320]/80 px-4 py-2 text-xs font-semibold text-text-main hover:bg-surface-hover"
                    >
                        <Copy className="w-3.5 h-3.5" />
                        Copy Prior Week
                    </button>
                    <span className="rounded-full border border-border/50 bg-surface/20 px-3 py-1 text-[11px] text-text-muted">
                        {isWeekLoading ? "Loading..." : isPending ? "Saving..." : "Weekly client plan saved locally"}
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                <div className={monochromeMetricCardClass}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Billable Capacity</div>
                    <div className="mt-2 text-3xl font-bold text-white">{totalCapacity.toFixed(1)}</div>
                </div>
                <div className={monochromeMetricCardClass}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Planned</div>
                    <div className="mt-2 text-3xl font-bold text-white">{totals.totalHours.toFixed(1)}</div>
                </div>
                <div className={monochromeMetricCardClass}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Actuals</div>
                    <div className="mt-2 text-3xl font-bold text-white">{totalActuals.toFixed(1)}</div>
                </div>
                <div className={monochromeMetricCardClass}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">WK Min Total</div>
                    <div className="mt-2 text-3xl font-bold text-white">{totals.wkMinTotal.toFixed(1)}</div>
                </div>
                <div className={monochromeMetricCardClass}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">WK Max Total</div>
                    <div className="mt-2 text-3xl font-bold text-white">{totals.wkMaxTotal.toFixed(1)}</div>
                </div>
                <div className={monochromeMetricCardClass}>
                    <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">Gap vs WK Min</div>
                    <div className={cn("mt-2 text-3xl font-bold", totals.gapToMin >= 0 ? "text-white" : "text-slate-400")}>
                        {totals.gapToMin.toFixed(1)}
                    </div>
                </div>
            </div>

            <div ref={gridScrollRef} className="relative max-h-[calc(100vh-18rem)] overflow-auto rounded-[28px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
                <table className="min-w-[1440px] w-full border-separate border-spacing-0 text-[12px]">
                    <thead>
                        <tr className="border-b-2 border-border/50 text-text-muted text-[11px] font-bold tracking-wider bg-[#111626]/90 text-[#94a3b8] cap-none">
                            <th className={cn("px-2 py-2 text-left border-r border-border/40", headerTopRowStickyClass, clientHeaderStickyClass)}>
                                <div className="rounded-xl border border-border/55 bg-[#1a2035] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
                                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Client</div>
                                </div>
                            </th>
                            {visibleResources.map((resource) => {
                                const used = Number(totals.hoursByResource[resource.id] ?? 0);
                                const maxBillable = Number(billableCapacityByResource[resource.id] ?? 0);
                                const displayName = formatConsultantHeaderName(resource.name);
                                return (
                                    <th key={resource.id} className={cn("w-[172px] min-w-[172px] max-w-[172px] px-2 py-2 text-center border-r border-border/40", headerTopRowStickyClass)}>
                                        <div className="flex min-h-[102px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-border/55 bg-[#1a2035] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] leading-tight">
                                            <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Consultant</span>
                                            <span
                                                title={resource.name}
                                                className={cn("max-w-full truncate text-center text-[14px] font-semibold leading-4 transition-colors whitespace-nowrap", getConsultantHeaderNameClass(resource.id))}
                                            >
                                                {displayName}
                                            </span>
                                            <span className={cn("max-w-full text-center text-[10px] font-semibold leading-4 whitespace-nowrap", getConsultantHeaderDetailClass(resource.id))}>
                                                Planned {used.toFixed(1)}
                                            </span>
                                            <span className={cn("max-w-full text-center text-[10px] font-semibold leading-4 whitespace-nowrap", getConsultantHeaderDetailClass(resource.id))}>
                                                Capacity {maxBillable.toFixed(1)}
                                            </span>
                                        </div>
                                    </th>
                                );
                            })}
                            <th className={cn("px-3 py-3 text-right border-r border-border/40", headerTopRowStickyClass)}>Planned</th>
                            {gridMode === "view" && (
                                <th className={cn("px-3 py-3 text-right border-r border-border/40", headerTopRowStickyClass)}>Actuals</th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {displayRows.map((row, rowIndex) => {
                            const stats = rowStats.find((s) => s.id === row.id);
                            const rowTotal = Number(stats?.total ?? 0);
                            const rowActualTotal = visibleResources.reduce((sum, resource) => sum + Number(getBillableActualsForCell(row, resource) ?? 0), 0);
                            const clientMeta = getClientMetadata(row);
                            const rowMin = Number(row.wkMin ?? clientMeta?.min ?? 0);
                            const rowMax = Number(row.wkMax ?? clientMeta?.max ?? 0);
                            const clientStatusClass = getClientStatusClass(rowTotal, rowMin, rowMax);
                            const laneClass = rowIndex % 2 === 0 ? "bg-[#0d121d]/72 hover:bg-[#12192a]/82" : "bg-[#101622]/78 hover:bg-[#151d30]/86";
                            const laneBorderClass = rowIndex % 2 === 0 ? "border-border/35" : "border-border/20";
                            const clientLaneClass = rowIndex % 2 === 0 ? "bg-[#121b35]" : "bg-[#0f1830]";
                            return (
                                <tr key={row.id} className={cn("border-t transition-colors", laneClass, laneBorderClass)}>
                                    <td className={cn("px-2 py-2 border-r", laneBorderClass, clientBodyStickyClass, clientLaneClass)}>
                                        <div className={cn("w-56 rounded-xl border border-white/[0.04] bg-white/[0.03] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]", clientStatusClass)}>
                                            <div className={cn("font-medium", rowMax > 0 && rowTotal > rowMax ? "text-red-400" : clientStatusClass)}>{clientMeta?.name ?? row.client}</div>
                                            <div className={cn("mt-1 text-[10px] uppercase tracking-[0.18em]", getClientMetaLineClass(rowTotal, rowMin, rowMax))}>
                                                Team {(row.team ?? clientMeta?.team) || "-"} · {row.teamSa || clientMeta?.sa || "No SA"} · {row.dealType || clientMeta?.dealType || "No Deal Type"}
                                            </div>
                                            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-text-muted">
                                                Weekly Min {rowMin.toFixed(1)}h · Weekly Max {rowMax.toFixed(1)}h
                                            </div>
                                            <div className={cn("mt-1 text-[10px] font-semibold uppercase tracking-[0.18em]", getClientMaxStatusClass(rowTotal, rowMin, rowMax))}>
                                                {getClientMaxStatusLabel(rowTotal, rowMax)}
                                            </div>
                                            <div className={cn("mt-1 text-[10px] font-semibold uppercase tracking-[0.18em]", rowTotal >= rowMin ? "text-emerald-300" : "text-amber-300")}>
                                                {rowTotal >= rowMin
                                                    ? `Over Min by ${(rowTotal - rowMin).toFixed(1)}h`
                                                    : `Under Min by ${(rowMin - rowTotal).toFixed(1)}h`}
                                            </div>
                                        </div>
                                    </td>
                                    {visibleResources.map((resource) => (
                                        <Fragment key={`${row.id}-${resource.id}`}>
                                            {(() => {
                                                const plannedHours = Number(row.allocations[resource.id]?.hours ?? 0);
                                                const taskEstimateHours = Number(getTaskEstimateForCell(row, resource) || 0);
                                                const actualHours = Number(getBillableActualsForCell(row, resource) || 0);
                                                const allocationNote = String(row.allocations[resource.id]?.note ?? "");
                                                const clientBoardTarget = resolveClientBoardTarget(row, resource, resource.name);
                                                const plannedVsActualMatch = Math.abs(plannedHours - actualHours) < 0.05;
                                                const bothZero = Math.abs(plannedHours) < 0.05 && Math.abs(actualHours) < 0.05;
                                                const heatMapClass = gridMode !== "view"
                                                    ? "bg-slate-700/35 border-slate-500/45 text-slate-100"
                                                    : bothZero
                                                        ? "bg-slate-700/35 border-slate-500/45 text-slate-100"
                                                        : plannedVsActualMatch
                                                            ? "bg-emerald-500/16 border-emerald-300/40 text-emerald-50"
                                                            : "bg-amber-400/16 border-amber-300/45 text-amber-50";
                                                const noteHighlightClass = allocationNote
                                                    ? "ring-2 ring-slate-300/45 border-slate-300/60 shadow-[0_0_0_1px_rgba(203,213,225,0.16)]"
                                                    : "";
                                                const noteHint = allocationNote ? ` | Note: ${allocationNote}` : "";
                                                const draftKey = getAllocationDraftKey(row.id, resource.id);
                                                const allocationHours = row.allocations[resource.id]?.hours ?? 0;
                                                const inputValue = allocationInputDrafts[draftKey] ?? formatEditableNumber(allocationHours);
                                                return (
                                                    <td
                                                        data-grid-cell={`${row.id}:${resource.id}`}
                                                        className={cn("px-1.5 py-2 text-center border-r", laneBorderClass)}
                                                    >
                                                        <div className={cn("mx-auto flex w-full max-w-[148px] flex-col gap-1 rounded-xl border border-border/40 bg-[#151a2b]/90 p-2", noteHighlightClass)}>
                                                            <div className="flex items-center justify-between text-[9px] uppercase tracking-wide text-text-muted">
                                                                <span>{gridMode === "plan" ? "Plan" : "Plan vs Actual"}</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={(event) => {
                                                                        event.preventDefault();
                                                                        event.stopPropagation();
                                                                        handleOpenTaskBoard(clientBoardTarget);
                                                                    }}
                                                                    disabled={!clientBoardTarget}
                                                                    title={clientBoardTarget ? `Open ${row.client} task board` : `No board match found for ${row.client}`}
                                                                    className="inline-flex items-center justify-center rounded border border-border/50 p-[2px] text-text-muted hover:text-white hover:border-border/80 disabled:cursor-not-allowed disabled:opacity-35"
                                                                    aria-label={`Open ${row.client} task board`}
                                                                >
                                                                    <ArrowUpRight className="h-2.5 w-2.5" />
                                                                </button>
                                                            </div>
                                                            <div className={cn("grid gap-1", gridMode === "view" ? "grid-cols-2" : "grid-cols-1")}>
                                                                <input
                                                                    type="text"
                                                                    inputMode="decimal"
                                                                    value={inputValue}
                                                                    onFocus={(event) => {
                                                                        setAllocationInputDrafts((prev) => (
                                                                            prev[draftKey] !== undefined
                                                                                ? prev
                                                                                : { ...prev, [draftKey]: formatEditableNumber(allocationHours) }
                                                                        ));
                                                                        selectInputValueOnFocus(event);
                                                                    }}
                                                                    onChange={(e) => {
                                                                        const next = sanitizeDecimalDraft(e.target.value);
                                                                        setAllocationInputDrafts((prev) => ({
                                                                            ...prev,
                                                                            [draftKey]: next,
                                                                        }));
                                                                    }}
                                                                    onBlur={() => commitAllocationInput(row.id, resource.id)}
                                                                    onDoubleClick={() => handleEditAllocationNote(row.id, resource.id, row.client, resource.name)}
                                                                    title={`Task Estimate: ${taskEstimateHours.toFixed(1)}h | Logged Actuals: ${actualHours.toFixed(1)}h${noteHint}`}
                                                                    className={cn(
                                                                        "block h-9 min-w-0 rounded border px-2 py-1 text-right text-[12px] font-medium tabular-nums focus:border-border cursor-text",
                                                                        heatMapClass
                                                                    )}
                                                                />
                                                                {gridMode === "view" && (
                                                                    <div
                                                                        onDoubleClick={() => handleEditAllocationNote(row.id, resource.id, row.client, resource.name)}
                                                                        title={allocationNote || "Double-click to add note"}
                                                                        className={cn("flex h-9 items-center justify-end rounded border px-2 py-1 text-right text-[12px] font-medium tabular-nums cursor-pointer", heatMapClass)}
                                                                    >
                                                                        {actualHours.toFixed(1)}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center justify-between text-[9px] uppercase tracking-wide text-text-muted">
                                                                <span>{taskEstimateHours > 0.05 ? `Task Est ${taskEstimateHours.toFixed(1)}h` : "No Task Est"}</span>
                                                                <span>{plannedHours > 0.05 ? `Plan ${plannedHours.toFixed(1)}h` : "Unplanned"}</span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                );
                                            })()}
                                        </Fragment>
                                    ))}
                                    <td className={cn("px-3 py-2 text-right border-r font-bold text-white", laneBorderClass)}>
                                        <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                            {Number(stats?.total ?? 0).toFixed(1)}
                                        </div>
                                    </td>
                                    {gridMode === "view" && (
                                        <td className={cn("px-3 py-2 text-right border-r font-medium text-slate-100", laneBorderClass)}>
                                            {Number(rowActualTotal ?? 0).toFixed(1)}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr className="border-t border-border/40 bg-white/[0.03]">
                            <td className="px-3 py-2 font-semibold text-text-main border-r border-border/30">
                                Totals
                            </td>
                            {visibleResources.map((resource) => (
                                <td key={`tot-${resource.id}`} className="px-2 py-2 border-r border-border/20 text-right text-[11px] font-semibold text-text-main">
                                    <div className="inline-flex min-w-[4.5rem] justify-end rounded border border-border/35 bg-surface/30 px-1.5 py-1">
                                        {totals.hoursByResource[resource.id].toFixed(1)}
                                    </div>
                                </td>
                            ))}
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30">
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totals.totalHours.toFixed(1)}
                                </div>
                            </td>
                            {gridMode === "view" && (
                                <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-slate-100">
                                    <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/45 bg-white/[0.04] px-2 py-1 text-slate-100">
                                        {totalActuals.toFixed(1)}
                                    </div>
                                </td>
                            )}
                        </tr>
                        <tr className="border-t border-border/30 bg-surface/20">
                            <td className="px-3 py-2 font-semibold text-text-main border-r border-border/30">
                                Billable Capacity
                            </td>
                            {visibleResources.map((resource) => (
                                <td key={`cap-${resource.id}`} className="px-2 py-2 border-r border-border/20 text-center text-[11px] font-semibold text-slate-300">
                                    <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                        {Number(billableCapacityByResource[resource.id] ?? 0).toFixed(1)}
                                    </div>
                                </td>
                            ))}
                            <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-slate-300">
                                <div className="inline-flex min-w-[5rem] justify-end rounded border border-border/35 bg-surface/30 px-2 py-1">
                                    {totalCapacity.toFixed(1)}
                                </div>
                            </td>
                            {gridMode === "view" && (
                                <td className="px-3 py-2 text-right font-semibold border-r border-border/30 text-slate-300">-</td>
                            )}
                        </tr>
                    </tfoot>
                </table>
            </div>

        </section>
        {noteEditor && (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                    <div className="flex items-center justify-between border-b border-border/50 bg-[#151a2b] px-5 py-4">
                        <div>
                            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Capacity Note</div>
                            <div className="mt-2 text-lg font-semibold text-white">Planning Context</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                                <span className="inline-flex items-center rounded-full border border-border/50 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-200">
                                    {noteEditor.clientName}
                                </span>
                                <span>·</span>
                                <span>{noteEditor.consultantName}</span>
                            </div>
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

                    <div className="bg-[linear-gradient(180deg,#0f1424_0%,#0d121d_100%)] p-5">
                        <div className="rounded-2xl border border-border/50 bg-[#151a2b] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                            <div className="mb-3 flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Comment</div>
                                    <div className="mt-1 text-sm font-semibold text-white">Notes for this capacity cell</div>
                                </div>
                                <span className="rounded-full border border-border/50 bg-surface/40 px-2.5 py-1 text-[11px] text-text-muted">
                                    {format(new Date(), "MMM d, yyyy")}
                                </span>
                            </div>
                            <textarea
                                value={noteEditor.note}
                                onChange={(event) => setNoteEditor((prev) => prev ? { ...prev, note: event.target.value } : prev)}
                                rows={12}
                                placeholder="Add context, follow-ups, assumptions, or handoff notes for this cell..."
                                className="min-h-[320px] w-full resize-none rounded-xl border border-border/60 bg-[#0f1320] px-4 py-4 text-sm leading-7 text-white outline-none placeholder:text-text-muted focus:border-border/80 focus:bg-[#111729]"
                                autoFocus
                            />
                            <div className="mt-3 text-[11px] text-text-muted">
                                Use this space for planning assumptions, blockers, dependencies, or handoff context.
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-border/50 bg-surface/50 px-5 py-4">
                        <div className="text-xs text-text-muted">
                            Double-click any planned or actuals cell to open this note.
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setNoteEditor(null)}
                                className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={handleSaveAllocationNote}
                                className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-white/[0.05] px-3 py-2 text-sm text-white hover:bg-white/[0.08]"
                            >
                                <Save className="w-4 h-4" />
                                Save Note
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
        {removeClientConfirm && (
            <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4">
                <div className="w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-[#111318] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                    <div className="border-b border-border/50 bg-surface/80 px-5 py-4">
                        <div className="text-sm font-semibold text-text-main">Remove Client</div>
                        <div className="mt-1 text-xs text-text-muted">
                            This will remove <span className="font-medium text-white">{removeClientConfirm.clientName}</span> from this week&apos;s capacity grid.
                        </div>
                    </div>
                    <div className="px-5 py-4 text-sm text-text-muted">
                        Existing allocations in this row will be removed from the current weekly grid.
                    </div>
                    <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                        <button
                            type="button"
                            onClick={() => setRemoveClientConfirm(null)}
                            className="inline-flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirmRemoveClient}
                            className="inline-flex items-center gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20"
                        >
                            <Trash2 className="w-4 h-4" />
                            Remove Client
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
}
