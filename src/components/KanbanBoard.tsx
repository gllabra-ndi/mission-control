import { ClickUpTask } from "@/lib/clickup";
import { TaskCard } from "./TaskCard";

interface KanbanBoardProps {
    groupedTasks: Record<string, ClickUpTask[]>;
    columnOrder?: string[];
}

export function KanbanBoard({ groupedTasks, columnOrder = [] }: KanbanBoardProps) {
    const existingKeys = Object.keys(groupedTasks);
    const baseColumns = columnOrder.length > 0 ? columnOrder : existingKeys;
    const orderedColumns = [
        ...baseColumns,
        ...existingKeys.filter((k) => !baseColumns.includes(k)),
    ];

    if (orderedColumns.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-text-muted border border-dashed border-border rounded-xl">
                <p>No tasks found for this view.</p>
            </div>
        );
    }

    return (
        <div className="flex gap-4 overflow-x-auto pb-4 pt-2 snap-x h-full">
            {orderedColumns.map((columnKey) => {
                const tasks = groupedTasks[columnKey] || [];
                return (
                    <div key={columnKey} className="flex-shrink-0 w-[320px] snap-start flex flex-col max-h-full">
                        <div className="flex items-center justify-between mb-3 px-1 sticky top-0 z-10 bg-background/80 backdrop-blur-sm py-2">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-medium text-text-main">{columnKey}</h3>
                                <span className="text-xs bg-surface-hover text-text-muted px-1.5 py-0.5 rounded-full font-mono">
                                    {tasks.length}
                                </span>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto pr-1 pb-10 space-y-1 custom-scrollbar">
                            {tasks.map((task) => (
                                <TaskCard key={task.id} task={task} />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
