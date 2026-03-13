"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import {
    BarChart2,
    BarChart3,
    Grid2x2,
    TrendingUp,
    Activity,
    Users,
    Settings,
    Folder,
    ChevronDown,
    ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface FolderWithLists {
    id: string;
    name: string;
    lists: { id: string; name: string; statusOrder?: string[] }[];
}

interface SidebarProps {
    folders?: FolderWithLists[];
    selectedListId?: string | null;
    selectedFolderId?: string | null;
    activeTab?: string;
    onSelectList?: (id: string | null) => void;
    onSelectFolder?: (id: string | null) => void;
    onSelectTab?: (tab: string) => void;
    teamsLabel?: string;
}

const navItems = [
    { icon: BarChart2, label: "Command Center", id: "command-center" },
    { icon: TrendingUp, label: "Billing Trends", id: "trends" },
    { icon: Activity, label: "Capacity Trends", id: "capacity-trends" },
    { icon: Users, label: "Consultant Utilization", id: "consultant-utilization" },
    { icon: Grid2x2, label: "Capacity Grid", id: "capacity-grid" },
];

const projectItems = [
    { icon: BarChart3, label: "Release Burndown", id: "projects" },
    { icon: BarChart3, label: "Backlog Growth", id: "backlog-growth" },
];

export function Sidebar({
    folders = [],
    selectedListId = null,
    selectedFolderId = null,
    activeTab = "issues",
    onSelectList = () => { },
    onSelectFolder = () => { },
    onSelectTab = () => { },
    teamsLabel = "Teams",
}: SidebarProps) {
    const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const toggleFolder = (folderId: string, e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setExpandedFolders(prev => ({
            ...prev,
            [folderId]: prev[folderId] === undefined ? false : !prev[folderId]
        }));
    };

    return (
        <aside className="w-64 border-r border-border bg-background flex flex-col h-full shrink-0 relative z-10">
            {/* Top Header Placeholder */}
            <div className="h-14 flex items-center px-4 border-b border-border shadow-sm">
                <div
                    onClick={() => { onSelectList(null); onSelectFolder(null); onSelectTab("command-center"); }}
                    className="flex items-center gap-2 w-full cursor-pointer hover:bg-surface-hover p-1.5 rounded-md transition-colors"
                >
                    <div className="w-5 h-5 bg-primary rounded shadow-glow flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                        MC
                    </div>
                    <span className="font-medium text-text-main text-sm truncate">Mission Control</span>
                </div>
            </div>

            <nav className="flex-1 py-4 px-3 space-y-6 overflow-y-auto custom-scrollbar">

                {/* Main Nav */}
                <div className="space-y-1">
                    {navItems.map((item) => {
                        const Icon = item.icon;
                        const isActiveTab = activeTab === item.id;

                        return (
                            <button
                                type="button"
                                key={item.id}
                                onClick={() => onSelectTab(item.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-1.5 rounded-md transition-all duration-200 text-[13px] font-medium group",
                                    isActiveTab
                                        ? "bg-surface-hover text-text-main shadow-sm"
                                        : "text-text-muted hover:text-text-main hover:bg-surface-hover/50"
                                )}
                            >
                                {isMounted ? (
                                    <Icon className={cn(
                                        "w-4 h-4 transition-colors shrink-0",
                                        isActiveTab ? "text-primary" : "text-text-muted group-hover:text-text-main"
                                    )} />
                                ) : (
                                    <span className="w-4 h-4 shrink-0" aria-hidden />
                                )}
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                <div className="space-y-2">
                    <div className="px-3">
                        <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">Projects</span>
                    </div>
                    {projectItems.map((item) => {
                        const Icon = item.icon;
                        const isActiveTab = activeTab === item.id;

                        return (
                            <button
                                type="button"
                                key={item.id}
                                onClick={() => onSelectTab(item.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 px-3 py-1.5 rounded-md transition-all duration-200 text-[13px] font-medium group",
                                    isActiveTab
                                        ? "bg-surface-hover text-text-main shadow-sm"
                                        : "text-text-muted hover:text-text-main hover:bg-surface-hover/50"
                                )}
                            >
                                {isMounted ? (
                                    <Icon className={cn(
                                        "w-4 h-4 transition-colors shrink-0",
                                        isActiveTab ? "text-primary" : "text-text-muted group-hover:text-text-main"
                                    )} />
                                ) : (
                                    <span className="w-4 h-4 shrink-0" aria-hidden />
                                )}
                                {item.label}
                            </button>
                        );
                    })}
                </div>

                {/* Folders List */}
                {folders.length > 0 && (
                    <div className="space-y-4 pb-4">
                        <div className="px-3 flex items-center justify-between">
                            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">{teamsLabel}</span>
                        </div>
                        {folders.map((folder) => {
                            const isExpanded = expandedFolders[folder.id] !== false; // true by default

                            return (
                                <div key={folder.id} className="space-y-1">
                                    <button
                                        type="button"
                                        onClick={() => { onSelectFolder(folder.id); onSelectTab("issues"); }}
                                        className={cn(
                                            "w-full px-3 py-1.5 flex items-center gap-2 rounded-md transition-colors text-left group",
                                            selectedFolderId === folder.id
                                                ? "bg-surface-hover text-text-main shadow-sm"
                                                : "text-text-muted/80 hover:bg-surface-hover/50 hover:text-text-main"
                                        )}
                                    >
                                        <div
                                            className="p-0.5 -ml-1 rounded hover:bg-surface-hover/80 transition-colors"
                                            onClick={(e) => toggleFolder(folder.id, e)}
                                        >
                                            {isMounted ? (
                                                isExpanded ? (
                                                    <ChevronDown className="w-3.5 h-3.5 text-text-muted group-hover:text-text-main" />
                                                ) : (
                                                    <ChevronRight className="w-3.5 h-3.5 text-text-muted group-hover:text-text-main" />
                                                )
                                            ) : (
                                                <span className="w-3.5 h-3.5 block" aria-hidden />
                                            )}
                                        </div>
                                        {isMounted ? (
                                            <Folder className={cn(
                                                "w-3.5 h-3.5",
                                                selectedFolderId === folder.id ? "text-primary flex-shrink-0" : "text-text-muted/80 group-hover:text-text-main flex-shrink-0"
                                            )} />
                                        ) : (
                                            <span className="w-3.5 h-3.5 shrink-0" aria-hidden />
                                        )}
                                        <span className="text-[11px] font-bold uppercase tracking-wider truncate flex-1">{folder.name}</span>
                                    </button>

                                    {isExpanded && folder.lists.map((list) => {
                                        const isActive = selectedListId === list.id;
                                        return (
                                            <button
                                                type="button"
                                                key={list.id}
                                                onClick={() => { onSelectList(list.id); onSelectTab("issues"); }}
                                                className={cn(
                                                    "w-full flex items-center gap-3 px-3 py-1.5 pl-8 rounded-md transition-all duration-200 text-[13px] font-medium group text-left",
                                                    isActive
                                                        ? "bg-surface-hover text-text-main shadow-sm relative"
                                                        : "text-text-muted hover:text-text-main hover:bg-surface-hover/50"
                                                )}
                                                title={list.name}
                                            >
                                                {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-r-full" />}
                                                <span className="truncate">{list.name}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                )}
            </nav>

            <div className="p-3 border-t border-border">
                <Link
                    href="/settings"
                    className="flex items-center gap-3 px-3 py-2 rounded-md transition-all text-[13px] font-medium text-text-muted hover:text-text-main hover:bg-surface-hover"
                >
                    {isMounted ? (
                        <Settings className="w-4 h-4 shrink-0" />
                    ) : (
                        <span className="w-4 h-4 shrink-0" aria-hidden />
                    )}
                    Settings
                </Link>
            </div>
        </aside>
    );
}
