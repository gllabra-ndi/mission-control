import {
    getCapacityGridConfig,
    getDashboardDbData
} from "@/app/actions";
import { requireAppSession } from "@/lib/auth";
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
export const maxDuration = 300; // Increase Vercel timeout to 5 minutes to prevent streaming from being aborted

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
    W11: { totalHours: 445.8, vsTarget: 45.8, vsStretch: -54.3 },
    W12: { totalHours: 428.0, vsTarget: 28.0, vsStretch: -72.0 },
    W13: { totalHours: 412.9, vsTarget: 12.9, vsStretch: -87.1 },
    W14: { totalHours: 407.5, vsTarget: 7.5, vsStretch: -92.5 },
};

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

    const validYearTimeEntries = await initialTimeEntriesPromise;
    const timeByWeekStart = new Map<string, number>();
    validYearTimeEntries.forEach((entry: any) => {
        const entryStart = Number(entry?.start || 0);
        if (!entryStart) return;
        const wk = startOfWeek(new Date(entryStart), { weekStartsOn: 1 });
        const key = format(wk, "yyyy-MM-dd");
        const hrs = (Number(entry.duration) || 0) / (1000 * 60 * 60);
        timeByWeekStart.set(key, (timeByWeekStart.get(key) || 0) + hrs);
    });
    const currentWeekStartKey = format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd");
    const currentWeekActualHours = Number((timeByWeekStart.get(currentWeekStartKey) || 0).toFixed(1));
    const getFirstMonday = (year: number) => {
        const d = new Date(year, 0, 1);
        while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
        return d;
    };

    const weeklyTrend: Array<{
        weekStart: string;
        weekLabel: string;
        periodLabel: string;
        totalHours: number;
        baseTarget: number;
        stretchTarget: number;
        vsTarget?: number;
        vsStretch?: number;
    }> = [];

    let cursor = getFirstMonday(activeYear);
    const yearEnd = endOfYear(new Date(activeYear, 0, 1));
    while (cursor <= yearEnd) {
        const weekStartKey = format(cursor, "yyyy-MM-dd");
        const baseTargetForWeek = weekConfigByStart.get(weekStartKey)?.baseTarget ?? 350;
        const stretchTargetForWeek = weekConfigByStart.get(weekStartKey)?.stretchTarget ?? 400;
        const weekLabel = `W${format(cursor, "II")}`;
        const canonicalData = activeYear === 2026 ? CANONICAL_2026_WEEK_DATA[weekLabel] : undefined;
        const resolvedTotalHours = weekStartKey >= currentWeekStartKey
            ? currentWeekActualHours
            : Number((canonicalData?.totalHours ?? (timeByWeekStart.get(weekStartKey) || 0)).toFixed(1));
        weeklyTrend.push({
            weekStart: weekStartKey,
            weekLabel,
            periodLabel: `${format(cursor, "MM/dd")} to ${format(addDays(cursor, 4), "MM/dd")}`,
            totalHours: resolvedTotalHours,
            baseTarget: Number(baseTargetForWeek.toFixed(1)),
            stretchTarget: Number(stretchTargetForWeek.toFixed(1)),
            vsTarget: canonicalData?.vsTarget,
            vsStretch: canonicalData?.vsStretch,
        });
        cursor = addWeeks(cursor, 1);
    }

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
                weekConfigsForYear,
                weeklyTrend,
                leadConfigs,
                clientConfigs: finalClientConfigs,
                clientDirectory,
                consultants: consultantRoster,
                activeConsultants, // Pass activeConsultants correctly
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
    );
}
