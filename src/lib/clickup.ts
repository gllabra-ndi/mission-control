const API_KEY = process.env.CLICKUP_API_KEY!;
const TEAM_ID = process.env.CLICKUP_TEAM_ID;
const BASE_URL = "https://api.clickup.com/api/v2";
export const PROFESSIONAL_SERVICES_SPACE_ID = "90171692986";

const headers = {
    Authorization: API_KEY,
    "Content-Type": "application/json",
};

export interface ClickUpTask {
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

export interface ClickUpListHierarchy {
    id: string;
    name: string;
    statusOrder: string[];
}

export interface ClickUpFolderHierarchy {
    id: string;
    name: string;
    lists: ClickUpListHierarchy[];
}

export interface ClickUpTeamMember {
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
    duration: number; // in milliseconds
    start: string;
    end: string;
}

function splitName(name: string) {
    const trimmed = String(name || "").trim();
    if (!trimmed) {
        return { firstName: "", lastName: "" };
    }
    const parts = trimmed.split(/\s+/).filter(Boolean);
    return {
        firstName: parts[0] ?? "",
        lastName: parts.slice(1).join(" "),
    };
}

function parseTeamMembers(payload: any): ClickUpTeamMember[] {
    const candidateArrays = [
        Array.isArray(payload?.members) ? payload.members : [],
        Array.isArray(payload?.team?.members) ? payload.team.members : [],
        ...(Array.isArray(payload?.teams)
            ? payload.teams.map((team: any) => (Array.isArray(team?.members) ? team.members : []))
            : []),
    ];

    const byId = new Map<number, ClickUpTeamMember>();

    candidateArrays.flat().forEach((member: any) => {
        const user = member?.user ?? member;
        const id = Number(user?.id ?? member?.id ?? 0);
        if (!Number.isFinite(id) || id <= 0) return;

        const username = String(user?.username ?? member?.username ?? user?.name ?? member?.name ?? "").trim();
        const email = String(user?.email ?? member?.email ?? "").trim().toLowerCase();
        const firstName = String(user?.first_name ?? member?.first_name ?? user?.firstName ?? member?.firstName ?? "").trim();
        const lastName = String(user?.last_name ?? member?.last_name ?? user?.lastName ?? member?.lastName ?? "").trim();
        const fallbackName = splitName(username);

        byId.set(id, {
            id,
            username,
            email,
            firstName: firstName || fallbackName.firstName,
            lastName: lastName || fallbackName.lastName,
            color: String(user?.color ?? member?.color ?? "").trim() || undefined,
        });
    });

    return Array.from(byId.values()).sort((a, b) => a.username.localeCompare(b.username));
}

// Ensure the API token exists before making calls
function fetchWithAuth(endpoint: string) {
    if (!API_KEY) {
        console.warn("CLICKUP_API_KEY is not defined in the environment.");
        return Promise.resolve({ data: null, error: "Missing API Key" });
    }
    return fetch(`${BASE_URL}${endpoint}`, { headers, next: { revalidate: 60 } })
        .then((res) => {
            if (!res.ok) throw new Error(`ClickUp API Error: ${res.statusText}`);
            return res.json();
        })
        .catch((err) => ({ data: null, error: err.message }));
}

// Fetch all spaces for a team
export async function getSpaces() {
    if (!TEAM_ID) return { data: null, error: "Missing Team ID" };
    const res = await fetchWithAuth(`/team/${TEAM_ID}/space`);
    return res.spaces || [];
}

function normalizeStatusOrder(statuses: any[] | undefined): string[] {
    if (!Array.isArray(statuses)) return [];
    return statuses
        .slice()
        .sort((a, b) => Number(a?.orderindex ?? 0) - Number(b?.orderindex ?? 0))
        .map((s) => String(s?.status ?? "").trim())
        .filter(Boolean);
}

export async function getSpaceFoldersWithLists(spaceId: string, excludedFolderIds: string[] = []) {
    const res = await fetchWithAuth(`/space/${spaceId}/folder?archived=false`);
    if (res.error || !Array.isArray(res.folders)) return [] as ClickUpFolderHierarchy[];
    const shouldExcludeList = (name: string) => /user\s*guide/i.test(name);

    return res.folders
        .filter((folder: any) => !excludedFolderIds.includes(String(folder?.id ?? "")))
        .map((folder: any) => ({
            id: String(folder.id),
            name: String(folder.name ?? ""),
            lists: Array.isArray(folder.lists)
                ? folder.lists
                    .filter((list: any) => !shouldExcludeList(String(list?.name ?? "")))
                    .map((list: any) => ({
                        id: String(list.id),
                        name: String(list.name ?? ""),
                        statusOrder: normalizeStatusOrder(list.statuses)
                    }))
                : []
        }))
        .filter((folder: ClickUpFolderHierarchy) => folder.lists.length > 0);
}

// Fetch all tasks for a specific team with pagination to grab everything
export async function getTeamTasks(filters?: { textSearch?: string; assigneeName?: string; status?: string; spaceIds?: string[]; daysBack?: number }) {
    if (!TEAM_ID) return [];

    let allTasks: ClickUpTask[] = [];

    const trimTask = (t: any): ClickUpTask => ({
        id: String(t.id),
        name: String(t.name),
        status: { 
            status: String(t.status?.status || ""), 
            color: String(t.status?.color || ""), 
            type: String(t.status?.type || "") 
        },
        date_created: String(t.date_created || ""),
        date_updated: String(t.date_updated || ""),
        date_closed: t.date_closed ? String(t.date_closed) : null,
        due_date: t.due_date ? String(t.due_date) : null,
        start_date: t.start_date ? String(t.start_date) : null,
        assignees: (t.assignees || []).map((a: any) => ({ 
            id: Number(a.id), 
            username: String(a.username || ""), 
            color: String(a.color || "") 
        })),
        time_estimate: t.time_estimate ? Number(t.time_estimate) : null,
        time_spent: t.time_spent ? Number(t.time_spent) : null,
        list: { id: String(t.list?.id || ""), name: String(t.list?.name || "") },
        project: { id: String(t.project?.id || ""), name: String(t.project?.name || "") },
        folder: { id: String(t.folder?.id || ""), name: String(t.folder?.name || "") },
        space: { id: String(t.space?.id || "") }
    });

    try {
        const spaceIdsParam = filters?.spaceIds && filters.spaceIds.length > 0 
            ? filters.spaceIds.map(id => `space_ids[]=${id}`).join('&')
            : `space_ids[]=${PROFESSIONAL_SERVICES_SPACE_ID}`;
        
        const daysBack = filters?.daysBack ?? 60;
        const dateUpdatedGt = Date.now() - (daysBack * 24 * 60 * 60 * 1000);

        // Speculatively fetch the first 20 pages in parallel to significantly reduce load time
        const maxPages = 20;
        const pagePromises = Array.from({ length: maxPages }).map((_, i) =>
            fetchWithAuth(`/team/${TEAM_ID}/task?${spaceIdsParam}&page=${i}&subtasks=true&include_closed=true&date_updated_gt=${dateUpdatedGt}`)
        );
        const results = await Promise.all(pagePromises);

        for (const res of results) {
            if (res.error || !res.tasks) {
                break;
            }
            const currentTasks = res.tasks as any[];
            if (currentTasks.length > 0) {
                allTasks = [...allTasks, ...currentTasks.map(trimTask)];
            }
            if (currentTasks.length < 100) {
                // We reached the end of the tasks
                break;
            }
        }

        // If we exactly hit 100 tasks on the 20th page, there might be more. Fetch the rest sequentially.
        let page = maxPages;
        let lastBatchLength = results[maxPages - 1]?.tasks?.length || 0;
        while (lastBatchLength === 100) {
            const res = await fetchWithAuth(`/team/${TEAM_ID}/task?${spaceIdsParam}&page=${page}&subtasks=true&include_closed=true&date_updated_gt=${dateUpdatedGt}`);
            if (res.error || !res.tasks) break;
            
            const currentTasks = res.tasks as any[];
            if (currentTasks.length > 0) {
                allTasks = [...allTasks, ...currentTasks.map(trimTask)];
            }
            lastBatchLength = currentTasks.length;
            page++;
        }
    } catch (err) {
        console.error("Pagination error:", err);
    }

    let tasks = allTasks;

    // Manual fallback filtering for our basic Chat NLP (Legacy from Chatbot)
    if (filters && Array.isArray(tasks)) {
        if (filters.textSearch) {
            const q = filters.textSearch.toLowerCase();
            tasks = tasks.filter((t) =>
                t.name.toLowerCase().includes(q) ||
                t.status.status.toLowerCase().includes(q) ||
                t.assignees?.some(a => a.username.toLowerCase().includes(q))
            );
        }
        if (filters.assigneeName) {
            const assigneeQuery = filters.assigneeName.toLowerCase();
            tasks = tasks.filter(t => t.assignees?.some(a => a.username.toLowerCase().includes(assigneeQuery)));
        }
        if (filters.status) {
            const statusQuery = filters.status.toLowerCase();
            tasks = tasks.filter(t => t.status.type.toLowerCase() === statusQuery || t.status.status.toLowerCase() === statusQuery);
        }
    }

    return tasks;
}

// Fetch time entries for the team within a specific date range
export async function getTeamTimeEntries(startDateMs: number, endDateMs: number) {
    if (!TEAM_ID) return [];

    // ClickUp API accepts start_date and end_date in milliseconds
    const res = await fetchWithAuth(`/team/${TEAM_ID}/time_entries?start_date=${startDateMs}&end_date=${endDateMs}`);

    // ClickUp returns time entries in a `data` array
    return (res.data as TimeEntry[]) || [];
}

export async function getTeamMembers(): Promise<ClickUpTeamMember[]> {
    if (!TEAM_ID) return [];

    const directTeam = await fetchWithAuth(`/team/${TEAM_ID}`);
    const directMembers = parseTeamMembers(directTeam);
    if (directMembers.length > 0) {
        return directMembers;
    }

    const allTeams = await fetchWithAuth("/team");
    const nestedMembers = parseTeamMembers(allTeams);
    if (nestedMembers.length > 0) {
        return nestedMembers;
    }

    return [];
}

// Calculate high level metrics
export function calculateOverview(tasks: ClickUpTask[]): WorkspaceOverview {
    let completedTasks = 0;
    let totalTimeEstimate = 0;
    let totalTimeSpent = 0;

    tasks.forEach((task) => {
        if (task.status.type === "closed" || task.status.status === "complete") {
            completedTasks++;
        }
        if (task.time_estimate) totalTimeEstimate += task.time_estimate;
        if (task.time_spent) totalTimeSpent += task.time_spent;
    });

    return {
        totalTasks: tasks.length,
        completedTasks,
        totalTimeEstimate,
        totalTimeSpent,
    };
}

// Group tasks by status for Kanban view
export function groupTasksByStatus(tasks: ClickUpTask[]) {
    const groups: Record<string, ClickUpTask[]> = {};
    tasks.forEach((task) => {
        const key = task.status?.status?.trim() || "Uncategorized";

        if (!groups[key]) groups[key] = [];
        groups[key].push(task);
    });
    return groups;
}
