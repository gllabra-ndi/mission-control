"use client";

import { useState, useMemo, useEffect, useCallback, useRef, use, Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Sidebar, FolderWithLists } from "@/components/Sidebar";
import { EditableTaskBoard } from "@/components/EditableTaskBoard";
import { CommandCenter } from "@/components/CommandCenter";
import { ProjectsBacklogGrowth } from "@/components/ProjectsBacklogGrowth";
import { CapacityGrid } from "@/components/CapacityGrid";
import { ConsultantUtilization } from "@/components/ConsultantUtilization";
import { Timesheets } from "@/components/Timesheets";
import { ClientSetup } from "@/components/ClientSetup";
import { Trends } from "@/components/Trends";
import { CapacityTrends } from "@/components/CapacityTrends";
import { CapacityGridPayload, ClientDirectoryRecord, EditableTaskBillableRollupRecord, EditableTaskPlannedRollupRecord, TaskSidebarStructureRecord, loadDashboardWeekData } from "@/app/actions";
import { ClickUpTask, TimeEntry, PROFESSIONAL_SERVICES_SPACE_ID } from "@/lib/clickup";
import { Rocket } from "lucide-react";
import { MissionEngineMark } from "@/components/BrandMarks";
import { addDays, addWeeks, endOfYear, format, startOfWeek } from "date-fns";

interface DashboardClientProps {
    initialTasksPromise: Promise<ClickUpTask[]>;
    initialFoldersPromise: Promise<FolderWithLists[]>;
    initialTimeEntriesPromise: Promise<TimeEntry[]>;
    weekStartStr: string;
    dbConfig: any;
    initialTab?: string;
    initialSelectedListId?: string | null;
    initialSelectedFolderId?: string | null;
    initialAssigneeFilter?: string | null;
    initialTaskPlannedRollups?: EditableTaskPlannedRollupRecord[];
    initialTaskBillableRollups?: EditableTaskBillableRollupRecord[];
    initialSidebarStructure?: TaskSidebarStructureRecord;
}

type ConsultantDirectoryEntry = {
    id: number;
    name: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    source?: string;
};

type ClientOption = {
    id: string;
    name: string;
};

type DashboardExtraParams = Record<string, string | null | undefined>;

const EMPTY_CAPACITY_GRID: CapacityGridPayload = { resources: [], rows: [] };
const VALID_TABS = new Set(["issues", "editable-tasks", "command-center", "trends", "capacity-trends", "consultant-utilization", "timesheets", "capacity-grid", "client-setup", "backlog-growth"]);
const normalizeTab = (tab?: string) => (tab && VALID_TABS.has(tab) ? tab : "command-center");
type DashboardWeekSnapshot = Awaited<ReturnType<typeof loadDashboardWeekData>>;

function pickPreferredConsultantName(currentName: string, incomingName: string) {
    const current = String(currentName || "").trim();
    const incoming = String(incomingName || "").trim();
    if (!current) return incoming;
    if (!incoming) return current;
    const currentTokens = current.split(/\s+/).filter(Boolean).length;
    const incomingTokens = incoming.split(/\s+/).filter(Boolean).length;
    if (incomingTokens > currentTokens) return incoming;
    if (incomingTokens === currentTokens && incoming.length > current.length) return incoming;
    return current;
}

