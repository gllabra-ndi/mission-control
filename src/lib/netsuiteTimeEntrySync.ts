import "server-only";

import { prisma } from "@/lib/prisma";
import {
    createNetSuiteTimeEntry,
    updateNetSuiteTimeEntry,
    type NetSuiteCreateTimeEntryInput,
    type NetSuiteUpdateTimeEntryInput,
} from "@/lib/netsuite";
import { getDefaultNetSuiteMappingForClientDirectoryName } from "@/lib/netsuiteClientMappingDefaults";

// ---------------------------------------------------------------------------
// Kill switch
// ---------------------------------------------------------------------------

export function isTimeEntrySyncEnabled(): boolean {
    return process.env.NETSUITE_TIME_SYNC_ENABLED === "true";
}

// ---------------------------------------------------------------------------
// Error sanitization — strip URLs and cap length for safe persistence
// ---------------------------------------------------------------------------

function stripUrlsAndCap(raw: string): string {
    return raw.replace(/https?:\/\/[^\s]+/g, "[url]").slice(0, 500);
}

// ---------------------------------------------------------------------------
// Employee resolver — maps an assignee string to a Consultant email
// ---------------------------------------------------------------------------

export async function resolveConsultantEmailForAssignee(
    assignee: string
): Promise<string | null> {
    const trimmed = String(assignee || "").trim();
    if (!trimmed) return null;

    const consultantModel = (prisma as any).consultant;
    if (!consultantModel) return null;

    // 1. Exact email match
    try {
        const byEmail = await consultantModel.findFirst({
            where: { email: trimmed.toLowerCase() },
            orderBy: { id: "asc" },
        });
        if (byEmail) return String(byEmail.email);
    } catch {
        // continue to next strategy
    }

    // 2. First + last name exact match (only if assignee contains a space)
    if (trimmed.includes(" ")) {
        try {
            const parts = trimmed.split(/\s+/);
            const firstName = parts.slice(0, -1).join(" ");
            const lastName = parts[parts.length - 1];
            const byName = await consultantModel.findFirst({
                where: {
                    firstName: { equals: firstName, mode: "insensitive" },
                    lastName: { equals: lastName, mode: "insensitive" },
                },
                orderBy: { id: "asc" },
            });
            if (byName) return String(byName.email);
        } catch {
            // continue to next strategy
        }
    }

    // 3. Email prefix match — "Scott Lee" matches "scott.lee@..."
    if (trimmed.includes(" ")) {
        try {
            const parts = trimmed.toLowerCase().split(/\s+/);
            const allConsultants = await consultantModel.findMany({
                select: { email: true },
                orderBy: { id: "asc" },
            });
            for (const c of allConsultants) {
                const email = String(c.email || "").toLowerCase();
                const prefix = email.split("@")[0] || "";
                // Match "scott.lee" against assignee "Scott Lee"
                const prefixParts = prefix.split(/[._-]/);
                if (prefixParts.length >= 2 && parts.length >= 2) {
                    if (prefixParts[0] === parts[0] && prefixParts[1] === parts[parts.length - 1]) {
                        return email;
                    }
                }
            }
        } catch {
            // continue to next strategy
        }
    }

    // 4. firstName match + lastName startsWith (handles "Lee" vs "Lee New")
    if (trimmed.includes(" ")) {
        try {
            const parts = trimmed.split(/\s+/);
            const firstName = parts.slice(0, -1).join(" ");
            const lastName = parts[parts.length - 1];
            const byPartialLast = await consultantModel.findFirst({
                where: {
                    firstName: { equals: firstName, mode: "insensitive" },
                    lastName: { startsWith: lastName, mode: "insensitive" },
                },
                orderBy: { id: "asc" },
            });
            if (byPartialLast) return String(byPartialLast.email);
        } catch {
            // continue to next strategy
        }
    }

    // 5. External ID match
    try {
        const byExternalId = await consultantModel.findFirst({
            where: { externalId: trimmed },
            orderBy: { id: "asc" },
        });
        if (byExternalId) return String(byExternalId.email);
    } catch {
        // continue — return null below
    }

    // 6. Single-token names: DO NOT fuzzy-match. Return null to surface ambiguity.
    return null;
}

