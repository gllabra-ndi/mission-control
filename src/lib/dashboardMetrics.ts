import type { CapacityGridPayload } from "@/app/actions";
import type { ImportedTask } from "@/lib/imported-data";

export type CapacityHeaderMetrics = {
    totalCapacity: number;
    planned: number;
    actuals: number;
    wkMinTotal: number;
    wkMaxTotal: number;
    gapToMin: number;
};

export function normalizeDashboardName(value: string): string {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function getAllocationHours(cell: unknown) {
    const legacyCell = cell as { hours?: number; wt?: number; wPlus?: number } | undefined;
    return Number(legacyCell?.hours ?? Number(legacyCell?.wt ?? 0) + Number(legacyCell?.wPlus ?? 0));
}

function buildTaskScopeLabels(tasks: ImportedTask[]) {
    const listLabels = new Map<string, string>();
    const folderLabels = new Map<string, string>();
    tasks.forEach((task) => {
        const listId = String(task?.list?.id ?? "").trim();
        const listName = String(task?.list?.name ?? "").trim();
        const folderId = String(task?.folder?.id ?? "").trim();
        const folderName = String(task?.folder?.name ?? "").trim();
        if (listId && listName && !listLabels.has(listId)) listLabels.set(listId, listName);
        if (folderId && folderName && !folderLabels.has(folderId)) folderLabels.set(folderId, folderName);
    });
    return { listLabels, folderLabels };
}

function buildConsultantBillableCapacityMap(
    payload: CapacityGridPayload | null | undefined,
    consultantConfigRows: any[] = []
) {
    const byConsultantId = new Map<number, number>();
    consultantConfigRows.forEach((row: any) => {
        const consultantId = Number(row?.consultantId ?? 0);
        if (consultantId <= 0) return;
        byConsultantId.set(consultantId, Number(row?.billableCapacity ?? 40));
    });

    const byResourceId = new Map<string, number>();
    (Array.isArray(payload?.resources) ? payload?.resources : [])
        .filter((resource: any) => !Boolean(resource?.removed))
        .forEach((resource: any) => {
            const resourceId = String(resource?.id ?? "").trim();
            if (!resourceId) return;
            const consultantId = Number(resource?.consultantId ?? 0);
            byResourceId.set(resourceId, byConsultantId.get(consultantId) ?? 40);
        });

    return byResourceId;
}

export function computeCapacityHeaderMetrics(input: {
    payload: CapacityGridPayload | null | undefined;
    billableRollups?: any[];
    consultantConfigRows?: any[];
    tasks?: ImportedTask[];
}): CapacityHeaderMetrics {
    const payload = input.payload;
    const resources = (Array.isArray(payload?.resources) ? payload.resources : []).filter((resource: any) => !Boolean(resource?.removed));
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const billableCapacityByResourceId = buildConsultantBillableCapacityMap(payload, input.consultantConfigRows);
    const taskScopeLabels = buildTaskScopeLabels(Array.isArray(input.tasks) ? input.tasks : []);

    const totalCapacity = resources.reduce((sum, resource: any) => {
        return sum + Number(billableCapacityByResourceId.get(String(resource?.id ?? "")) ?? 40);
    }, 0);

    const planned = rows.reduce((sum: number, row: any) => {
        return sum + resources.reduce((rowSum: number, resource: any) => {
            return rowSum + Number(row?.allocations?.[resource.id]?.hours ?? 0);
        }, 0);
    }, 0);

    const wkMinTotal = rows.reduce((sum: number, row: any) => sum + Number(row?.wkMin ?? 0), 0);
    const wkMaxTotal = rows.reduce((sum: number, row: any) => sum + Number(row?.wkMax ?? 0), 0);

    const actuals = (Array.isArray(input.billableRollups) ? input.billableRollups : []).reduce((sum: number, rollup: any) => {
        const assigneeFullKey = normalizeDashboardName(String(rollup?.assignee ?? ""));
        const assigneeFirstKey = normalizeDashboardName(String(rollup?.assignee ?? "").split(/\s+/)[0] || "");
        const consultantMatch = resources.some((resource: any) => {
            const resourceFullKey = normalizeDashboardName(String(resource?.name ?? ""));
            const resourceFirstKey = normalizeDashboardName(String(resource?.name ?? "").split(/\s+/)[0] || "");
            return (
                (resourceFullKey && assigneeFullKey === resourceFullKey)
                || (resourceFirstKey && assigneeFullKey === resourceFirstKey)
                || (resourceFullKey && assigneeFirstKey === resourceFirstKey)
                || (resourceFirstKey && assigneeFirstKey === resourceFirstKey)
            );
        });
        if (!consultantMatch) return sum;

        const scopeLabels = (() => {
            const scopeType = String(rollup?.scopeType ?? "");
            const scopeId = String(rollup?.scopeId ?? "");
            if (scopeType === "list") {
                return [taskScopeLabels.listLabels.get(scopeId) ?? scopeId].filter(Boolean);
            }
            if (scopeType === "folder") {
                return [taskScopeLabels.folderLabels.get(scopeId) ?? scopeId].filter(Boolean);
            }
            return [scopeId].filter(Boolean);
        })();

        const rowMatch = rows.some((row: any) => {
            const rowClientKey = normalizeDashboardName(String(row?.client ?? ""));
            const rowIdKey = normalizeDashboardName(String(row?.id ?? ""));
            return scopeLabels.some((label) => {
                const labelKey = normalizeDashboardName(label);
                return labelKey.length > 0 && (
                    labelKey === rowClientKey
                    || labelKey === rowIdKey
                    || labelKey.includes(rowClientKey)
                    || rowClientKey.includes(labelKey)
                );
            });
        });

        if (!rowMatch) return sum;
        return sum + Number(rollup?.hours ?? 0);
    }, 0);

    return {
        totalCapacity: Number(totalCapacity.toFixed(1)),
        planned: Number(planned.toFixed(1)),
        actuals: Number(actuals.toFixed(1)),
        wkMinTotal: Number(wkMinTotal.toFixed(1)),
        wkMaxTotal: Number(wkMaxTotal.toFixed(1)),
        gapToMin: Number((planned - wkMinTotal).toFixed(1)),
    };
}