function normalizeConsultantNameKey(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const CANONICAL_2026_WEEK_DATA: Record<string, { totalHours: number; vsTarget: number; vsStretch: number }> = {
    W02: { totalHours: 235.3, vsTarget: -114.8, vsStretch: -164.8 },
    W03: { totalHours: 230.0, vsTarget: -120.0, vsStretch: -170.0 },
    W04: { totalHours: 266.5, vsTarget: -83.5, vsStretch: -133.5 },
    W05: { totalHours: 321.1, vsTarget: -28.9, vsStretch: -78.9 },
    W06: { totalHours: 282.0, vsTarget: -68.0, vsStretch: -118.0 },
    W07: { totalHours: 321.0, vsTarget: -29.0, vsStretch: -79.0 },
    W08: { totalHours: 298.3, vsTarget: -51.8, vsStretch: -101.8 },
    W09: { totalHours: 314.8, vsTarget: -35.3, vsStretch: -85.3 },
    W10: { totalHours: 380.5, vsTarget: 30.5, vsStretch: -19.5 },
    W11: { totalHours: 0.0, vsTarget: -350.0, vsStretch: -400.0 },
    W12: { totalHours: 0.0, vsTarget: -350.0, vsStretch: -400.0 },
    W13: { totalHours: 0.0, vsTarget: -350.0, vsStretch: -400.0 },
    W14: { totalHours: 0.0, vsTarget: -350.0, vsStretch: -400.0 },
};

function SidebarSkeleton() {
    return (
        <aside className="w-64 border-r border-border bg-background flex flex-col h-full shrink-0 relative z-10 animate-pulse">
            <div className="h-[68px] border-b border-border px-4 flex items-center">
                <div className="h-9 w-9 bg-slate-800 rounded-xl"></div>
                <div className="ml-3 space-y-2">
                    <div className="h-4 w-24 bg-slate-800 rounded"></div>
                    <div className="h-2 w-16 bg-slate-800 rounded"></div>
                </div>
            </div>
            <div className="flex-1 p-4 space-y-6">
                <div className="space-y-2">
                    <div className="h-8 w-full bg-slate-800 rounded"></div>
                    <div className="h-8 w-full bg-slate-800 rounded"></div>
                    <div className="h-8 w-full bg-slate-800 rounded"></div>
                </div>
            </div>
        </aside>
    );
}

function ContentSkeleton() {
    return (
        <div className="flex-1 p-6 space-y-8 animate-pulse">
            <div className="h-8 w-48 bg-slate-800 rounded mb-8"></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="h-32 bg-slate-800 rounded-xl"></div>
                <div className="h-32 bg-slate-800 rounded-xl"></div>
                <div className="h-32 bg-slate-800 rounded-xl"></div>
            </div>
            <div className="h-96 bg-slate-800 rounded-xl"></div>
        </div>
    );
}

export function DashboardClient(props: DashboardClientProps) {
    const {
        initialTasksPromise,
        initialFoldersPromise,
        initialTimeEntriesPromise,
        weekStartStr,
        dbConfig,
        initialTab,
        initialSelectedListId = null,
        initialSelectedFolderId = null,
        initialAssigneeFilter = null,
        initialTaskPlannedRollups = [],
        initialTaskBillableRollups = [],
        initialSidebarStructure = { folders: [], boards: [], placements: [], folderOverrides: [], hiddenFolderIds: [], hiddenBoardIds: [] },
    } = props;

    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [activeWeekStrState, setActiveWeekStrState] = useState(weekStartStr);
    const [activeTabState, setActiveTabState] = useState(normalizeTab(initialTab));
    const [selectedListIdState, setSelectedListIdState] = useState<string | null>(initialSelectedListId);
    const [selectedFolderIdState, setSelectedFolderIdState] = useState<string | null>(initialSelectedFolderId);
    const [selectedAssigneeFilterState, setSelectedAssigneeFilterState] = useState<string | null>(initialAssigneeFilter);
    const [dashboardConfigState, setDashboardConfigState] = useState(dbConfig);
    const [taskPlannedRollupsState, setTaskPlannedRollupsState] = useState<EditableTaskPlannedRollupRecord[]>(initialTaskPlannedRollups);
    const [taskBillableRollupsState, setTaskBillableRollupsState] = useState<EditableTaskBillableRollupRecord[]>(initialTaskBillableRollups);
    const [capacityGridState, setCapacityGridState] = useState<CapacityGridPayload>(dbConfig?.capacityGridConfig ?? EMPTY_CAPACITY_GRID);

    const resolvedActiveTab = normalizeTab(activeTabState);

    const clientOptions = useMemo<ClientOption[]>(() => {
        const rows = Array.isArray(dashboardConfigState?.clientDirectory) ? dashboardConfigState.clientDirectory : [];
        const byId = new Map<string, ClientOption>();
        rows.forEach((row: any) => {
            if (row?.isActive === false) return;
            const id = String(row?.id ?? "").trim();
            const name = String(row?.name ?? row?.id ?? "").trim();
            if (!id || !name) return;
            byId.set(id, { id, name });
        });
        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [dashboardConfigState?.clientDirectory]);

    const activeConsultantNames = useMemo(() => {
        return (dashboardConfigState?.activeConsultants ?? []).map((c: any) => c.fullName);
    }, [dashboardConfigState?.activeConsultants]);

    const consultantsForRoster = useMemo(() => {
        return (dashboardConfigState?.consultants ?? []).map((c: any) => ({ id: c.id, name: c.fullName }));
    }, [dashboardConfigState?.consultants]);

    const consultantsFromDirectory = useMemo(() => {
        return (dashboardConfigState?.consultants ?? []).map((c: any) => ({
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            email: c.email,
            fullName: c.fullName,
            source: c.source,
        }));
    }, [dashboardConfigState?.consultants]);

    const consultantConfigsStateById = useMemo(() => {
        const byId: Record<number, { maxCapacity: number; billableCapacity: number; notes: string }> = {};
        const rows = Array.isArray(dashboardConfigState?.consultantConfigs) ? dashboardConfigState.consultantConfigs : [];
        rows.forEach((cfg: any) => {
            const consultantId = Number(cfg?.consultantId ?? 0);
            if (consultantId <= 0) return;
            byId[consultantId] = {
                maxCapacity: Number(cfg?.maxCapacity ?? 40),
                billableCapacity: Number(cfg?.billableCapacity ?? 40),
                notes: String(cfg?.notes ?? ""),
            };
        });
        return byId;
    }, [dashboardConfigState?.consultantConfigs]);

    const [consultantConfigsState, setConsultantConfigsState] = useState<Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>>(consultantConfigsStateById);

    useEffect(() => {
        setConsultantConfigsState(consultantConfigsStateById);
    }, [consultantConfigsStateById]);

    const buildDashboardHref = useCallback((
        nextWeek: string,
        nextTab: string,
        nextListId: string | null,
        nextFolderId: string | null,
        nextAssignee: string | null = selectedAssigneeFilterState,
        extraParams: DashboardExtraParams = {}
    ) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("week", nextWeek);
        params.set("tab", normalizeTab(nextTab));
        if (nextAssignee) {
            params.set("assignee", nextAssignee);
        } else {
            params.delete("assignee");
        }
        if (nextListId) {
            params.set("listId", nextListId);
            params.delete("folderId");
        } else if (nextFolderId) {
            params.set("folderId", nextFolderId);
            params.delete("listId");
        } else {
            params.delete("listId");
            params.delete("folderId");
        }
        params.delete("returnTo");
        Object.entries(extraParams).forEach(([key, value]) => {
            const nextValue = String(value ?? "").trim();
            if (nextValue.length > 0) {
                params.set(key, nextValue);
            } else {
                params.delete(key);
            }
        });
        return `${pathname}?${params.toString()}`;
    }, [pathname, searchParams, selectedAssigneeFilterState]);

    const syncBrowserUrl = useCallback((href: string) => {
        if (typeof window === "undefined") return;
        window.history.pushState({}, "", href);
    }, []);

    const navigateWithState = useCallback((
        nextTab: string,
        nextListId: string | null,
        nextFolderId: string | null,
        nextAssignee: string | null = selectedAssigneeFilterState,
        extraParams: DashboardExtraParams = {}
    ) => {
        const normalizedTab = normalizeTab(nextTab);
        setActiveTabState(normalizedTab);
        setSelectedListIdState(nextListId);
        setSelectedFolderIdState(nextFolderId);
        setSelectedAssigneeFilterState(nextAssignee);
        syncBrowserUrl(buildDashboardHref(activeWeekStrState, normalizedTab, nextListId, nextFolderId, nextAssignee, extraParams));
    }, [activeWeekStrState, buildDashboardHref, selectedAssigneeFilterState, syncBrowserUrl]);

    const handleListSelect = (listId: string | null) => {
        navigateWithState("issues", listId, null);
    };

    const handleFolderSelect = (folderId: string | null) => {
        navigateWithState("issues", null, folderId);
    };

    const handleTabSelect = (tab: string) => {
        navigateWithState(VALID_TABS.has(tab) ? tab : "command-center", selectedListIdState, selectedFolderIdState);
    };

    const handleAssigneeFilterChange = useCallback((nextAssignee: string | null) => {
        navigateWithState("issues", selectedListIdState, selectedFolderIdState, nextAssignee);
    }, [navigateWithState, selectedFolderIdState, selectedListIdState]);

    const handleTimesheetAssigneeFilterChange = useCallback((nextAssignee: string | null) => {
        navigateWithState("timesheets", selectedListIdState, selectedFolderIdState, nextAssignee);
    }, [navigateWithState, selectedFolderIdState, selectedListIdState]);

    const handleWeekChange = useCallback((nextWeek: string) => {
        const nextHref = buildDashboardHref(nextWeek, resolvedActiveTab, selectedListIdState, selectedFolderIdState, selectedAssigneeFilterState);
        router.push(nextHref);
    }, [buildDashboardHref, resolvedActiveTab, router, selectedAssigneeFilterState, selectedFolderIdState, selectedListIdState]);

    return (
        <div className="flex h-screen w-full bg-background overflow-hidden text-sm selection:bg-primary/30 selection:text-white">
            <Suspense fallback={<SidebarSkeleton />}>
                <SidebarStream
                    initialFoldersPromise={initialFoldersPromise}
                    initialTasksPromise={initialTasksPromise}
                    initialSidebarStructure={initialSidebarStructure}
                    clientOptions={clientOptions}
                    selectedListId={selectedListIdState}
                    selectedFolderId={selectedFolderIdState}
                    activeTab={resolvedActiveTab}
                    weekStr={activeWeekStrState}
                    assigneeFilter={selectedAssigneeFilterState}
                    onSelectList={handleListSelect}
                    onSelectFolder={handleFolderSelect}
                    onSelectTab={handleTabSelect}
                />
            </Suspense>

            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <header className="h-[68px] border-b border-border flex items-center justify-between px-6 pt-2 shrink-0 bg-background/90 backdrop-blur-md z-20">
                    <div className="flex items-center gap-3">
                        <MissionEngineMark className="h-9 w-9 rounded-xl" />
                        <div className="min-w-0">
                            <h1 className="font-semibold text-white leading-tight">Mission Engine</h1>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-text-muted/85">Live Operations</div>
                        </div>
                        <span className="text-text-muted text-xs bg-surface-hover px-2 py-0.5 rounded-full border border-border">
                            Prod
                        </span>
                    </div>

                    <div className="flex items-center gap-5">
                        <div className="lucid-interactive flex items-center gap-2 cursor-pointer border border-border/50">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-xs">System Online</span>
                        </div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 custom-scrollbar flex flex-col relative">
                    <Suspense fallback={<ContentSkeleton />}>
                        <ContentStream
                            activeTab={resolvedActiveTab}
                            initialTasksPromise={initialTasksPromise}
                            initialTimeEntriesPromise={initialTimeEntriesPromise}
                            activeWeekStrState={activeWeekStrState}
                            dbConfig={dashboardConfigState}
                            handleWeekChange={handleWeekChange}
                            activeConsultantNames={activeConsultantNames}
                            selectedAssigneeFilterState={selectedAssigneeFilterState}
                            handleAssigneeFilterChange={handleAssigneeFilterChange}
                            consultantsFromDirectory={consultantsFromDirectory}
                            consultantsForRoster={consultantsForRoster}
                            consultantConfigsState={consultantConfigsState}
                            capacityGridState={capacityGridState}
                            taskPlannedRollupsState={taskPlannedRollupsState}
                            taskBillableRollupsState={taskBillableRollupsState}
                            initialSidebarStructure={initialSidebarStructure}
                            clientOptions={clientOptions}
                            handleTimesheetAssigneeFilterChange={handleTimesheetAssigneeFilterChange}
                        />
                    </Suspense>
                </div>
            </main>
        </div>
    );
}

function SidebarStream({
    initialFoldersPromise,
    initialTasksPromise,
    initialSidebarStructure,
    clientOptions,
    selectedListId,
    selectedFolderId,
    activeTab,
    weekStr,
    assigneeFilter,
    onSelectList,
    onSelectFolder,
    onSelectTab,
}: {
    initialFoldersPromise: Promise<FolderWithLists[]>;
    initialTasksPromise: Promise<ClickUpTask[]>;
    initialSidebarStructure: TaskSidebarStructureRecord;
    clientOptions: ClientOption[];
    selectedListId: string | null;
    selectedFolderId: string | null;
    activeTab: string;
    weekStr: string;
    assigneeFilter: string | null;
    onSelectList: (id: string | null) => void;
    onSelectFolder: (id: string | null) => void;
    onSelectTab: (tab: string) => void;
}) {
    const initialFolders = use(initialFoldersPromise);
    const initialTasks = use(initialTasksPromise);

    const proServicesTasks = useMemo(() => {
        return initialTasks.filter(t => t.space?.id === PROFESSIONAL_SERVICES_SPACE_ID);
    }, [initialTasks]);

    const availableFolders = useMemo(() => {
        const shouldExcludeList = (name: string) => /user\s*guide/i.test(name);
        const hiddenFolderIds = new Set((initialSidebarStructure?.hiddenFolderIds ?? []).map((id) => String(id)));
        const hiddenBoardIds = new Set((initialSidebarStructure?.hiddenBoardIds ?? []).map((id) => String(id)));
        const folderOverrideMap = new Map(
            (initialSidebarStructure?.folderOverrides ?? []).map((override) => [
                `${override.source}:${override.folderId}`,
                override,
            ])
        );
        const placementMap = new Map(
            (initialSidebarStructure?.placements ?? []).map((placement) => [
                `${placement.source}:${placement.boardId}`,
                placement,
            ])
        );
        
        const normalizedClientCandidates = clientOptions.map((client) => ({
            ...client,
            normalizedId: normalizeConsultantNameKey(client.id),
            normalizedName: normalizeConsultantNameKey(client.name),
        }));

        const inferClientFromBoardName = (boardName: string): ClientOption | null => {
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
        initialFolders.forEach((folder) => {
            if (hiddenFolderIds.has(String(folder.id))) return;
            const override = folderOverrideMap.get(`clickup:${String(folder.id)}`);
            folderCatalog.set(String(folder.id), {
                id: String(folder.id),
                name: String(override?.name ?? folder.name),
                source: "clickup",
            });
        });

        const boardBuckets = new Map<string, any[]>();
        const pushBoard = (board: any) => {
            const placement = placementMap.get(`${board.source}:${board.id}`);
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

        initialFolders.forEach((folder) => {
            if (hiddenFolderIds.has(String(folder.id))) return;
            folder.lists
                .filter((list) => !shouldExcludeList(list.name) && !hiddenBoardIds.has(String(list.id)))
                .forEach((list, index) => {
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

        return initialFolders.map(f => buildFolder(String(f.id))).filter(Boolean) as FolderWithLists[];
    }, [clientOptions, initialFolders, initialSidebarStructure, proServicesTasks]);

    return (
        <Sidebar
            folders={availableFolders}
            clientOptions={clientOptions}
            selectedListId={selectedListId}
            selectedFolderId={selectedFolderId}
            activeTab={activeTab}
            weekStr={weekStr}
            assigneeFilter={assigneeFilter}
            onSelectList={onSelectList}
            onSelectFolder={onSelectFolder}
            onSelectTab={onSelectTab}
            teamsLabel="Teams"
        />
    );
}

function ContentStream({
    activeTab,
    initialTasksPromise,
    initialTimeEntriesPromise,
    activeWeekStrState,
    dbConfig,
    handleWeekChange,
    activeConsultantNames,
    selectedAssigneeFilterState,
    handleAssigneeFilterChange,
    consultantsFromDirectory,
    consultantsForRoster,
    consultantConfigsState,
    capacityGridState,
    taskPlannedRollupsState,
    taskBillableRollupsState,
    initialSidebarStructure,
    clientOptions,
    handleTimesheetAssigneeFilterChange,
}: {
    activeTab: string;
    initialTasksPromise: Promise<ClickUpTask[]>;
    initialTimeEntriesPromise: Promise<TimeEntry[]>;
    activeWeekStrState: string;
    dbConfig: any;
    handleWeekChange: (week: string) => void;
    activeConsultantNames: string[];
    selectedAssigneeFilterState: string | null;
    handleAssigneeFilterChange: (assignee: string | null) => void;
    consultantsFromDirectory: any[];
    consultantsForRoster: any[];
    consultantConfigsState: any;
    capacityGridState: any;
    taskPlannedRollupsState: any[];
    taskBillableRollupsState: any[];
    initialSidebarStructure: any;
    clientOptions: any[];
    handleTimesheetAssigneeFilterChange: (assignee: string | null) => void;
}) {
    const initialTasks = use(initialTasksPromise);
    const initialTimeEntries = use(initialTimeEntriesPromise);

    const proServicesTasks = useMemo(() => {
        return initialTasks.filter((t) => t.space?.id === PROFESSIONAL_SERVICES_SPACE_ID);
    }, [initialTasks]);

    const weeklyTrend = useMemo(() => {
        const activeYear = new Date(activeWeekStrState).getFullYear();
        const weekConfigByStart = new Map<string, { baseTarget: number, stretchTarget: number }>();
        const weekConfigsForYear = Array.isArray(dbConfig?.weekConfigsForYear) ? dbConfig.weekConfigsForYear : [];
        
        weekConfigsForYear.forEach((cfg: any) => {
            weekConfigByStart.set(cfg.week, {
                baseTarget: Number(cfg.baseTarget ?? 350),
                stretchTarget: Number(cfg.stretchTarget ?? 400)
            });
        });

        const timeByWeekStart = new Map<string, number>();
        const validYearTimeEntries = Array.isArray(initialTimeEntries) ? initialTimeEntries : [];
        validYearTimeEntries.forEach((entry: any) => {
            const entryStart = Number(entry?.start || 0);
            if (!entryStart) return;
            const wk = startOfWeek(new Date(entryStart), { weekStartsOn: 1 });
            const key = format(wk, "yyyy-MM-dd");
            const hrs = (Number(entry.duration) || 0) / (1000 * 60 * 60);
            timeByWeekStart.set(key, (timeByWeekStart.get(key) || 0) + hrs);
        });

        const getFirstMonday = (year: number) => {
            const d = new Date(year, 0, 1);
            while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
            return d;
        };

        const trend: any[] = [];
        let cursor = getFirstMonday(activeYear);
        const yearEnd = endOfYear(new Date(activeYear, 0, 1));
        while (cursor <= yearEnd) {
            const weekStartKey = format(cursor, "yyyy-MM-dd");
            const baseTargetForWeek = weekConfigByStart.get(weekStartKey)?.baseTarget ?? 350;
            const stretchTargetForWeek = weekConfigByStart.get(weekStartKey)?.stretchTarget ?? 400;
            const weekLabel = `W${format(cursor, "II")}`;
            const canonicalData = activeYear === 2026 ? CANONICAL_2026_WEEK_DATA[weekLabel] : undefined;
            trend.push({
                weekStart: weekStartKey,
                weekLabel,
                periodLabel: `${format(cursor, "MM/dd")} to ${format(addDays(cursor, 4), "MM/dd")}`,
                totalHours: Number((canonicalData?.totalHours ?? (timeByWeekStart.get(weekStartKey) || 0)).toFixed(1)),
                baseTarget: Number(baseTargetForWeek.toFixed(1)),
                stretchTarget: Number(stretchTargetForWeek.toFixed(1)),
                vsTarget: canonicalData?.vsTarget,
                vsStretch: canonicalData?.vsStretch,
            });
            cursor = addWeeks(cursor, 1);
        }
        return trend;
    }, [initialTimeEntries, activeWeekStrState, dbConfig?.weekConfigsForYear]);

    const mergedDbConfig = { ...dbConfig, weeklyTrend };

    return (
        <>
            {activeTab === "issues" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <EditableTaskBoard
                        activeWeekStr={activeWeekStrState}
                        tasks={proServicesTasks}
                        scopeType="all"
                        scopeId="all"
                        scopeName="All Tasks"
                        scopeParentFolderId={null}
                        assigneeOptions={activeConsultantNames}
                        initialAssigneeFilter={selectedAssigneeFilterState}
                        tabId="issues"
                        onNavigateWeek={handleWeekChange}
                        onAssigneeFilterChange={handleAssigneeFilterChange}
                        weekDataVersion={0}
                        onWeekDataRefresh={() => {}}
                    />
                </section>
            )}

            {activeTab === "command-center" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <CommandCenter
                        tasks={proServicesTasks}
                        timeEntries={initialTimeEntries}
                        activeWeekStr={activeWeekStrState}
                        dbConfig={mergedDbConfig}
                        onNavigateWeek={handleWeekChange}
                        isWeekLoading={false}
                    />
                </section>
            )}

            {activeTab === "trends" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <Trends
                        activeWeekStr={activeWeekStrState}
                        weeklyTrend={weeklyTrend}
                        onNavigateWeek={handleWeekChange}
                        isWeekLoading={false}
                    />
                </section>
            )}

            {activeTab === "capacity-trends" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <CapacityTrends
                        activeWeekStr={activeWeekStrState}
                        consultants={consultantsFromDirectory}
                        consultantConfigsForYear={dbConfig?.consultantConfigsForYear ?? []}
                        consultantConfigsCurrentWeek={dbConfig?.consultantConfigs ?? []}
                        capacityGridConfigsForYear={dbConfig?.capacityGridConfigsForYear ?? []}
                        onNavigateWeek={handleWeekChange}
                        isWeekLoading={false}
                    />
                </section>
            )}

            {activeTab === "capacity-grid" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <CapacityGrid
                        activeWeekStr={activeWeekStrState}
                        initialGrid={capacityGridState}
                        onGridChange={() => {}}
                        consultants={consultantsForRoster}
                        consultantConfigsById={consultantConfigsState}
                        clientDirectory={dbConfig?.clientDirectory ?? []}
                        tasks={proServicesTasks}
                        folders={[]} 
                        activeAssigneeFilter={selectedAssigneeFilterState}
                        plannedRollups={taskPlannedRollupsState}
                        billableRollups={taskBillableRollupsState}
                        onNavigateWeek={handleWeekChange}
                        onSelectTab={() => {}}
                        onOpenTaskBoard={() => {}}
                        isWeekLoading={false}
                    />
                </section>
            )}

            {activeTab === "client-setup" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <ClientSetup
                        initialClients={dbConfig?.clientDirectory ?? []}
                        onClientsChange={() => {}}
                    />
                </section>
            )}

            {activeTab === "consultant-utilization" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <ConsultantUtilization
                        activeWeekStr={activeWeekStrState}
                        consultants={consultantsForRoster}
                        consultantDirectory={consultantsFromDirectory}
                        consultantConfigsById={consultantConfigsState}
                        capacityGrid={capacityGridState}
                        onConsultantConfigChange={() => {}}
                        onConsultantConfigReplace={() => {}}
                        onCapacityGridChange={() => {}}
                        onNavigateWeek={handleWeekChange}
                        isWeekLoading={false}
                    />
                </section>
            )}

            {activeTab === "timesheets" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <Timesheets
                        activeWeekStr={activeWeekStrState}
                        tasks={proServicesTasks}
                        consultants={consultantsForRoster}
                        capacityGrid={capacityGridState}
                        folders={[]} 
                        clientDirectory={dbConfig?.clientDirectory ?? []}
                        initialAssigneeFilter={selectedAssigneeFilterState}
                        onNavigateWeek={handleWeekChange}
                        onAssigneeFilterChange={handleTimesheetAssigneeFilterChange}
                        weekDataVersion={0}
                        onWeekDataRefresh={() => {}}
                        isWeekLoading={false}
                    />
                </section>
            )}

            {activeTab === "backlog-growth" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <ProjectsBacklogGrowth
                        tasks={proServicesTasks}
                        projectOptions={[]}
                    />
                </section>
            )}
        </>
    );
}
