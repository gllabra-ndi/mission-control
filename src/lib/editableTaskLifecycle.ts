import { format, startOfWeek } from "date-fns";
import type { ClickUpTask } from "@/lib/clickup";

export type EditableTaskStatus = "backlog" | "open" | "closed";

export type EditableTaskLifecycleInput = {
    week?: string | null;
    plannedWeek?: string | null;
    closedDate?: string | null;
    status?: string | null;
    estimateHours?: number | string | null;
};

export type EditableTaskWeekVisibility = {
    week?: string | null;
    plannedWeek?: string | null;
    closedDate?: string | null;
    status?: string | null;
};

export type EditableTaskSeedShape = {
    sourceTaskId: string;
    subject: string;
    description: string;
    assignee: string;
    week: string;
    plannedWeek: string;
    closedDate: string;
    estimateHours: number;
    status: EditableTaskStatus;
};

export function normalizeEditableTaskStatus(value: string): EditableTaskStatus {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "closed") return "closed";
    if (normalized === "open") return "open";
    return "backlog";
}

export function normalizeWeekKey(value: string | null | undefined) {
    return String(value || "").trim();
}

export function normalizeDateKey(value: string | null | undefined) {
    const normalized = String(value || "").trim();
    if (!normalized) return "";
    return normalized.slice(0, 10);
}

export function toValidDate(rawValue: string | number | null | undefined): Date | null {
    const raw = Number(rawValue ?? 0);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toWeekStartStr(date: Date): string {
    return format(startOfWeek(date, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

export function getWeekStartKeyForDate(value: string | null | undefined) {
    const normalized = normalizeDateKey(value);
    if (!normalized) return "";
    const parsed = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return "";
    return toWeekStartStr(parsed);
}

export function normalizeEstimateHours(value: number | string | null | undefined) {
    const normalized = Number(value ?? 0);
    if (!Number.isFinite(normalized)) return 0;
    return Number(Math.max(0, normalized).toFixed(2));
}

export function normalizeEditableTaskLifecycle(input: EditableTaskLifecycleInput) {
    const week = normalizeWeekKey(input.week);
    let plannedWeek = normalizeWeekKey(input.plannedWeek);
    let closedDate = normalizeDateKey(input.closedDate);
    let status = normalizeEditableTaskStatus(String(input.status ?? "backlog"));

    if (week && plannedWeek && plannedWeek < week) {
        plannedWeek = week;
    }

    if (week && closedDate && closedDate < week) {
        closedDate = week;
    }

    if (closedDate) {
        status = "closed";
    } else if (!plannedWeek) {
        status = "backlog";
    }

    return {
        week,
        plannedWeek,
        closedDate,
        status,
        estimateHours: normalizeEstimateHours(input.estimateHours),
    };
}

export function isEditableTaskVisibleInWeek(
    task: Pick<EditableTaskWeekVisibility, "week" | "closedDate">,
    activeWeek?: string | null
) {
    const targetWeek = normalizeWeekKey(activeWeek);
    if (!targetWeek) return true;

    const createdWeek = normalizeWeekKey(task?.week);
    if (createdWeek && createdWeek > targetWeek) return false;

    const closedWeek = getWeekStartKeyForDate(task?.closedDate);
    if (closedWeek && targetWeek > closedWeek) return false;

    return true;
}

export function getEffectiveEditableTaskStatus(
    task: EditableTaskWeekVisibility,
    activeWeek?: string | null
): EditableTaskStatus {
    const storedStatus = normalizeEditableTaskStatus(String(task?.status ?? "backlog"));
    const targetWeek = normalizeWeekKey(activeWeek);
    if (!targetWeek) return storedStatus;
    if (!isEditableTaskVisibleInWeek(task, targetWeek)) return storedStatus;

    const closedWeek = getWeekStartKeyForDate(task?.closedDate);
    if (closedWeek && targetWeek === closedWeek) {
        return "closed";
    }

    const plannedWeek = normalizeWeekKey(task?.plannedWeek);
    if (plannedWeek && targetWeek >= plannedWeek) {
        return "open";
    }

    return "backlog";
}

export function normalizeEditableStatusFromClickUp(task: ClickUpTask): EditableTaskStatus {
    const statusText = String(task?.status?.status ?? "").toLowerCase();
    const statusType = String(task?.status?.type ?? "").toLowerCase();
    if (statusType === "closed" || /(complete|completed|done|closed|resolved|shipped)/.test(statusText)) return "closed";
    if (/(backlog|not started|todo|to do|new|queued|queue|planned|plan|pending)/.test(statusText)) return "backlog";
    return "open";
}

export function getTaskCreatedWeekStr(task: ClickUpTask, activeWeekStr: string): string {
    const createdDate = toValidDate(task?.date_created);
    if (createdDate) return toWeekStartStr(createdDate);
    return activeWeekStr;
}

export function getTaskClosedDateStr(task: ClickUpTask): string {
    const closedDate = toValidDate(task?.date_closed);
    return closedDate ? format(closedDate, "yyyy-MM-dd") : "";
}

export function getTaskPlannedWeekStr(task: ClickUpTask, activeWeekStr: string): string {
    const startDate = toValidDate(task?.start_date);
    const dueDate = toValidDate(task?.due_date);
    const status = normalizeEditableStatusFromClickUp(task);
    const createdWeek = getTaskCreatedWeekStr(task, activeWeekStr);

    if (startDate && dueDate) {
        return toWeekStartStr(startDate <= dueDate ? startDate : dueDate);
    }

    if (startDate) return toWeekStartStr(startDate);
    if (dueDate) return toWeekStartStr(dueDate);
    if (status === "open" || status === "closed") return createdWeek;
    return "";
}

export function buildEditableTaskSeedFromClickUp(task: ClickUpTask, activeWeekStr: string): EditableTaskSeedShape {
    const createdWeek = getTaskCreatedWeekStr(task, activeWeekStr);
    return {
        sourceTaskId: String(task.id),
        subject: String(task.name ?? "Untitled Task"),
        description: "",
        assignee: Array.isArray(task.assignees) && task.assignees.length > 0
            ? String(task.assignees[0]?.username ?? "")
            : "",
        week: createdWeek,
        plannedWeek: getTaskPlannedWeekStr(task, activeWeekStr),
        closedDate: getTaskClosedDateStr(task),
        estimateHours: Number(((Number(task.time_estimate ?? 0) || 0) / (1000 * 60 * 60)).toFixed(2)),
        status: normalizeEditableStatusFromClickUp(task),
    };
}