// ---------------------------------------------------------------------------
// Customer resolver — maps a task's scope to a NetSuite project internal ID
// ---------------------------------------------------------------------------

async function resolveNetSuiteProjectId(clientId: string): Promise<number | null> {
    const clientModel = (prisma as any).clientDirectory;
    if (!clientModel) return null;
    try {
        const client = await clientModel.findUnique({
            where: { id: clientId },
            select: { netsuiteProjectId: true, name: true },
        });
        const raw = String(client?.netsuiteProjectId || "").trim();
        const fromDb = (value: string) => {
            const parsed = Number(value);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        };
        if (raw) {
            return fromDb(raw);
        }
        const fallback = getDefaultNetSuiteMappingForClientDirectoryName(String(client?.name || ""));
        const fallbackRaw = String(fallback?.netsuiteProjectId || "").trim();
        if (!fallbackRaw) return null;
        return fromDb(fallbackRaw);
    } catch {
        return null;
    }
}

async function resolveCustomerForTask(task: {
    scopeType?: string;
    scopeId?: string;
}): Promise<number | null> {
    if (!task) return null;
    const scopeType = String(task.scopeType || "").trim();
    const scopeId = String(task.scopeId || "").trim();
    if (!scopeId) return null;

    // Direct client scope — scopeId IS the ClientDirectory.id
    if (scopeType === "client") {
        return resolveNetSuiteProjectId(scopeId);
    }

    // List or folder scope — resolve via TaskSidebarBoardPlacement
    if (scopeType === "list" || scopeType === "folder") {
        const placementModel = (prisma as any).taskSidebarBoardPlacement;
        if (!placementModel) return null;
        try {
            const placement = await placementModel.findFirst({
                where: { boardId: scopeId },
                select: { clientId: true },
                orderBy: { orderIndex: "asc" },
            });
            const clientId = String(placement?.clientId || "").trim();
            if (!clientId) return null;
            return resolveNetSuiteProjectId(clientId);
        } catch {
            return null;
        }
    }

    return null;
}

// ---------------------------------------------------------------------------
// Service item resolver — AI vs standard based on task flag
// ---------------------------------------------------------------------------

function resolveServiceItemForTask(task: { isAi?: boolean }): number {
    const aiItem = Number(process.env.NETSUITE_AI_SERVICE_ITEM || "124");
    const defaultItem = Number(
        process.env.NETSUITE_DEFAULT_SERVICE_ITEM || "17"
    );
    return task?.isAi ? aiItem : defaultItem;
}

// ---------------------------------------------------------------------------
// Sync result types
// ---------------------------------------------------------------------------

export interface TimeEntrySyncResult {
    success: boolean;
    dryRun?: boolean;
    error?: string;
    netsuiteId?: string;
}

// ---------------------------------------------------------------------------
// Core sync function
// ---------------------------------------------------------------------------

