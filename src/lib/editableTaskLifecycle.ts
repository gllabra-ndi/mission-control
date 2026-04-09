import { format, startOfWeek } from "date-fns";
import type { ClickUpTask } from "@/lib/clickup";

type EditableTaskStatus = "backlog" | "open" | "closed";

function isIsoDateKey(value: string) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseDateInput(value: unknown): Date | null {
    if (!value) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "number") {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const str = String(value).trim();
    if (!str) return null;

    if (/^\d+$/.test(str)) {
        const asNum = Number(str);
        if (!Number.isFinite(asNum)) return null;
        const d = new Date(asNum);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    if (isIsoDateKey(str)) {
        const d = new Date(`${str}T00:00:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    const parsed = new Date(str);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeDateKey(value: unknown): string {
    const date = parseDateInput(value);
    if (!date) return "";
    return format(date, "yyyy-MM-dd");
}

export function getWeekStartKeyForDate(value: unknown): string {
    const date = parseDateInput(value);
    if (!date) return "";
    return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export function normalizeWeekKey(value: unknown): string {
    const key = normalizeDateKey(value);
    if (!key) return "";
    return getWeekStartKeyForDate(key);
}

export function normalizeEstimateHours(value: unknown): number {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric)) return 0;
    return Number(Math.max(0, numeric).toFixed(2));
}

export function normalizeEditableTaskStatus(value: unknown): EditableTaskStatus {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "open" || normalized === "closed" || normalized === "backlog") {
        return normalized;
    }
    return "backlog";
}

export function normalizeEditableTaskLifecycle(input: {
    week?: unknown;
    plannedWeek?: unknown;
    closedDate?: unknown;
    status?: unknown;
    estimateHours?: unknown;
    [key: string]: unknown;
}) {
    const week = normalizeWeekKey(input.week);
    const plannedWeek = normalizeWeekKey(input.plannedWeek);
    const closedDate = normalizeDateKey(input.closedDate);
    const status = normalizeEditableTaskStatus(input.status);
    const estimateHours = normalizeEstimateHours(input.estimateHours);
    return { week, plannedWeek, closedDate, status, estimateHours };
}

export function getEffectiveEditableTaskStatus(
    row: { week?: unknown; plannedWeek?: unknown; closedDate?: unknown; status?: unknown },
    activeWeek?: string
): EditableTaskStatus {
    const closedDate = normalizeDateKey(row.closedDate);
    if (closedDate) return "closed";

    const plannedWeek = normalizeWeekKey(row.plannedWeek);
    const active = normalizeWeekKey(activeWeek);
    if (plannedWeek && active && plannedWeek <= active) return "open";
    if (plannedWeek && active && plannedWeek > active) return "backlog";

    return normalizeEditableTaskStatus(row.status);
}

export function isEditableTaskVisibleInWeek(
    task: { week?: unknown; closedDate?: unknown },
    activeWeek: string
) {
    const active = normalizeWeekKey(activeWeek);
    if (!active) return false;

    const createdWeek = normalizeWeekKey(task.week);
    if (createdWeek && createdWeek > active) return false;

    const closedDate = normalizeDateKey(task.closedDate);
    if (!closedDate) return true;
    return closedDate >= active;
}

export function buildEditableTaskSeedFromClickUp(
    task: ClickUpTask,
    activeWeekStr: string
): {
    sourceTaskId: string;
    subject: string;
    description: string;
    assignee: string;
    isAi: boolean;
    estimateHours: number;
    billableHoursToday: number;
    week: string;
    plannedWeek: string;
    closedDate: string;
    status: EditableTaskStatus;
} {
    const sourceTaskId = String(task?.id ?? "").trim();
    const week = normalizeWeekKey(activeWeekStr) || getWeekStartKeyForDate(new Date());

    const closedDate = normalizeDateKey(task?.date_closed);
    const estimateHours = normalizeEstimateHours(Number(task?.time_estimate ?? 0) / (1000 * 60 * 60));
    const assignee = Array.isArray(task?.assignees) && task.assignees[0]
        ? String(task.assignees[0]?.username ?? "").trim()
        : "";

    const status: EditableTaskStatus = closedDate ? "closed" : "backlog";

    return {
        sourceTaskId,
        subject: String(task?.name ?? "").trim() || "Untitled Task",
        description: "",
        assignee,
        isAi: false,
        estimateHours,
        billableHoursToday: 0,
        week,
        plannedWeek: "",
        closedDate,
        status,
    };
}

