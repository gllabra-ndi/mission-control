"use client";

import { useState, useMemo, useEffect } from "react";
import { Sidebar, FolderWithLists } from "@/components/Sidebar";
import { KanbanBoard } from "@/components/KanbanBoard";
import { CommandCenter } from "@/components/CommandCenter";
import { ProjectsBurndown } from "@/components/ProjectsBurndown";
import { ProjectsBacklogGrowth } from "@/components/ProjectsBacklogGrowth";
import { CapacityGrid } from "@/components/CapacityGrid";
import { ConsultantUtilization } from "@/components/ConsultantUtilization";
import { Trends } from "@/components/Trends";
import { CapacityTrends } from "@/components/CapacityTrends";
import { CapacityGridPayload } from "@/app/actions";
import { groupTasksByStatus, ClickUpTask, TimeEntry, PROFESSIONAL_SERVICES_SPACE_ID } from "@/lib/clickup";
import { Rocket } from "lucide-react";

interface DashboardClientProps {
    initialTasks: ClickUpTask[];
    initialFolders: FolderWithLists[];
    initialTimeEntries: TimeEntry[];
    isError: boolean;
    weekStartStr: string;
    dbConfig: any; // Mapped Prisma payload
    initialTab?: string;
}

const EMPTY_CAPACITY_GRID: CapacityGridPayload = { resources: [], rows: [] };
const VALID_TABS = new Set(["issues", "command-center", "trends", "capacity-trends", "consultant-utilization", "capacity-grid", "projects", "backlog-growth"]);
const normalizeTab = (tab?: string) => (tab && VALID_TABS.has(tab) ? tab : "command-center");

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

