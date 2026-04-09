export const PRIMARY_WORKSPACE_ID = "90171692986";
export const IMPORTED_DATA_BRIDGE_ENABLED = false;

export interface ImportedTask {
    id: string;
    name: string;
    description?: string;
    status: { status: string; color: string; type: string };
    date_created: string;
    date_updated: string;
    date_closed: string | null;
    due_date: string | null;
    start_date: string | null;
    assignees: Array<{ id: number; username: string; color: string }>;
    time_estimate: number | null;
    time_spent: number | null;
    list: { id: string; name: string };
    project: { id: string; name: string };
    folder: { id: string; name: string };
    space: { id: string };
}

export interface WorkspaceOverview {
    totalTasks: number;
    completedTasks: number;
    totalTimeEstimate: number;
    totalTimeSpent: number;
}

export interface ImportedListHierarchy {
    id: string;
    name: string;
    statusOrder: string[];
}

export interface ImportedFolderHierarchy {
    id: string;
    name: string;
    lists: ImportedListHierarchy[];
}

export interface ImportedWorkspaceMember {
    id: number;
    username: string;
    email: string;
    firstName: string;
    lastName: string;
    color?: string;
}

export interface TimeEntry {
    id: string;
    task: { id: string; name: string };
    user: { id: number; username: string };
    duration: number;
    start: string;
    end: string;
}

export async function getSpaces() {
    return [];
}

export async function getWorkspaceFoldersWithLists(_workspaceId: string, _excludedFolderIds: string[] = []) {
    return [] as ImportedFolderHierarchy[];
}

export async function getImportedTasks(_filters?: {
    textSearch?: string;
    assigneeName?: string;
    status?: string;
    workspaceIds?: string[];
    daysBack?: number;
}) {
    return [] as ImportedTask[];
}

export async function getImportedTimeEntries(_startDate: number, _endDate: number) {
    return [] as TimeEntry[];
}

export async function getWorkspaceMembers(): Promise<ImportedWorkspaceMember[]> {
    return [];
}

export function calculateOverview(tasks: ImportedTask[]): WorkspaceOverview {
    return {
        totalTasks: tasks.length,
        completedTasks: tasks.filter((task) => String(task?.status?.type ?? "").toLowerCase() === "closed").length,
        totalTimeEstimate: Number(
            tasks.reduce((sum, task) => sum + ((Number(task?.time_estimate ?? 0) || 0) / (1000 * 60 * 60)), 0).toFixed(1)
        ),
        totalTimeSpent: Number(
            tasks.reduce((sum, task) => sum + ((Number(task?.time_spent ?? 0) || 0) / (1000 * 60 * 60)), 0).toFixed(1)
        ),
    };
}

export function groupTasksByStatus(tasks: ImportedTask[]) {
    const groups: Record<string, ImportedTask[]> = {};
    tasks.forEach((task) => {
        const status = String(task?.status?.status ?? "Unknown");
        if (!groups[status]) groups[status] = [];
        groups[status].push(task);
    });
    return groups;
}
