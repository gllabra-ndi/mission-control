"use client";

import { useEffect, useMemo, useState, useTransition, Suspense, use } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import {
    BarChart2,
    BarChart3,
    Grid2x2,
    TrendingUp,
    Activity,
    Users,
    Settings,
    Folder,
    Building2,
    ChevronDown,
    ChevronRight,
    GripVertical,
    Pencil,
    Plus,
    Trash2,
    X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    createTaskSidebarBoard,
    createTaskSidebarFolder,
    removeTaskSidebarBoard,
    removeTaskSidebarFolder,
    saveTaskSidebarBoardLayout,
    updateTaskSidebarBoard,
    updateTaskSidebarFolder,
} from "@/app/actions";
import { MissionControlMark } from "@/components/BrandMarks";

export interface FolderWithLists {
    id: string;
    name: string;
    source?: "clickup" | "local";
    lists: { id: string; name: string; statusOrder?: string[]; source?: "clickup" | "local"; clientId?: string | null; clientName?: string | null }[];
}

interface SidebarClientOption {
    id: string;
    name: string;
}

interface SidebarProps {
    foldersPromise?: Promise<FolderWithLists[]>;
    initialTasksPromise?: Promise<any[]>;
    initialSidebarStructure?: any;
    initialFolders?: FolderWithLists[];
    clientOptions?: SidebarClientOption[];
    selectedListId?: string | null;
    selectedFolderId?: string | null;
    activeTab?: string;
    weekStr?: string;
    assigneeFilter?: string | null;
    onSelectList?: (id: string | null) => void;
    onSelectFolder?: (id: string | null) => void;
    onSelectTab?: (tab: string) => void;
    teamsLabel?: string;
}

const PROFESSIONAL_SERVICES_SPACE_ID = "90120150242";

