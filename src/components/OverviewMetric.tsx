import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface OverviewMetricProps {
    title: string;
    value: string | number;
    subtitle?: string;
    trend?: {
        value: string;
        isPositive: boolean;
    };
    icon?: ReactNode;
    className?: string;
}

export function OverviewMetric({ title, value, subtitle, trend, icon, className }: OverviewMetricProps) {
    return (
        <div className={cn("lucid-card p-5 flex flex-col gap-3 group relative overflow-hidden", className)}>
            {/* Subtle top border highlight effect */}
            <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

            <div className="flex justify-between items-start">
                <h3 className="text-[13px] font-medium text-text-muted">{title}</h3>
                {icon && <div className="text-text-muted">{icon}</div>}
            </div>

            <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-semibold tracking-tight text-white">{value}</span>
                {trend && (
                    <span className={cn(
                        "text-xs font-medium px-1.5 py-0.5 rounded-full bg-opacity-10",
                        trend.isPositive ? "text-green-400 bg-green-400/10" : "text-red-400 bg-red-400/10"
                    )}>
                        {trend.value}
                    </span>
                )}
            </div>

            {subtitle && (
                <p className="text-[12px] text-text-muted/80">{subtitle}</p>
            )}
        </div>
    );
}
