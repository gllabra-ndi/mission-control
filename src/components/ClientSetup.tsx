"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Mail, Plus, Save, Trash2, Users, X } from "lucide-react";
import {
    deleteClientDirectoryEntry,
    saveClientDirectoryEntry,
    type ClientDirectoryContact,
    type ClientDirectoryRecord,
} from "@/app/actions";
import { STANDARD_CLIENT_ROLES } from "@/lib/clientRoles";
import { cn } from "@/lib/utils";

interface ClientSetupProps {
    initialClients: ClientDirectoryRecord[];
    onClientsChange?: (nextClients: ClientDirectoryRecord[]) => void;
}

type EditableClient = ClientDirectoryRecord & {
    isNew?: boolean;
};

function toNullableNumber(value: string) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
}

export function ClientSetup({ initialClients, onClientsChange }: ClientSetupProps) {
    const router = useRouter();
    const [clients, setClients] = useState<EditableClient[]>(initialClients);
    const [isPending, startTransition] = useTransition();
    const newClientRowIdRef = useRef<string | null>(null);
    const [contactModalClientId, setContactModalClientId] = useState<string | null>(null);
    const [contactDrafts, setContactDrafts] = useState<ClientDirectoryContact[]>([]);

    const normalizeContactDraft = (contact: Partial<ClientDirectoryContact>): ClientDirectoryContact => ({
        id: contact.id || `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        firstName: String(contact.firstName || "").trim(),
        lastName: String(contact.lastName || "").trim(),
        email: String(contact.email || "").trim(),
        role: String(contact.role || STANDARD_CLIENT_ROLES[0]).trim() || STANDARD_CLIENT_ROLES[0],
    });

    const compactContactDrafts = (contacts: ClientDirectoryContact[]) => (
        contacts.map(normalizeContactDraft).filter((contact) => contact.firstName || contact.lastName || contact.email || contact.role)
    );

    useEffect(() => {
        setClients(initialClients);
    }, [initialClients]);

    const orderedClients = useMemo(
        () => [...clients].sort((a, b) => {
            if (a.isInternal !== b.isInternal) {
                return a.isInternal ? 1 : -1;
            }
            if (Number(a.sortOrder ?? 0) !== Number(b.sortOrder ?? 0)) {
                return Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0);
            }
            return a.name.localeCompare(b.name);
        }),
        [clients]
    );

    const handleFieldChange = (clientId: string, patch: Partial<EditableClient>) => {
        setClients((prev) => prev.map((client) => (
            client.id === clientId ? { ...client, ...patch } : client
        )));
    };

    const handleAddClient = () => {
        const timestamp = Date.now();
        const id = `new-${timestamp}`;
        newClientRowIdRef.current = id;
        setClients((prev) => [
            ...prev,
            {
                id,
                name: "",
                team: null,
                sa: "",
                dealType: "",
                min: null,
                max: null,
                contacts: [],
                isActive: true,
                isInternal: false,
                sortOrder: prev.length,
                isNew: true,
            },
        ]);
    };

    useEffect(() => {
        if (!newClientRowIdRef.current) return;
        const row = document.querySelector<HTMLElement>(`[data-client-row="${newClientRowIdRef.current}"]`);
        if (!row) return;
        row.scrollIntoView({ block: "center", behavior: "smooth" });
        const input = row.querySelector<HTMLInputElement>("input");
        if (input) {
            window.setTimeout(() => input.focus(), 120);
        }
        newClientRowIdRef.current = null;
    }, [clients]);

    const handleSave = (client: EditableClient) => {
        startTransition(async () => {
            const saved = await saveClientDirectoryEntry({
                id: client.isNew ? undefined : client.id,
                name: client.name,
                team: client.team,
                sa: client.sa,
                dealType: client.dealType,
                min: client.min,
                max: client.max,
                isActive: client.isActive,
                isInternal: client.isInternal,
                sortOrder: client.sortOrder,
                contacts: client.contacts || [],
            });
            if (!saved) return;
            const nextClients = clients.map((entry) => (
                entry.id === client.id ? saved : entry
            ));
            setClients(nextClients);
            if (onClientsChange) {
                onClientsChange(nextClients);
            } else {
                router.refresh();
            }
        });
    };

    const handleRemove = (client: EditableClient) => {
        if (client.isInternal) return;
        if (client.isNew) {
            setClients((prev) => prev.filter((entry) => entry.id !== client.id));
            return;
        }
        if (!window.confirm(`Remove ${client.name} from client setup?`)) return;

        startTransition(async () => {
            await deleteClientDirectoryEntry(client.id);
            const nextClients = clients.filter((entry) => entry.id !== client.id);
            setClients(nextClients);
            if (onClientsChange) {
                onClientsChange(nextClients);
            } else {
                router.refresh();
            }
        });
    };

    const activeContactClient = useMemo(() => {
        if (!contactModalClientId) return null;
        return clients.find((client) => client.id === contactModalClientId) ?? null;
    }, [clients, contactModalClientId]);

    const handleOpenContactModal = (client: EditableClient) => {
        setContactModalClientId(client.id);
        setContactDrafts(compactContactDrafts(Array.isArray(client.contacts) ? client.contacts : []));
    };

    const handleCloseContactModal = () => {
        setContactModalClientId(null);
        setContactDrafts([]);
    };

    const handleContactDraftChange = (index: number, patch: Partial<ClientDirectoryContact>) => {
        setContactDrafts((prev) => prev.map((row, rowIndex) => (
            rowIndex === index ? normalizeContactDraft({ ...row, ...patch }) : row
        )));
    };

    const handleAddContactRow = () => {
        setContactDrafts((prev) => ([
            ...prev,
            normalizeContactDraft({
                id: `contact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                firstName: "",
                lastName: "",
                email: "",
                role: STANDARD_CLIENT_ROLES[0],
            }),
        ]));
    };

    const handleRemoveContactRow = (index: number) => {
        setContactDrafts((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
    };

    const handleSaveContacts = () => {
        if (!contactModalClientId) return;

        const nextContacts = compactContactDrafts(contactDrafts);
        setClients((prev) => {
            const nextClients = prev.map((client) => (
                client.id === contactModalClientId ? { ...client, contacts: nextContacts } : client
            ));
            if (onClientsChange) {
                onClientsChange(nextClients);
            }
            return nextClients;
        });

        handleCloseContactModal();
    };

    const activeCount = orderedClients.filter((client) => client.isActive).length;
    const externalTotals = useMemo(() => {
        return orderedClients
            .filter((client) => !client.isInternal)
            .reduce((acc, client) => {
                acc.min += Number(client.min ?? 0);
                acc.max += Number(client.max ?? 0);
                return acc;
            }, { min: 0, max: 0 });
    }, [orderedClients]);

    return (
        <section className="flex flex-col gap-6">
            <div className="flex items-center justify-between gap-3 rounded-[24px] border border-border/50 bg-[linear-gradient(180deg,rgba(21,26,43,0.96)_0%,rgba(13,18,29,0.96)_100%)] px-5 py-4 shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
                <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-white/[0.04]">
                        <Building2 className="h-5 w-5 text-cyan-300" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-white">Client Setup</h2>
                        <p className="mt-1 text-xs text-text-muted">
                            Manage client metadata, active status, and the records shown across planning screens.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <span className="rounded-full border border-border/50 bg-surface/20 px-3 py-1 text-[11px] text-text-muted">
                        {activeCount} active clients
                    </span>
                    <button
                        type="button"
                        onClick={handleAddClient}
                        className="inline-flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/15 px-4 py-2 text-xs font-semibold text-white hover:bg-primary/25"
                    >
                        <Plus className="h-3.5 w-3.5" />
                        Add Client
                    </button>
                </div>
            </div>

            <div className="overflow-hidden rounded-[28px] border border-border/50 bg-[linear-gradient(180deg,rgba(18,23,36,0.94)_0%,rgba(12,16,24,0.98)_100%)] shadow-[0_24px_70px_rgba(0,0,0,0.28)]">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead className="border-b border-border/40 bg-[#111626]/90 text-left text-[11px] uppercase tracking-[0.18em] text-text-muted">
                                <tr>
                                    <th className="px-4 py-3">Client</th>
                                    <th className="px-4 py-3">Team</th>
                                    <th className="px-4 py-3">SA</th>
                                    <th className="px-4 py-3">Deal Type</th>
                                    <th className="px-4 py-3 text-right">Min</th>
                                    <th className="px-4 py-3 text-right">Max</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Internal</th>
                                    <th className="px-4 py-3">Contacts</th>
                                    <th className="px-4 py-3 text-right">Actions</th>
                                </tr>
                            </thead>
                        <tbody>
                            {orderedClients.map((client, index) => (
                                <tr data-client-row={client.id} key={client.id} className={cn("border-b border-border/30", index % 2 === 0 ? "bg-white/[0.01]" : "bg-white/[0.03]")}>
                                    <td className="px-4 py-3">
                                        <input
                                            value={client.name}
                                            onChange={(event) => handleFieldChange(client.id, { name: event.target.value })}
                                            className="w-64 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                            placeholder="Client name"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <input
                                            value={client.team ?? ""}
                                            onChange={(event) => handleFieldChange(client.id, { team: toNullableNumber(event.target.value) })}
                                            className="w-20 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                            inputMode="numeric"
                                            placeholder="1"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <input
                                            value={client.sa}
                                            onChange={(event) => handleFieldChange(client.id, { sa: event.target.value })}
                                            className="w-40 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                            placeholder="Owner"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <input
                                            value={client.dealType}
                                            onChange={(event) => handleFieldChange(client.id, { dealType: event.target.value })}
                                            className="w-40 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                            placeholder="Managed Service"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <input
                                            value={client.min ?? ""}
                                            onChange={(event) => handleFieldChange(client.id, { min: toNullableNumber(event.target.value) })}
                                            className="w-20 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-right text-sm text-white outline-none focus:border-primary"
                                            inputMode="decimal"
                                            placeholder="0"
                                        />
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <input
                                            value={client.max ?? ""}
                                            onChange={(event) => handleFieldChange(client.id, { max: toNullableNumber(event.target.value) })}
                                            className="w-20 rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-right text-sm text-white outline-none focus:border-primary"
                                            inputMode="decimal"
                                            placeholder="0"
                                        />
                                    </td>
                                    <td className="px-4 py-3">
                                        <button
                                            type="button"
                                            onClick={() => handleFieldChange(client.id, { isActive: !client.isActive })}
                                            className={cn(
                                                "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wider",
                                                client.isActive
                                                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                                                    : "border-border/60 bg-background/50 text-text-muted"
                                            )}
                                        >
                                            {client.isActive ? "Active" : "Inactive"}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3">
                                        <label className="inline-flex items-center gap-2 text-xs text-text-muted">
                                            <input
                                                type="checkbox"
                                                checked={client.isInternal}
                                                onChange={(event) => handleFieldChange(client.id, { isInternal: event.target.checked })}
                                                className="h-4 w-4 rounded border-border bg-background/60"
                                            />
                                            Internal
                                        </label>
                                    </td>
                                    <td className="px-4 py-3">
                                        <button
                                            type="button"
                                            onClick={() => handleOpenContactModal(client)}
                                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-border/60 bg-surface px-3 py-2 text-xs font-semibold text-white hover:bg-surface-hover"
                                        >
                                            <Users className="h-3.5 w-3.5" />
                                            Edit ({(client.contacts || []).length})
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleSave(client)}
                                                disabled={isPending || !client.name.trim()}
                                                className="inline-flex items-center gap-2 rounded-xl border border-border/60 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.08] disabled:opacity-60"
                                            >
                                                <Save className="h-3.5 w-3.5" />
                                                Save
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRemove(client)}
                                                disabled={isPending || client.isInternal}
                                                className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                                Remove
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {orderedClients.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="px-6 py-10 text-center text-sm text-text-muted">
                                        No clients have been set up yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        <tfoot className="border-t border-border/50 bg-cyan-500/8">
                            <tr>
                                <td colSpan={4} className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                                    Totals Excluding Internal
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-semibold text-white">
                                    {externalTotals.min.toFixed(1)}
                                </td>
                                <td className="px-4 py-3 text-right text-sm font-semibold text-white">
                                    {externalTotals.max.toFixed(1)}
                                </td>
                                <td colSpan={4}></td>
                            </tr>
                        </tfoot>
                    </table>
                    {contactModalClientId && activeContactClient && (
                        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
                            <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-border/60 bg-[#0e1424] shadow-[0_24px_90px_rgba(0,0,0,0.45)]">
                                <div className="flex items-center justify-between border-b border-border/50 bg-[#161c2f] px-5 py-4">
                                    <div>
                                        <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Client Contacts</div>
                                        <div className="mt-1 text-lg font-semibold text-white">
                                            {activeContactClient.name || "New client"}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleCloseContactModal}
                                        className="inline-flex items-center justify-center rounded-md border border-border/60 p-2 text-text-muted hover:bg-surface-hover hover:text-white"
                                        aria-label="Close contact editor"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                                <div className="space-y-4 bg-[linear-gradient(180deg,#10172a_0%,#0d1322_100%)] p-5">
                                    <div className="space-y-3">
                                        {contactDrafts.map((contact, index) => (
                                            <div key={contact.id} className="grid grid-cols-1 gap-3 rounded-xl border border-border/50 bg-surface/50 p-3 md:grid-cols-2">
                                                <div className="space-y-2">
                                                    <label className="text-xs text-text-muted">First name</label>
                                                    <input
                                                        value={contact.firstName}
                                                        onChange={(event) => handleContactDraftChange(index, { firstName: event.target.value })}
                                                        className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                                        placeholder="First name"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-xs text-text-muted">Last name</label>
                                                    <input
                                                        value={contact.lastName}
                                                        onChange={(event) => handleContactDraftChange(index, { lastName: event.target.value })}
                                                        className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                                        placeholder="Last name"
                                                    />
                                                </div>
                                                <div className="space-y-2 md:col-span-2">
                                                    <label className="text-xs text-text-muted inline-flex items-center gap-2">
                                                        <Mail className="h-3.5 w-3.5" />
                                                        Email address
                                                    </label>
                                                    <input
                                                        value={contact.email}
                                                        onChange={(event) => handleContactDraftChange(index, { email: event.target.value })}
                                                        className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                                        placeholder="contact@company.com"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <label className="text-xs text-text-muted">Role</label>
                                                    <select
                                                        value={contact.role || STANDARD_CLIENT_ROLES[0]}
                                                        onChange={(event) => handleContactDraftChange(index, { role: event.target.value })}
                                                        className="w-full rounded-lg border border-border/60 bg-background/50 px-3 py-2 text-sm text-white outline-none focus:border-primary"
                                                    >
                                                        {STANDARD_CLIENT_ROLES.map((role) => (
                                                            <option key={role} value={role} className="bg-background">
                                                                {role}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="flex items-end md:pb-1.5">
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveContactRow(index)}
                                                        className="inline-flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-100 hover:bg-red-500/20"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                        Remove
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                        {contactDrafts.length === 0 && (
                                            <div className="rounded-xl border border-dashed border-border/50 px-3 py-6 text-center text-sm text-text-muted">
                                                Add one or more contacts with this client.
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleAddContactRow}
                                        className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-surface px-3 py-2 text-xs font-semibold text-white"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        Add Contact
                                    </button>
                                </div>
                                <div className="flex items-center justify-end gap-2 border-t border-border/50 bg-surface/50 px-5 py-4">
                                    <button
                                        type="button"
                                        onClick={handleCloseContactModal}
                                        className="rounded-lg border border-border/60 px-3 py-2 text-sm text-text-main hover:bg-surface-hover"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleSaveContacts}
                                        className="inline-flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/15 px-3 py-2 text-sm font-medium text-white hover:bg-primary/25"
                                    >
                                        Save Contacts
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </section>
    );
}