function normalizeConsultantNameKey(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const navItems = [
    { icon: BarChart2, label: "Command Center", id: "command-center" },
    { icon: TrendingUp, label: "Actuals Trends", id: "trends" },
    { icon: Activity, label: "Capacity Trends", id: "capacity-trends" },
    { icon: Users, label: "Consultant Utilization", id: "consultant-utilization" },
    { icon: Users, label: "Timesheets", id: "timesheets" },
    { icon: Grid2x2, label: "Plan vs Actuals", id: "capacity-grid" },
    { icon: Building2, label: "Client Setup", id: "client-setup" },
];

const projectItems = [
    { icon: BarChart3, label: "Backlog Growth", id: "backlog-growth" },
];

function FoldersContent({
    foldersPromise,
    tasksPromise,
    sidebarStructure,
    clientOptions,
    visibleFolders,
    selectedFolderId,
    selectedListId,
    expandedFolders,
    draggingBoard,
    dropPreview,
    isMounted,
    onSelectTab,
    onSelectFolder,
    onSelectList,
    toggleFolder,
    setDropPreview,
    handleBoardDrop,
    setCreateBoardTarget,
    setEditFolderTarget,
    setDraggingBoard,
    setEditBoardTarget,
}: any) {
    const initialFoldersRaw = foldersPromise ? use(foldersPromise) : (visibleFolders || []);
    const initialTasks = tasksPromise ? use(tasksPromise) : [];

    const availableFolders = useMemo(() => {
        const initialFolders = foldersPromise ? initialFoldersRaw : (visibleFolders || []);
        if (!initialFolders.length) return [];
        
        const shouldExcludeList = (name: string) => /user\s*guide/i.test(name);
        const hiddenFolderIds = new Set((sidebarStructure?.hiddenFolderIds ?? []).map((id: any) => String(id)));
        const hiddenBoardIds = new Set((sidebarStructure?.hiddenBoardIds ?? []).map((id: any) => String(id)));
        const folderOverrideMap = new Map(
            (sidebarStructure?.folderOverrides ?? []).map((override: any) => [
                `${override.source}:${override.folderId}`,
                override,
            ])
        );
        const placementMap = new Map(
            (sidebarStructure?.placements ?? []).map((placement: any) => [
                `${placement.source}:${placement.boardId}`,
                placement,
            ])
        );
        
        const normalizedClientCandidates = (clientOptions || []).map((client: any) => ({
            ...client,
            normalizedId: normalizeConsultantNameKey(client.id),
            normalizedName: normalizeConsultantNameKey(client.name),
        }));

        const inferClientFromBoardName = (boardName: string) => {
            const normalizedBoardName = normalizeConsultantNameKey(boardName);
            if (!normalizedBoardName) return null;
            let bestMatch: { id: string; name: string; score: number } | null = null;
            for (const client of normalizedClientCandidates) {
                const idScore = client.normalizedId && normalizedBoardName.includes(client.normalizedId) ? client.normalizedId.length + 100 : 0;
                const nameScore = client.normalizedName && normalizedBoardName.includes(client.normalizedName) ? client.normalizedName.length : 0;
                const score = Math.max(idScore, nameScore);
                if (score <= 0) continue;
                if (!bestMatch || score > bestMatch.score) {
                    bestMatch = { id: client.id, name: client.name, score };
                }
            }
            return bestMatch ? { id: bestMatch.id, name: bestMatch.name } : null;
        };

        const folderCatalog = new Map<string, { id: string; name: string; source: "clickup" | "local" }>();
        initialFolders.forEach((folder: any) => {
            if (hiddenFolderIds.has(String(folder.id))) return;
            const override = folderOverrideMap.get(`clickup:${String(folder.id)}`) as any;
            folderCatalog.set(String(folder.id), {
                id: String(folder.id),
                name: String(override?.name ?? folder.name),
                source: "clickup",
            });
        });

        const boardBuckets = new Map<string, any[]>();
        const pushBoard = (board: any) => {
            const placement = placementMap.get(`${board.source}:${board.id}`) as any;
            const resolvedBoardName = String(placement?.boardName ?? board.name);
            const linkedClient = placement?.clientId && placement?.clientName
                ? { id: String(placement.clientId), name: String(placement.clientName) }
                : inferClientFromBoardName(resolvedBoardName);
            const targetFolderId = String(placement?.parentFolderId ?? board.defaultFolderId);
            if (!targetFolderId) return;
            const bucket = boardBuckets.get(targetFolderId) ?? [];
            bucket.push({
                ...board,
                name: resolvedBoardName,
                clientId: linkedClient?.id ?? null,
                clientName: linkedClient?.name ?? null,
                sortOrder: Number(placement?.orderIndex ?? board.defaultOrder),
            });
            boardBuckets.set(targetFolderId, bucket);
        };

        initialFolders.forEach((folder: any) => {
            if (hiddenFolderIds.has(String(folder.id))) return;
            (folder.lists || [])
                .filter((list: any) => !shouldExcludeList(list.name) && !hiddenBoardIds.has(String(list.id)))
                .forEach((list: any, index: number) => {
                    pushBoard({
                        id: String(list.id),
                        name: String(list.name),
                        source: "clickup",
                        defaultFolderId: String(folder.id),
                        defaultOrder: index,
                        statusOrder: list.statusOrder,
                    });
                });
        });

        const buildFolder = (folderId: string): FolderWithLists | null => {
            const folder = folderCatalog.get(folderId);
            if (!folder) return null;
            const lists = (boardBuckets.get(folderId) ?? [])
                .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name));
            if (lists.length === 0) return null;
            return { id: folder.id, name: folder.name, source: folder.source, lists };
        };

        return initialFolders.map((f: any) => buildFolder(String(f.id))).filter(Boolean) as FolderWithLists[];
    }, [clientOptions, initialFoldersRaw, sidebarStructure, foldersPromise, visibleFolders]);

    if (availableFolders.length === 0) return null;

    return (
        <>
            {availableFolders.map((folder: any) => {
                const isExpanded = expandedFolders[folder.id] === true;

                return (
                    <div key={folder.id} className="space-y-1">
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                                onSelectTab("issues");
                                onSelectFolder(folder.id);
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    onSelectTab("issues");
                                    onSelectFolder(folder.id);
                                }
                            }}
                            className={cn(
                                "w-full px-3 py-1.5 flex items-center gap-2 rounded-md border transition-colors text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                                selectedFolderId === folder.id
                                    ? "border-primary/35 bg-primary/10 text-text-main shadow-sm"
                                    : "border-transparent text-text-muted/80 hover:bg-surface-hover/30 hover:text-text-main",
                                dropPreview?.folderId === folder.id && !dropPreview?.boardId && "border-primary/45 bg-primary/10"
                            )}
                            onDragOver={(event) => {
                                if (!draggingBoard) return;
                                event.preventDefault();
                                setDropPreview({ folderId: folder.id, boardId: null, position: "inside" });
                            }}
                            onDrop={(event) => {
                                if (!draggingBoard) return;
                                event.preventDefault();
                                handleBoardDrop(folder.id);
                            }}
                        >
                            <div
                                className="p-0.5 -ml-1 rounded hover:bg-surface-hover/80 transition-colors"
                                onClick={(e) => {
                                    e.preventDefault();
                                    toggleFolder(folder.id, e);
                                }}
                            >
                                {isMounted ? (
                                    isExpanded ? (
                                        <ChevronDown className="w-3.5 h-3.5 text-text-muted group-hover:text-text-main" />
                                    ) : (
                                        <ChevronRight className="w-3.5 h-3.5 text-text-muted group-hover:text-text-main" />
                                    )
                                ) : (
                                    <span className="w-3.5 h-3.5 block" aria-hidden />
                                )}
                            </div>
                            {isMounted ? (
                                <Folder className={cn(
                                    "w-3.5 h-3.5",
                                    selectedFolderId === folder.id ? "text-primary flex-shrink-0" : "text-text-muted/80 group-hover:text-text-main flex-shrink-0"
                                )} />
                            ) : (
                                <span className="w-3.5 h-3.5 shrink-0" aria-hidden />
                            )}
                            <span className="text-[11px] font-bold uppercase tracking-wider truncate flex-1">{folder.name}</span>
                            <div className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setCreateBoardTarget({ folderId: folder.id, folderName: folder.name });
                                    }}
                                    className="inline-flex items-center justify-center rounded border border-transparent p-1 text-text-muted hover:border-border/60 hover:bg-surface-hover hover:text-white"
                                    aria-label={`Add board to ${folder.name}`}
                                >
                                    <Plus className="w-3 h-3" />
                                </button>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setEditFolderTarget({
                                            id: folder.id,
                                            name: folder.name,
                                            source: folder.source === "local" ? "local" : "clickup",
                                        });
                                    }}
                                    className="inline-flex items-center justify-center rounded border border-transparent p-1 text-text-muted hover:border-border/60 hover:bg-surface-hover hover:text-white"
                                    aria-label={`Rename ${folder.name}`}
                                >
                                    <Pencil className="w-3 h-3" />
                                </button>
                            </div>
                        </div>

                        {isExpanded && folder.lists.map((list: any) => {
                            const isActive = selectedListId === list.id;
                            const isDropTarget = dropPreview?.folderId === folder.id && dropPreview?.boardId === list.id;
                            return (
                                <button
                                    key={list.id}
                                    type="button"
                                    draggable
                                    onClick={() => {
                                        onSelectTab("issues");
                                        onSelectList(list.id);
                                    }}
                                    onDragStart={(event) => {
                                        event.dataTransfer.effectAllowed = "move";
                                        event.dataTransfer.setData("text/plain", list.id);
                                        setDraggingBoard({
                                            id: list.id,
                                            name: list.name,
                                            source: list.source === "local" ? "local" : "clickup",
                                            parentFolderId: folder.id,
                                            clientId: list.clientId ?? null,
                                            clientName: list.clientName ?? null,
                                        });
                                    }}
                                    onDragEnd={() => {
                                        setDraggingBoard(null);
                                        setDropPreview(null);
                                    }}
                                    onDragOver={(event) => {
                                        if (!draggingBoard) return;
                                        event.preventDefault();
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        const position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
                                        setDropPreview({ folderId: folder.id, boardId: list.id, position });
                                    }}
                                    onDrop={(event) => {
                                        if (!draggingBoard) return;
                                        event.preventDefault();
                                        const rect = event.currentTarget.getBoundingClientRect();
                                        const position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
                                        handleBoardDrop(folder.id, list.id, position);
                                    }}
                                    className={cn(
                                        "w-full flex items-center gap-3 px-3 py-1.5 pl-8 rounded-md border transition-all duration-200 text-[13px] font-medium group text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                                        isActive
                                            ? "border-primary/45 bg-primary/12 text-text-main shadow-sm relative"
                                            : "border-transparent text-text-muted hover:text-text-main hover:bg-surface-hover/20",
                                        isDropTarget && "border-primary/45 bg-primary/10",
                                        draggingBoard?.id === list.id && "opacity-60 cursor-grabbing",
                                        !draggingBoard?.id || draggingBoard.id !== list.id ? "cursor-grab" : ""
                                    )}
                                    title={list.name}
                                >
                                    {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-r-full" />}
                                    <GripVertical className="h-3.5 w-3.5 shrink-0 text-text-muted/70" />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate">{list.name}</div>
                                        {list.clientName && (
                                            <div className="truncate text-[10px] uppercase tracking-wider text-text-muted/70">
                                                {list.clientName}
                                            </div>
                                        )}
                                    </div>
                                    <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setEditBoardTarget({
                                                id: list.id,
                                                name: list.name,
                                                source: list.source === "local" ? "local" : "clickup",
                                                parentFolderId: folder.id,
                                                clientId: list.clientId ?? null,
                                                clientName: list.clientName ?? null,
                                            });
                                        }}
                                        onKeyDown={(event) => {
                                            if (event.key !== "Enter" && event.key !== " ") return;
                                            event.preventDefault();
                                            event.stopPropagation();
                                            setEditBoardTarget({
                                                id: list.id,
                                                name: list.name,
                                                source: list.source === "local" ? "local" : "clickup",
                                                parentFolderId: folder.id,
                                                clientId: list.clientId ?? null,
                                                clientName: list.clientName ?? null,
                                            });
                                        }}
                                        className="inline-flex shrink-0 items-center justify-center rounded border border-transparent p-1 text-text-muted opacity-0 transition-opacity hover:border-border/60 hover:bg-surface-hover hover:text-white group-hover:opacity-100"
                                    >
                                        <Pencil className="h-3 w-3" />
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                );
            })}
        </>
    );
}

