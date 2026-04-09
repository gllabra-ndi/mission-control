"use client";

import { useState, useMemo, useEffect, useCallback, use, Suspense } from "react";
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
import { CapacityGridPayload, EditableTaskBillableRollupRecord, EditableTaskPlannedRollupRecord, TaskSidebarStructureRecord } from "@/app/actions";
import { ClickUpTask, TimeEntry, PROFESSIONAL_SERVICES_SPACE_ID } from "@/lib/clickup";
import { MissionEngineMark } from "@/components/BrandMarks";

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

type ClientOption = {
    id: string;
    name: string;
};

type DashboardExtraParams = Record<string, string | null | undefined>;

const EMPTY_CAPACITY_GRID: CapacityGridPayload = { resources: [], rows: [] };
const VALID_TABS = new Set(["issues", "editable-tasks", "command-center", "trends", "capacity-trends", "consultant-utilization", "timesheets", "capacity-grid", "client-setup", "backlog-growth"]);
const normalizeTab = (tab?: string) => (tab && VALID_TABS.has(tab) ? tab : "command-center");

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
        <div className="flex-1 space-y-8 animate-pulse">
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

    useEffect(() => {
        setActiveWeekStrState(weekStartStr);
        setActiveTabState(normalizeTab(initialTab));
        setSelectedListIdState(initialSelectedListId);
        setSelectedFolderIdState(initialSelectedFolderId);
        setSelectedAssigneeFilterState(initialAssigneeFilter);
        setDashboardConfigState(dbConfig);
        setTaskPlannedRollupsState(initialTaskPlannedRollups);
        setTaskBillableRollupsState(initialTaskBillableRollups);
        setCapacityGridState(dbConfig?.capacityGridConfig ?? EMPTY_CAPACITY_GRID);
    }, [weekStartStr, initialTab, initialSelectedListId, initialSelectedFolderId, initialAssigneeFilter, dbConfig, initialTaskPlannedRollups, initialTaskBillableRollups]);

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
        if (nextAssignee) params.set("assignee", nextAssignee);
        else params.delete("assignee");
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
            if (nextValue.length > 0) params.set(key, nextValue);
            else params.delete(key);
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

    const handleListSelect = (listId: string | null) => navigateWithState("issues", listId, null);
    const handleFolderSelect = (folderId: string | null) => navigateWithState("issues", null, folderId);
    const handleTabSelect = (tab: string) => navigateWithState(VALID_TABS.has(tab) ? tab : "command-center", selectedListIdState, selectedFolderIdState);
    const handleAssigneeFilterChange = useCallback((nextAssignee: string | null) => navigateWithState("issues", selectedListIdState, selectedFolderIdState, nextAssignee), [navigateWithState, selectedFolderIdState, selectedListIdState]);
    const handleTimesheetAssigneeFilterChange = useCallback((nextAssignee: string | null) => navigateWithState("timesheets", selectedListIdState, selectedFolderIdState, nextAssignee), [navigateWithState, selectedFolderIdState, selectedListIdState]);

    const handleWeekChange = useCallback((nextWeek: string) => {
        const nextHref = buildDashboardHref(nextWeek, resolvedActiveTab, selectedListIdState, selectedFolderIdState, selectedAssigneeFilterState);
        router.push(nextHref);
    }, [buildDashboardHref, resolvedActiveTab, router, selectedAssigneeFilterState, selectedFolderIdState, selectedListIdState]);

    return (
        <div className="flex h-screen w-full bg-background overflow-hidden text-sm selection:bg-primary/30 selection:text-white">
            <Sidebar
                foldersPromise={initialFoldersPromise}
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

            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                <header className="h-[68px] border-b border-border flex items-center justify-between px-6 pt-2 shrink-0 bg-background/90 backdrop-blur-md z-20">
                    <div className="flex items-center gap-3">
                        <MissionEngineMark className="h-9 w-9 rounded-xl" />
                        <div className="min-w-0">
                            <h1 className="font-semibold text-white leading-tight">Mission Engine</h1>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-text-muted/85">Live Operations</div>
                        </div>
                        <span className="text-text-muted text-xs bg-surface-hover px-2 py-0.5 rounded-full border border-border">Prod</span>
                    </div>

                    <div className="flex items-center gap-5">
                        <div className="lucid-interactive flex items-center gap-2 cursor-pointer border border-border/50">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-xs">System Online</span>
                        </div>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 custom-scrollbar flex flex-col relative">
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
                        clientOptions={clientOptions}
                        handleTimesheetAssigneeFilterChange={handleTimesheetAssigneeFilterChange}
                    />
                </div>
            </main>
        </div>
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
    clientOptions,
    handleTimesheetAssigneeFilterChange,
}: any) {
    // We wrap each tab in its own Suspense or pass promises down
    
    // Some tabs might need resolved data early, but for "feel fast" we should try to avoid top-level use() here.
    // However, some hooks below (like weeklyTrend) need the data.
    
    return (
        <Suspense fallback={<ContentSkeleton />}>
            <ContentTabs
                activeTab={activeTab}
                initialTasksPromise={initialTasksPromise}
                initialTimeEntriesPromise={initialTimeEntriesPromise}
                activeWeekStrState={activeWeekStrState}
                dbConfig={dbConfig}
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
                clientOptions={clientOptions}
                handleTimesheetAssigneeFilterChange={handleTimesheetAssigneeFilterChange}
            />
        </Suspense>
    );
}

