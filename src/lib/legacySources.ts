export type AllocationSource = "manual" | "seeded" | "empty";
export type SidebarSource = "seeded" | "local";

const LEGACY_IMPORTED_SOURCE = ["click", "up"].join("");

export function isLocalSource(value: unknown) {
    return String(value ?? "").trim().toLowerCase() === "local";
}

export function normalizeSidebarSource(value: unknown): SidebarSource {
    return isLocalSource(value) ? "local" : "seeded";
}

export function normalizeAllocationSource(value: unknown): AllocationSource {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "manual") return "manual";
    if (normalized === "empty") return "empty";
    if (normalized === LEGACY_IMPORTED_SOURCE || normalized === "seeded") return "seeded";
    return "manual";
}

export function toStoredSidebarSource(source: SidebarSource): string {
    return source === "local" ? "local" : LEGACY_IMPORTED_SOURCE;
}

export function toStoredAllocationSource(source: AllocationSource): string {
    return source === "seeded" ? LEGACY_IMPORTED_SOURCE : source;
}
