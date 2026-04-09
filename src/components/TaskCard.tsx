import { format } from "date-fns";
import { Clock } from "lucide-react";
import { ImportedTask } from "@/lib/imported-data";
import { cn } from "@/lib/utils";

interface TaskCardProps {
    task: ImportedTask;
}

export function TaskCard({ task }: TaskCardProps) {
    // A sleek priority indicator placeholder or status color indicator
    const statusColor = task.status.color || "#8A8F98";

    return (
        <div className="lucid-card p-3.5 mb-2 hover:cursor-pointer flex flex-col gap-2 group">
            <div className="flex items-start justify-between gap-3">
                {/* Status ring or icon and Title */}
                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                    <div
                        className="w-3.5 h-3.5 mt-0.5 rounded-full border-[2px] flex-shrink-0"
                        style={{ borderColor: statusColor }}
                    />
                    <h4 className="text-sm font-medium text-text-main line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                        {task.name}
                    </h4>
                </div>
            </div>

            <div className="flex items-center justify-between mt-1 pt-2 border-t border-border/50">
                <div className="flex items-center gap-1.5 text-xs text-text-muted">
                    <span className="font-mono text-[10px] uppercase bg-surface-hover px-1.5 py-0.5 rounded text-text-muted/70">
                        {task.id}
                    </span>
                    {task.due_date && (
                        <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{format(new Date(parseInt(task.due_date)), "MMM d")}</span>
                        </div>
                    )}
                </div>

                <div className="flex -space-x-1.5 overflow-hidden">
                    {task.assignees?.map((assignee) => (
                        <div
                            key={assignee.id}
                            className="w-5 h-5 rounded-full bg-surface-hover border border-border flex items-center justify-center text-[9px] font-bold text-white uppercase shadow-sm"
                            title={assignee.username || "Unknown User"}
                        >
                            {(assignee.username || "U").charAt(0)}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