export async function syncTimeEntryToNetSuite(
    entryId: string,
    mode: "create" | "update"
): Promise<TimeEntrySyncResult> {
    const taskBillableEntryModel = (prisma as any).taskBillableEntry;
    const editableTaskModel = (prisma as any).editableTask;

    // Kill switch — dry-run when disabled (works even without NS env vars)
    if (!isTimeEntrySyncEnabled()) {
        console.info(
            "[netsuite:time-entry:dry-run]",
            JSON.stringify({ entryId, mode })
        );
        return { dryRun: true, success: true };
    }

    try {
        if (!taskBillableEntryModel || !editableTaskModel) {
            return { success: false, error: "prisma_models_unavailable" };
        }

        // Fresh read — race-safety critical
        const entry = await taskBillableEntryModel.findUnique({
            where: { id: String(entryId) },
        });
        if (!entry) {
            return { success: false, error: "entry_not_found" };
        }

        // Read related task for assignee
        const task = await editableTaskModel.findUnique({
            where: { id: String(entry.taskId) },
        });
        if (!task) {
            return { success: false, error: "task_not_found" };
        }

        // Resolve employee
        const employeeEmail = await resolveConsultantEmailForAssignee(
            String(task.assignee || "")
        );
        if (!employeeEmail) {
            // Mark as failed so it can be retried after consultant mapping is fixed
            await taskBillableEntryModel.update({
                where: { id: String(entryId) },
                data: {
                    nsSyncStatus: "failed",
                    nsSyncError: "employee_not_resolved",
                },
            });
            return { success: false, error: "employee_not_resolved" };
        }

        // Resolve customer (NetSuite project internal ID) from task scope
        const customer = await resolveCustomerForTask(task);
        if (!customer) {
            // Block sync — time bills require a customer. Mark failed with clear reason.
            await taskBillableEntryModel.update({
                where: { id: String(entryId) },
                data: {
                    nsSyncStatus: "failed",
                    nsSyncError: "no_client_mapping",
                },
            });
            return { success: false, error: "no_client_mapping" };
        }

        // Resolve service item (AI vs default based on task flag)
        const item = resolveServiceItemForTask(task);

        const hours = Number(entry.hours ?? 0);
        const entryDate = String(entry.entryDate || "");
        const memo = String(entry.note || "");
        const taskAllowsBillable = task.isBillable === undefined ? true : Boolean(task.isBillable);
        const isBillable = taskAllowsBillable && !Boolean(entry.isValueAdd);
        const externalId = String(entry.id);

        if (mode === "create") {
            const input: NetSuiteCreateTimeEntryInput = {
                externalId,
                hours,
                date: entryDate,
                memo,
                isBillable,
                employeeEmail,
                customer,
                item,
            };

            const result = await createNetSuiteTimeEntry(input);

            if (result.ok && result.data) {
                await taskBillableEntryModel.update({
                    where: { id: String(entryId) },
                    data: {
                        netsuiteId: String(result.data.timeBillId),
                        nsSyncStatus: "synced",
                        nsSyncedAt: new Date(),
                        nsSyncError: null,
                    },
                });
                return {
                    success: true,
                    netsuiteId: String(result.data.timeBillId),
                };
            }

            // Failure path
            const errorMsg = stripUrlsAndCap(
                String(result.error || result.message || "unknown_create_error")
            );
            await taskBillableEntryModel.update({
                where: { id: String(entryId) },
                data: {
                    nsSyncStatus: "failed",
                    nsSyncError: errorMsg,
                },
            });
            return { success: false, error: errorMsg };
        }

        // mode === "update"
        const updateInput: NetSuiteUpdateTimeEntryInput = {
            externalId,
            hours,
            date: entryDate,
            memo,
            isBillable,
            customer,
            item,
        };

        const result = await updateNetSuiteTimeEntry(updateInput);

        if (result.ok && result.data) {
            await taskBillableEntryModel.update({
                where: { id: String(entryId) },
                data: {
                    netsuiteId: String(result.data.timeBillId),
                    nsSyncStatus: "synced",
                    nsSyncedAt: new Date(),
                    nsSyncError: null,
                },
            });
            return {
                success: true,
                netsuiteId: String(result.data.timeBillId),
            };
        }

        const errorMsg = stripUrlsAndCap(
            String(result.error || result.message || "unknown_update_error")
        );
        await taskBillableEntryModel.update({
            where: { id: String(entryId) },
            data: {
                nsSyncStatus: "failed",
                nsSyncError: errorMsg,
            },
        });
        return { success: false, error: errorMsg };
    } catch (err: any) {
        const safeMsg = stripUrlsAndCap(
            String(err?.message || "unknown_sync_error")
        );
        console.info(
            "[netsuite:time-entry:sync-error]",
            entryId,
            safeMsg
        );

        // Best-effort status update — don't let this throw either
        try {
            if (taskBillableEntryModel) {
                await taskBillableEntryModel.update({
                    where: { id: String(entryId) },
                    data: {
                        nsSyncStatus: "failed",
                        nsSyncError: safeMsg,
                    },
                });
            }
        } catch {
            // swallow — outer catch already logged
        }

        return { success: false, error: safeMsg };
    }
}