export function Sidebar({
    foldersPromise,
    initialTasksPromise,
    initialSidebarStructure,
    initialFolders: foldersIn = [],
    clientOptions = [],
    selectedListId = null,
    selectedFolderId = null,
    activeTab = "issues",
    weekStr = "",
    assigneeFilter = null,
    onSelectList = () => { },
    onSelectFolder = () => { },
    onSelectTab = () => { },
    teamsLabel = "Teams",
}: SidebarProps) {
    const expandedFoldersStorageKey = "mission-control:expanded-folders";
    const [visibleFolders, setVisibleFolders] = useState<FolderWithLists[]>(foldersIn);
    const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
    const [isMounted, setIsMounted] = useState(false);
    const [isMutating, startTransition] = useTransition();
    const [createFolderOpen, setCreateFolderOpen] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [createBoardTarget, setCreateBoardTarget] = useState<{ folderId: string; folderName: string } | null>(null);
    const [newBoardName, setNewBoardName] = useState("");
    const [newBoardClientId, setNewBoardClientId] = useState("");
    const [editFolderTarget, setEditFolderTarget] = useState<{ id: string; name: string; source: "clickup" | "local" } | null>(null);
    const [editFolderName, setEditFolderName] = useState("");
    const [editBoardTarget, setEditBoardTarget] = useState<{ id: string; name: string; source: "clickup" | "local"; parentFolderId: string; clientId?: string | null; clientName?: string | null } | null>(null);
    const [editBoardName, setEditBoardName] = useState("");
    const [editBoardClientId, setEditBoardClientId] = useState("");
    const [deleteTarget, setDeleteTarget] = useState<{ type: "folder" | "board"; id: string; name: string; parentFolderId?: string | null } | null>(null);
    const [draggingBoard, setDraggingBoard] = useState<{ id: string; name: string; source: "clickup" | "local"; parentFolderId: string; clientId?: string | null; clientName?: string | null } | null>(null);
    const [dropPreview, setDropPreview] = useState<{ folderId: string; boardId?: string | null; position: "inside" | "before" | "after" } | null>(null);
    const router = useRouter();

    useEffect(() => {
        setIsMounted(true);
        if (typeof window === "undefined") return;
        try {
            const saved = window.sessionStorage.getItem(expandedFoldersStorageKey);
            if (saved) {
                setExpandedFolders(JSON.parse(saved));
            }
        } catch {
            // Ignore storage parse issues and fall back to closed-by-default behavior.
        }
    }, []);

    useEffect(() => {
        if (foldersIn.length > 0) {
            setVisibleFolders(foldersIn);
        }
    }, [foldersIn]);

    useEffect(() => {
        if (!isMounted || typeof window === "undefined") return;
        window.sessionStorage.setItem(expandedFoldersStorageKey, JSON.stringify(expandedFolders));
    }, [expandedFolders, expandedFoldersStorageKey, isMounted]);

    const clientById = useMemo(() => {
        const map = new Map<string, SidebarClientOption>();
        clientOptions.forEach((client) => {
            const id = String(client.id ?? "").trim();
            const name = String(client.name ?? "").trim();
            if (!id || !name) return;
            map.set(id, { id, name });
        });
        return map;
    }, [clientOptions]);

    const toggleFolder = (folderId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setExpandedFolders(prev => ({
            ...prev,
            [folderId]: prev[folderId] === undefined ? true : !prev[folderId]
        }));
    };

    const buildHref = (tab: string, listId?: string | null, folderId?: string | null) => {
        const params = new URLSearchParams();
        if (weekStr) params.set("week", weekStr);
        params.set("tab", tab);
        if (assigneeFilter) params.set("assignee", assigneeFilter);
        if (listId) {
            params.set("listId", listId);
        } else if (folderId) {
            params.set("folderId", folderId);
        }
        const qs = params.toString();
        return qs ? `/?${qs}` : "/";
    };

    const handleCreateFolder = () => {
        const trimmed = newFolderName.trim();
        if (!trimmed) return;
        startTransition(async () => {
            const created = await createTaskSidebarFolder(trimmed);
            setCreateFolderOpen(false);
            setNewFolderName("");
            router.refresh();
            if (created) {
                window.location.href = buildHref("issues", null, created.id);
            }
        });
    };

    const handleCreateBoard = () => {
        if (!createBoardTarget) return;
        const trimmed = newBoardName.trim();
        const selectedClient = newBoardClientId ? clientById.get(newBoardClientId) ?? null : null;
        if (!trimmed || !selectedClient) return;
        startTransition(async () => {
            const created = await createTaskSidebarBoard({
                parentFolderId: createBoardTarget.folderId,
                name: trimmed,
                clientId: selectedClient.id,
                clientName: selectedClient.name,
            });
            setCreateBoardTarget(null);
            setNewBoardName("");
            setNewBoardClientId("");
            router.refresh();
            if (created) {
                window.location.href = buildHref("issues", created.id, null);
            }
        });
    };

    const handleBoardDrop = (
        targetFolderId: string,
        targetBoardId: string | null = null,
        position: "inside" | "before" | "after" = "inside"
    ) => {
        if (!draggingBoard) return;
        // Simplified drop logic for the shell
        console.log("Dropped board", draggingBoard.id, "into folder", targetFolderId);
    };

    const modalRoot = isMounted && typeof document !== "undefined" ? document.body : null;

    return (
        <aside className="w-64 border-r border-border bg-background flex flex-col h-full shrink-0 relative z-10">
            {/* Top Header Placeholder */}
            <div className="h-[68px] flex items-center px-4 pt-2 border-b border-border shadow-sm">
                <button
                    type="button"
                    onClick={() => onSelectTab("command-center")}
                    className="flex items-center gap-3 w-full cursor-pointer hover:bg-surface-hover p-1.5 rounded-xl transition-colors"
                >
                    <MissionControlMark className="h-9 w-9 rounded-xl" />
                    <div className="min-w-0 text-left">
                        <div className="font-semibold text-text-main text-[15px] leading-tight truncate">Mission Control</div>
                        <div className="text-[10px] uppercase tracking-[0.26em] text-text-muted/90">Professional Services</div>
                    </div>
                </button>
            </div>

            <nav className="flex-1 py-4 px-3 space-y-6 overflow-y-auto custom-scrollbar">

                {/* Main Nav */}
                <div className="space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActiveTab = activeTab === item.id;

                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => onSelectTab(item.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-1.5 rounded-md border transition-all duration-200 text-[13px] font-medium group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                                    isActiveTab
                                        ? "border-primary/40 bg-primary/10 text-text-main shadow-sm"
                                        : "border-transparent text-text-muted hover:text-text-main hover:bg-surface-hover/30"
                                )}
                            >
                                {isMounted ? (
                                    <Icon className={cn(
                                        "w-4 h-4 transition-colors shrink-0",
                                        isActiveTab ? "text-primary" : "text-text-muted group-hover:text-text-main"
                                    )} />
                                ) : (
                                    <span className="w-4 h-4 shrink-0" aria-hidden />
                                )}
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                <div className="space-y-2">
                    <div className="px-3">
                        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Projects</span>
                    </div>
                    {projectItems.map((item) => {
                        const Icon = item.icon;
                        const isActiveTab = activeTab === item.id;

                        return (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => onSelectTab(item.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-1.5 rounded-md border transition-all duration-200 text-[13px] font-medium group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
                                    isActiveTab
                                        ? "border-primary/40 bg-primary/10 text-text-main shadow-sm"
                                        : "border-transparent text-text-muted hover:text-text-main hover:bg-surface-hover/30"
                                )}
                            >
                                {isMounted ? (
                                    <Icon className={cn(
                                        "w-4 h-4 transition-colors shrink-0",
                                        isActiveTab ? "text-primary" : "text-text-muted group-hover:text-text-main"
                                    )} />
                                ) : (
                                    <span className="w-4 h-4 shrink-0" aria-hidden />
                                )}
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                {/* Folders List */}
                <div className="space-y-4 pb-4">
                    <div className="px-3 flex items-center justify-between">
                        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{teamsLabel}</span>
                        <button
                            type="button"
                            onClick={() => setCreateFolderOpen(true)}
                            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-text-main hover:bg-surface-hover"
                        >
                            <Plus className="w-3 h-3" />
                            New Folder
                        </button>
                    </div>

                    <Suspense fallback={
                        <div className="px-3 py-4 flex flex-col gap-3">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="flex items-center gap-2 animate-pulse">
                                    <div className="h-3 w-3 bg-slate-800 rounded-full" />
                                    <div className="h-3 w-24 bg-slate-800 rounded" />
                                </div>
                            ))}
                        </div>
                    }>
                        <FoldersContent
                            foldersPromise={foldersPromise}
                            tasksPromise={initialTasksPromise}
                            sidebarStructure={initialSidebarStructure}
                            clientOptions={clientOptions}
                            visibleFolders={visibleFolders}
                            selectedFolderId={selectedFolderId}
                            selectedListId={selectedListId}
                            expandedFolders={expandedFolders}
                            draggingBoard={draggingBoard}
                            dropPreview={dropPreview}
                            isMounted={isMounted}
                            onSelectTab={onSelectTab}
                            onSelectFolder={onSelectFolder}
                            onSelectList={onSelectList}
                            toggleFolder={toggleFolder}
                            setDropPreview={setDropPreview}
                            handleBoardDrop={handleBoardDrop}
                            setCreateBoardTarget={setCreateBoardTarget}
                            setEditFolderTarget={setEditFolderTarget}
                            setDraggingBoard={setDraggingBoard}
                            setEditBoardTarget={setEditBoardTarget}
                        />
                    </Suspense>
                </div>
            </nav>

            <div className="p-3 border-t border-border">
                <a
                    href="/settings"
                    className="flex items-center gap-3 px-3 py-2 rounded-md transition-all text-[13px] font-medium text-text-muted hover:text-text-main hover:bg-surface-hover"
                >
                    {isMounted ? (
                        <Settings className="w-4 h-4 shrink-0" />
                    ) : (
                        <span className="w-4 h-4 shrink-0" aria-hidden />
                    )}
                    Settings
                </a>
            </div>
        </aside>
    );
}
