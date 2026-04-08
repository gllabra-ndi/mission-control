import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const dbPath = path.resolve(repoRoot, process.env.INTEGRITY_DB_PATH || "prisma/dev.db");

async function queryJson(sql) {
    const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql], {
        cwd: repoRoot,
        env: process.env,
    });
    const text = String(stdout || "").trim();
    return text ? JSON.parse(text) : [];
}

async function main() {
    const checks = [
        {
            name: "planned week before created week",
            sql: "select count(*) as count from EditableTask where plannedWeek is not null and plannedWeek <> '' and plannedWeek < week;",
        },
        {
            name: "closed date before created week",
            sql: "select count(*) as count from EditableTask where closedDate is not null and closedDate <> '' and substr(closedDate, 1, 10) < week;",
        },
        {
            name: "negative estimate hours",
            sql: "select count(*) as count from EditableTask where estimateHours < 0;",
        },
        {
            name: "negative billable entry hours",
            sql: "select count(*) as count from TaskBillableEntry where hours < 0;",
        },
        {
            name: "closed tasks missing closed date",
            sql: "select count(*) as count from EditableTask where status = 'closed' and (closedDate is null or closedDate = '');",
        },
        {
            name: "backlog tasks with close date",
            sql: "select count(*) as count from EditableTask where status = 'backlog' and closedDate is not null and closedDate <> '';",
        },
        {
            name: "duplicate source task rows in the same scope/week",
            sql: "select count(*) as count from (select week, scopeType, scopeId, sourceTaskId, count(*) as rowCount from EditableTask where sourceTaskId is not null and sourceTaskId <> '' group by week, scopeType, scopeId, sourceTaskId having count(*) > 1);",
        },
        {
            name: "duplicate billable entries for the same task/day",
            sql: "select count(*) as count from (select taskId, entryDate, count(*) as rowCount from TaskBillableEntry group by taskId, entryDate having count(*) > 1);",
        },
        {
            name: "blank task subjects",
            sql: "select count(*) as count from EditableTask where trim(subject) = '';",
        },
    ];

    const failures = [];

    for (const check of checks) {
        const [row] = await queryJson(check.sql);
        const count = Number(row?.count ?? 0);
        if (count > 0) {
            failures.push(`${check.name}: ${count}`);
        }
    }

    if (failures.length > 0) {
        throw new Error(`Task integrity checks failed for ${dbPath}\n${failures.join("\n")}`);
    }

    console.log(`[integrity] Task integrity checks passed for ${dbPath}`);
}

main().catch((error) => {
    console.error(`[integrity] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