export function DashboardClient({ initialTasks, initialFolders, initialTimeEntries, isError, weekStartStr, dbConfig, initialTab }: DashboardClientProps) {
    const [selectedListId, setSelectedListId] = useState<string | null>(null);
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<string>(normalizeTab(initialTab));
    const [capacityGridState, setCapacityGridState] = useState<CapacityGridPayload>(dbConfig?.capacityGridConfig ?? EMPTY_CAPACITY_GRID);
    const resolvedActiveTab = normalizeTab(activeTab);

    useEffect(() => {
        setCapacityGridState(dbConfig?.capacityGridConfig ?? EMPTY_CAPACITY_GRID);
    }, [weekStartStr, dbConfig?.capacityGridConfig]);

    useEffect(() => {
        setActiveTab(normalizeTab(initialTab));
    }, [initialTab]);

    // Filter tasks down strictly to the Professional Services space
    const proServicesTasks = useMemo(() => {
        return initialTasks.filter(t => t.space?.id === PROFESSIONAL_SERVICES_SPACE_ID);
    }, [initialTasks]);

    const availableFolders = useMemo(() => {
        const shouldExcludeList = (name: string) => /user\s*guide/i.test(name);
        if (initialFolders.length > 0) {
            return initialFolders
                .map((folder) => ({
                    ...folder,
                    lists: folder.lists.filter((list) => !shouldExcludeList(list.name))
                }))
                .filter((folder) => folder.lists.length > 0);
        }

        const folderMap = new Map<string, { id: string, name: string, lists: Map<string, { id: string, name: string, statusOrder: string[] }> }>();
        proServicesTasks.forEach((task) => {
            if (!task.folder?.id || !task.folder?.name) return;
            if (!folderMap.has(task.folder.id)) {
                folderMap.set(task.folder.id, {
                    id: task.folder.id,
                    name: task.folder.name,
                    lists: new Map()
                });
            }

            if (task.list?.id && task.list?.name) {
                if (shouldExcludeList(task.list.name)) return;
                folderMap.get(task.folder.id)!.lists.set(task.list.id, {
                    id: task.list.id,
                    name: task.list.name,
                    statusOrder: []
                });
            }
        });

        return Array.from(folderMap.values()).map((folder) => ({
            id: folder.id,
            name: folder.name,
            lists: Array.from(folder.lists.values())
        }));
    }, [initialFolders, proServicesTasks]);

    const handleListSelect = (listId: string | null) => {
        setActiveTab("issues");
        setSelectedListId((prev) => (prev === listId ? null : listId));
        if (listId) setSelectedFolderId(null);
    };

    const handleFolderSelect = (folderId: string | null) => {
        setActiveTab("issues");
        setSelectedFolderId((prev) => (prev === folderId ? null : folderId));
        if (folderId) setSelectedListId(null);
    };

    // 3. Slice tasks based on active Client (List) or Team (Folder)
    const visibleTasks = useMemo(() => {
        if (selectedListId) {
            return proServicesTasks.filter(t => t.list?.id === selectedListId);
        }
        if (selectedFolderId) {
            return proServicesTasks.filter(t => t.folder?.id === selectedFolderId);
        }
        return proServicesTasks;
    }, [proServicesTasks, selectedListId, selectedFolderId]);

    const groupedTasks = useMemo(() => groupTasksByStatus(visibleTasks), [visibleTasks]);
    const selectedListStatusOrder = useMemo(() => {
        if (!selectedListId) return undefined;
        for (const folder of availableFolders) {
            const list = folder.lists.find((l) => l.id === selectedListId);
            if (list?.statusOrder && list.statusOrder.length > 0) return list.statusOrder;
        }
        return undefined;
    }, [availableFolders, selectedListId]);

    const projectOptions = useMemo(() => {
        return availableFolders
            .flatMap((folder) => folder.lists.map((list) => ({ id: list.id, name: list.name })))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [availableFolders]);

    const consultantsFromTasks = useMemo(() => {
        const byId = new Map<number, string>();
        proServicesTasks.forEach((task) => {
            if (!Array.isArray(task.assignees)) return;
            task.assignees.forEach((a: any) => {
                const id = Number(a?.id ?? 0);
                if (!id) return;
                const name = String(a?.username ?? "").trim();
                if (!name) return;
                const current = byId.get(id) || "";
                byId.set(id, pickPreferredConsultantName(current, name));
            });
        });
        return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
    }, [proServicesTasks]);

    const baseConsultantConfigsById = useMemo(() => {
        const byId = new Map<number, { maxCapacity: number; billableCapacity: number; notes: string }>();
        consultantsFromTasks.forEach((consultant) => {
            byId.set(consultant.id, { maxCapacity: 40, billableCapacity: 40, notes: "" });
        });

        const consultantConfigs = Array.isArray(dbConfig?.consultantConfigs) ? dbConfig.consultantConfigs : [];
        consultantConfigs.forEach((cfg: any) => {
            const consultantId = Number(cfg?.consultantId ?? 0);
            if (consultantId <= 0) return;
            const existing = byId.get(consultantId) || { maxCapacity: 40, billableCapacity: 40, notes: "" };
            byId.set(consultantId, {
                maxCapacity: Number(cfg?.maxCapacity ?? existing.maxCapacity ?? 40),
                billableCapacity: Number(cfg?.billableCapacity ?? existing.billableCapacity ?? 40),
                notes: String(cfg?.notes ?? existing.notes ?? ""),
            });
        });

        const result: Record<number, { maxCapacity: number; billableCapacity: number; notes: string }> = {};
        byId.forEach((value, consultantId) => {
            result[consultantId] = value;
        });
        return result;
    }, [consultantsFromTasks, dbConfig?.consultantConfigs]);

    const [consultantConfigsState, setConsultantConfigsState] = useState<Record<number, { maxCapacity: number; billableCapacity: number; notes: string }>>(baseConsultantConfigsById);

    useEffect(() => {
        setConsultantConfigsState(baseConsultantConfigsById);
    }, [weekStartStr, baseConsultantConfigsById]);

    const consultantConfigsForCommandCenter = useMemo(() => {
        return Object.entries(consultantConfigsState).map(([consultantId, cfg]) => ({
            consultantId: Number(consultantId),
            maxCapacity: Number(cfg.maxCapacity ?? 40),
            billableCapacity: Number(cfg.billableCapacity ?? 40),
            notes: String(cfg.notes ?? ""),
        }));
    }, [consultantConfigsState]);

    const previousConsultantConfigsForCommandCenter = useMemo(() => {
        const byId = new Map<number, { maxCapacity: number; billableCapacity: number; notes: string }>();
        consultantsFromTasks.forEach((consultant) => {
            byId.set(consultant.id, { maxCapacity: 40, billableCapacity: 40, notes: "" });
        });

        const prevRows = Array.isArray(dbConfig?.previousConsultantConfigs) ? dbConfig.previousConsultantConfigs : [];
        prevRows.forEach((cfg: any) => {
            const consultantId = Number(cfg?.consultantId ?? 0);
            if (consultantId <= 0) return;
            const existing = byId.get(consultantId) || { maxCapacity: 40, billableCapacity: 40, notes: "" };
            byId.set(consultantId, {
                maxCapacity: Number(cfg?.maxCapacity ?? existing.maxCapacity ?? 40),
                billableCapacity: Number(cfg?.billableCapacity ?? existing.billableCapacity ?? 40),
                notes: String(cfg?.notes ?? existing.notes ?? ""),
            });
        });

        return Array.from(byId.entries()).map(([consultantId, cfg]) => ({
            consultantId,
            maxCapacity: Number(cfg.maxCapacity ?? 40),
            billableCapacity: Number(cfg.billableCapacity ?? 40),
            notes: String(cfg.notes ?? ""),
        }));
    }, [consultantsFromTasks, dbConfig?.previousConsultantConfigs]);

    const mergedDbConfig = useMemo(() => ({
        ...dbConfig,
        capacityGridConfig: capacityGridState,
        consultantConfigs: consultantConfigsForCommandCenter,
        previousConsultantConfigs: previousConsultantConfigsForCommandCenter,
    }), [dbConfig, capacityGridState, consultantConfigsForCommandCenter, previousConsultantConfigsForCommandCenter]);

    const handleConsultantConfigChange = (
        consultantId: number,
        patch: Partial<{ maxCapacity: number; billableCapacity: number; notes: string }>
    ) => {
        setConsultantConfigsState((prev) => ({
            ...prev,
            [consultantId]: {
                ...(prev[consultantId] || { maxCapacity: 40, billableCapacity: 40, notes: "" }),
                ...patch,
            },
        }));
    };

    return (
        <div className="flex h-screen w-full bg-background overflow-hidden text-sm selection:bg-primary/30 selection:text-white">
            <Sidebar
                folders={availableFolders}
                selectedListId={selectedListId}
                selectedFolderId={selectedFolderId}
                activeTab={resolvedActiveTab}
                onSelectList={handleListSelect}
                onSelectFolder={handleFolderSelect}
                onSelectTab={(tab) => setActiveTab(VALID_TABS.has(tab) ? tab : "command-center")}
                teamsLabel="Clients"
            />

            <main className="flex-1 flex flex-col h-full overflow-hidden relative">
                {/* Header Bar */}
                <header className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0 bg-background/90 backdrop-blur-md z-20">
                    <div className="flex items-center gap-3">
                        <div className="w-5 h-5 rounded overflow-hidden">
                            <div className="w-full h-full bg-gradient-to-br from-indigo-500 to-purple-500 rounded-sm" />
                        </div>
                        <h1 className="font-semibold text-white">Mission Engine</h1>
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

                {isError && (
                    <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 mx-6 mt-6 rounded-lg text-sm flex items-center gap-2">
                        <Rocket className="w-4 h-4" />
                        <span>Connection Error: ClickUp API Key missing or invalid. Displaying empty state.</span>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 custom-scrollbar flex flex-col relative">
                    {/* Conditional Rendering based on activeTab */}
                    {resolvedActiveTab === "issues" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-sm font-medium text-text-main flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                                    Initiatives
                                    <span className="text-text-muted font-normal ml-2">({visibleTasks.length} total)</span>
                                </h2>
                            </div>

                            <div className="flex-1 border bg-surface/30 border-border rounded-xl p-4 overflow-hidden shadow-inner transition-opacity duration-300">
                                <KanbanBoard groupedTasks={groupedTasks} columnOrder={selectedListStatusOrder} />
                            </div>
                        </section>
                    )}

                    {resolvedActiveTab === "command-center" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <CommandCenter
                                tasks={proServicesTasks}
                                timeEntries={initialTimeEntries}
                                activeWeekStr={weekStartStr}
                                dbConfig={mergedDbConfig}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "trends" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <Trends
                                activeWeekStr={weekStartStr}
                                weeklyTrend={Array.isArray(mergedDbConfig?.weeklyTrend) ? mergedDbConfig.weeklyTrend : []}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "capacity-trends" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <CapacityTrends
                                activeWeekStr={weekStartStr}
                                consultants={consultantsFromTasks}
                                consultantConfigsForYear={Array.isArray(mergedDbConfig?.consultantConfigsForYear) ? mergedDbConfig.consultantConfigsForYear : []}
                                consultantConfigsCurrentWeek={Array.isArray(mergedDbConfig?.consultantConfigs) ? mergedDbConfig.consultantConfigs : []}
                                capacityGridConfigsForYear={Array.isArray(mergedDbConfig?.capacityGridConfigsForYear) ? mergedDbConfig.capacityGridConfigsForYear : []}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "capacity-grid" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <CapacityGrid
                                activeWeekStr={weekStartStr}
                                initialGrid={capacityGridState}
                                onGridChange={setCapacityGridState}
                                consultants={consultantsFromTasks}
                                consultantConfigsById={consultantConfigsState}
                                tasks={proServicesTasks}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "consultant-utilization" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <ConsultantUtilization
                                activeWeekStr={weekStartStr}
                                consultants={consultantsFromTasks}
                                consultantConfigsById={consultantConfigsState}
                                capacityGrid={capacityGridState}
                                onConsultantConfigChange={handleConsultantConfigChange}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "projects" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <ProjectsBurndown
                                tasks={proServicesTasks}
                                projectOptions={projectOptions}
                            />
                        </section>
                    )}

                    {resolvedActiveTab === "backlog-growth" && (
                        <section className="flex-1 flex flex-col min-h-[400px]">
                            <ProjectsBacklogGrowth
                                tasks={proServicesTasks}
                                projectOptions={projectOptions}
                            />
                        </section>
                    )}
                </div>
            </main>
        </div>
    );
}
