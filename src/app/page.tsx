import {
    getWeekConfig,
    getWeekConfigsForYear,
    getLeadConfigs,
    getClientConfigs,
    getClientDirectory,
    getConsultantConfigs,
    getConsultantUtilizationDirectory,
    getCapacityGridConfig,
    getConsultantConfigsForYear,
    getCapacityGridConfigsForYear,
    getEditableTaskBillableRollups,
    getEditableTaskPlannedRollups,
    getTaskSidebarStructure,
    getDashboardDbData
} from "@/app/actions";
import { requireAppSession } from "@/lib/auth";
import { Suspense } from "react";
import { addDays, addWeeks, endOfYear, format, startOfWeek } from "date-fns";
import {
    getTeamTasks,
    getTeamTimeEntries,
    getSpaceFoldersWithLists,
    PROFESSIONAL_SERVICES_SPACE_ID
} from "@/lib/clickup";
import { DashboardClient } from "@/components/DashboardClient";

function normalizeConsultantNameKey(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export const dynamic = "force-dynamic";

function DashboardSkeleton() {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
            <div className="flex flex-col items-center space-y-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                <p className="text-slate-600 font-medium">Loading Mission Control...</p>
            </div>
        </div>
    );
}

export default async function DashboardPage({ searchParams }: { searchParams: { week?: string; tab?: string; listId?: string; folderId?: string; assignee?: string } }) {
    await requireAppSession();

    // Await searchParams for Next.js 15 compatibility, but fallback safely
    const sp = await Promise.resolve(searchParams);

    // Current week Monday to Sunday
    let referenceDate = new Date();
    if (sp?.week) {
        // e.g. "2024-10-21"
        const parsed = new Date(sp.week + 'T00:00:00');
        if (!isNaN(parsed.getTime())) {
            referenceDate = parsed;
        }
    }

    const startMs = startOfWeek(referenceDate, { weekStartsOn: 1 }).getTime();
    const endMs = addDays(new Date(startMs), 6).getTime();

    const weekStartStr = format(startMs, 'yyyy-MM-dd');
    const initialTab = String(sp?.tab || "");
    const initialSelectedListId = typeof sp?.listId === "string" && sp.listId.trim().length > 0 ? sp.listId.trim() : null;
    const initialSelectedFolderId = initialSelectedListId
        ? null
        : typeof sp?.folderId === "string" && sp.folderId.trim().length > 0
            ? sp.folderId.trim()
            : null;
    const initialAssigneeFilter = typeof sp?.assignee === "string" && sp.assignee.trim().length > 0 ? sp.assignee.trim() : null;
    const previousWeekStartStr = format(addWeeks(new Date(startMs), -1), "yyyy-MM-dd");
    const activeYear = new Date(startMs).getFullYear();
    const yearStartMs = new Date(activeYear, 0, 1).getTime();
    const yearEndMs = endOfYear(new Date(activeYear, 0, 1)).getTime();

    const EXCLUDED_FOLDERS = [
        "90175039771", // PS Look Up Tables
        "90174957796" // Monthly Budgets
    ];

    const BASE_CONFIG_WEEK = "2026-03-02";

    // 1. Kick off ClickUp fetches (Promises)
    const initialTasksPromise = getTeamTasks();
    const initialFoldersPromise = getSpaceFoldersWithLists(PROFESSIONAL_SERVICES_SPACE_ID, EXCLUDED_FOLDERS);
    const initialTimeEntriesPromise = getTeamTimeEntries(yearStartMs, yearEndMs);

    // 2. Await consolidated DB data (Faster)
    const dbData = await getDashboardDbData({
        weekStartStr,
        previousWeekStartStr,
        baseWeekStartStr: BASE_CONFIG_WEEK,
        activeYear
    });

    const {
        weekConfig,
        weekConfigsForYear,
        leadConfigs,
        previousLeadConfigs,
        clientConfigs,
        previousClientConfigs,
        baseClientConfigs,
        consultantConfigs,
        previousConsultantConfigs,
        baseConsultantConfigs,
        clientDirectory,
        savedConsultants,
        activeConsultants,
        consultantConfigsForYear,
        capacityGridConfigsForYear,
        sidebarStructure,
        plannedRollups,
        billableRollupsCurrent,
        billableRollupsPrevious,
    } = dbData;

    const consultantRosterById = new Map<number, { id: number; name: string; firstName?: string; lastName?: string; email?: string; source?: string }>();
    const consultantIdByNameKey = new Map<string, number>();

    savedConsultants.forEach((consultant) => {
        const consultantName = consultant.fullName;
        consultantRosterById.set(consultant.id, {
            id: consultant.id,
            name: consultantName,
            firstName: consultant.firstName,
            lastName: consultant.lastName,
            email: consultant.email,
            source: consultant.source,
        });
        const nameKey = normalizeConsultantNameKey(consultantName);
        if (nameKey) consultantIdByNameKey.set(nameKey, consultant.id);
    });

    const consultantRoster = Array.from(consultantRosterById.values())
        .sort((a, b) => a.name.localeCompare(b.name));

    const capacityGridConfig = await getCapacityGridConfig(
        weekStartStr,
        consultantRoster.map(({ id, name }) => ({ id, name }))
    );

    const weekConfigByStart = new Map<string, { baseTarget: number, stretchTarget: number }>();
    weekConfigsForYear.forEach((cfg: any) => {
        weekConfigByStart.set(cfg.week, {
            baseTarget: Number(cfg.baseTarget ?? 350),
            stretchTarget: Number(cfg.stretchTarget ?? 400)
        });
    });

    const getFirstMonday = (year: number) => {
        const d = new Date(year, 0, 1);
        while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
        return d;
    };

    const weeklyTrend: any[] = []; // We'll compute this in the client or pass it if possible
    // Actually, timeByWeekStart depends on initialTimeEntries which is a promise now.
    // I'll move the trend calculation to the client or handle it better.
    // For now, let's keep it simple and see if we can move some logic to DashboardClient.

    const mergeClientConfigs = (baseRows: any[], weekRows: any[]) => {
        const baseById = new Map<string, any>();
        baseRows.forEach((row: any) => {
            baseById.set(String(row.clientId), row);
        });

        const weekById = new Map<string, any>();
        weekRows.forEach((row: any) => {
            weekById.set(String(row.clientId), row);
        });

        const merged: any[] = [];
        baseById.forEach((baseRow, clientId) => {
            const weekRow = weekById.get(clientId);
            merged.push({
                ...baseRow,
                ...(weekRow || {}),
                clientId,
                orderIndex: weekRow?.orderIndex ?? baseRow.orderIndex ?? 0,
                clientName: weekRow?.clientName || baseRow.clientName || clientId,
            });
            weekById.delete(clientId);
        });

        weekById.forEach((row) => {
            merged.push({
                ...row,
                clientId: String(row.clientId),
                clientName: row.clientName || String(row.clientId),
                orderIndex: row.orderIndex ?? 9999,
            });
        });

        return merged.sort((a, b) => {
            const ao = Number(a.orderIndex ?? 9999);
            const bo = Number(b.orderIndex ?? 9999);
            if (ao !== bo) return ao - bo;
            return String(a.clientName || a.clientId).localeCompare(String(b.clientName || b.clientId));
        });
    };

    const activeClientIds = new Set(
        clientDirectory
            .filter((client) => client.isActive)
            .map((client) => String(client.id))
    );
    const clientDirectoryById = new Map(
        clientDirectory.map((client) => [String(client.id), client] as const)
    );

    let finalClientConfigs = mergeClientConfigs(baseClientConfigs, clientConfigs)
        .map((row) => {
            const client = clientDirectoryById.get(String(row.clientId));
            if (!client) return row;
            return {
                ...row,
                clientName: client.name || row.clientName,
                team: client.team ?? row.team,
                sa: client.sa || row.sa,
                dealType: client.dealType || row.dealType,
                min: client.min ?? row.min,
                max: client.max ?? row.max,
                isActive: client.isActive,
                isInternal: client.isInternal,
                orderIndex: client.sortOrder ?? row.orderIndex ?? 0,
            };
        })
        .filter((row) => activeClientIds.size === 0 || activeClientIds.has(String(row.clientId)));

    let finalConsultantConfigs = consultantConfigs.length > 0 ? consultantConfigs : baseConsultantConfigs;

    return (
        <Suspense fallback={<DashboardSkeleton />}>
            <DashboardClient
                initialTasksPromise={initialTasksPromise}
                initialFoldersPromise={initialFoldersPromise}
                initialTimeEntriesPromise={initialTimeEntriesPromise}
                weekStartStr={weekStartStr}
                initialTab={initialTab}
                initialSelectedListId={initialSelectedListId}
                initialSelectedFolderId={initialSelectedFolderId}
                initialAssigneeFilter={initialAssigneeFilter}
                initialTaskPlannedRollups={plannedRollups}
                initialTaskBillableRollups={billableRollupsCurrent}
                initialSidebarStructure={sidebarStructure}
                dbConfig={{
                    weekConfig,
                    weeklyTrend: [], // Move trend calculation to client or handle differently
                    leadConfigs,
                    clientConfigs: finalClientConfigs,
                    clientDirectory,
                    consultants: consultantRoster,
                    consultantConfigs: finalConsultantConfigs,
                    capacityGridConfig,
                    consultantConfigsForYear,
                    capacityGridConfigsForYear,
                    taskPlannedRollups: plannedRollups,
                    previousWeekStartStr,
                    previousLeadConfigs,
                    previousClientConfigs,
                    previousConsultantConfigs,
                    previousTaskBillableRollups: billableRollupsPrevious,
                }}
            />
        </Suspense>
    );
}
