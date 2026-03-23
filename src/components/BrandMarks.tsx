"use client";

import { cn } from "@/lib/utils";

interface BrandMarkProps {
    className?: string;
}

export function MissionControlMark({ className }: BrandMarkProps) {
    return (
        <div
            className={cn(
                "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-indigo-400/20 bg-indigo-500/85",
                className
            )}
        >
            <div className="absolute inset-[5px] rounded-xl border border-white/10 bg-slate-950/12" />
            <div className="absolute h-6 w-6 rounded-full border border-white/35" />
            <div className="absolute h-3 w-3 rounded-full border border-white/70 bg-white/12" />
            <div className="absolute left-[8px] top-[8px] h-1.5 w-1.5 rounded-full bg-white/70" />
            <span className="relative text-[11px] font-semibold uppercase tracking-[0.24em] text-white/92">
                MC
            </span>
        </div>
    );
}

export function MissionEngineMark({ className }: BrandMarkProps) {
    return (
        <div
            className={cn(
                "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/80",
                className
            )}
        >
            <div className="absolute inset-[5px] rounded-xl border border-white/10 bg-slate-950/12" />
            <div className="absolute h-5.5 w-5.5 rounded-full border border-white/55" />
            <div className="absolute h-2.5 w-2.5 rounded-full bg-white/80" />
            <div className="absolute right-[7px] top-[9px] h-1.5 w-1.5 rounded-full bg-white/70" />
            <div className="absolute bottom-[7px] left-[9px] h-1 w-4 rounded-full bg-white/45" />
        </div>
    );
}