function ContentTabs({
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
    clientOptions,
    handleTimesheetAssigneeFilterChange,
}: any) {
    // We pass promises down to tabs that support them, or use(promises) for those that don't yet.
    // For command-center, we definitely want to pass promises to show the shell immediately.

    return (
        <>
            {activeTab === "issues" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <IssuesTabStream
                        initialTasksPromise={initialTasksPromise}
                        activeWeekStrState={activeWeekStrState}
                        activeConsultantNames={activeConsultantNames}
                        selectedAssigneeFilterState={selectedAssigneeFilterState}
                        handleWeekChange={handleWeekChange}
                        handleAssigneeFilterChange={handleAssigneeFilterChange}
                    />
                </section>
            )}

            {activeTab === "command-center" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <CommandCenter
                        tasksPromise={initialTasksPromise}
                        timeEntriesPromise={initialTimeEntriesPromise}
                        activeWeekStr={activeWeekStrState}
                        dbConfig={dbConfig}
                        onNavigateWeek={handleWeekChange}
                        isWeekLoading={false}
                    />
                </section>
            )}

            {activeTab === "trends" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <TrendsTabStream
                        activeWeekStrState={activeWeekStrState}
                        dbConfig={dbConfig}
                        handleWeekChange={handleWeekChange}
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
                    <CapacityGridTabStream
                        initialTasksPromise={initialTasksPromise}
                        activeWeekStrState={activeWeekStrState}
                        capacityGridState={capacityGridState}
                        consultantsForRoster={consultantsForRoster}
                        consultantConfigsState={consultantConfigsState}
                        dbConfig={dbConfig}
                        selectedAssigneeFilterState={selectedAssigneeFilterState}
                        taskPlannedRollupsState={taskPlannedRollupsState}
                        taskBillableRollupsState={taskBillableRollupsState}
                        handleWeekChange={handleWeekChange}
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
                    <TimesheetsTabStream
                        initialTasksPromise={initialTasksPromise}
                        activeWeekStrState={activeWeekStrState}
                        consultantsForRoster={consultantsForRoster}
                        capacityGridState={capacityGridState}
                        dbConfig={dbConfig}
                        selectedAssigneeFilterState={selectedAssigneeFilterState}
                        handleWeekChange={handleWeekChange}
                        handleTimesheetAssigneeFilterChange={handleTimesheetAssigneeFilterChange}
                    />
                </section>
            )}

            {activeTab === "backlog-growth" && (
                <section className="flex-1 flex flex-col min-h-[400px]">
                    <BacklogGrowthTabStream
                        initialTasksPromise={initialTasksPromise}
                    />
                </section>
            )}
        </>
    );
}

function IssuesTabStream({ initialTasksPromise, activeWeekStrState, activeConsultantNames, selectedAssigneeFilterState, handleWeekChange, handleAssigneeFilterChange }: { initialTasksPromise: Promise<ClickUpTask[]>, activeWeekStrState: string, activeConsultantNames: string[], selectedAssigneeFilterState: string | null, handleWeekChange: (w: string) => void, handleAssigneeFilterChange: (a: string | null) => void }) {
    const tasks = use(initialTasksPromise);
    const proServicesTasks = useMemo(() => tasks.filter((t: any) => t.space?.id === PROFESSIONAL_SERVICES_SPACE_ID), [tasks]);
    return (
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
    );
}

function TrendsTabStream({ activeWeekStrState, dbConfig, handleWeekChange }: { activeWeekStrState: string, dbConfig: any, handleWeekChange: (w: string) => void }) {
    const weeklyTrend = useMemo(() => {
        return Array.isArray(dbConfig?.weeklyTrend) ? dbConfig.weeklyTrend : [];
    }, [dbConfig?.weeklyTrend]);

    return (
        <Trends
            activeWeekStr={activeWeekStrState}
            weeklyTrend={weeklyTrend}
            onNavigateWeek={handleWeekChange}
            isWeekLoading={false}
        />
    );
}

function CapacityGridTabStream({ initialTasksPromise, activeWeekStrState, capacityGridState, consultantsForRoster, consultantConfigsState, dbConfig, selectedAssigneeFilterState, taskPlannedRollupsState, taskBillableRollupsState, handleWeekChange }: { initialTasksPromise: Promise<ClickUpTask[]>, activeWeekStrState: string, capacityGridState: any, consultantsForRoster: any, consultantConfigsState: any, dbConfig: any, selectedAssigneeFilterState: any, taskPlannedRollupsState: any, taskBillableRollupsState: any, handleWeekChange: any }) {
    const tasks = use(initialTasksPromise);
    const proServicesTasks = useMemo(() => tasks.filter((t: any) => t.space?.id === PROFESSIONAL_SERVICES_SPACE_ID), [tasks]);
    return (
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
    );
}

function TimesheetsTabStream({ initialTasksPromise, activeWeekStrState, consultantsForRoster, capacityGridState, dbConfig, selectedAssigneeFilterState, handleWeekChange, handleTimesheetAssigneeFilterChange }: { initialTasksPromise: Promise<ClickUpTask[]>, activeWeekStrState: string, consultantsForRoster: any, capacityGridState: any, dbConfig: any, selectedAssigneeFilterState: any, handleWeekChange: any, handleTimesheetAssigneeFilterChange: any }) {
    const tasks = use(initialTasksPromise);
    const proServicesTasks = useMemo(() => tasks.filter((t: any) => t.space?.id === PROFESSIONAL_SERVICES_SPACE_ID), [tasks]);
    return (
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
    );
}

function BacklogGrowthTabStream({ initialTasksPromise }: { initialTasksPromise: Promise<ClickUpTask[]> }) {
    const tasks = use(initialTasksPromise);
    const proServicesTasks = useMemo(() => tasks.filter((t: any) => t.space?.id === PROFESSIONAL_SERVICES_SPACE_ID), [tasks]);
    return (
        <ProjectsBacklogGrowth
            tasks={proServicesTasks}
            projectOptions={[]}
        />
    );
}
