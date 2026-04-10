import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, "..");

const COPY_TABLES = [
    "WeekConfig",
    "LeadConfig",
    "ClientConfig",
    "ClientDirectory",
    "Consultant",
    "AppUser",
    "ConsultantConfig",
    "CapacityGridConfig",
    "TaskSidebarFolder",
    "TaskSidebarBoard",
    "TaskSidebarBoardPlacement",
    "TaskSidebarHiddenBoard",
    "TaskSidebarHiddenFolder",
    "TaskSidebarFolderOverride",
    "EditableTask",
    "TaskAttachment",
    "TaskBillableEntry",
];

function assertSafeIdentifier(value, label) {
    assert.match(value, /^[A-Za-z_][A-Za-z0-9_]*$/, `${label} must be a safe Postgres identifier`);
    return value;
}

export function requirePostgresDatabaseUrl(databaseUrl = process.env.DATABASE_URL || "") {
    const trimmed = String(databaseUrl || "").trim();
    assert(trimmed, "DATABASE_URL must be set for Postgres-backed regression checks");
    assert(
        trimmed.startsWith("postgresql://") || trimmed.startsWith("postgres://"),
        "DATABASE_URL must point to Postgres for regression checks"
    );
    return trimmed;
}

export function getSchemaNameFromDatabaseUrl(databaseUrl) {
    const url = new URL(requirePostgresDatabaseUrl(databaseUrl));
    const schema = url.searchParams.get("schema")?.trim() || "public";
    return assertSafeIdentifier(schema, "Database schema");
}

export function buildSchemaDatabaseUrl(databaseUrl, schemaName) {
    const url = new URL(requirePostgresDatabaseUrl(databaseUrl));
    url.searchParams.set("schema", assertSafeIdentifier(schemaName, "Isolated schema"));
    return url.toString();
}

function createSchemaName(prefix) {
    const safePrefix = String(prefix || "test").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+/, "") || "test";
    const token = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    return assertSafeIdentifier(`${safePrefix}_${token}`, "Generated schema");
}

async function runPrismaDbPush(databaseUrl, stdio = "inherit") {
    const child = spawn("npx", ["prisma", "db", "push", "--skip-generate"], {
        cwd: repoRoot,
        env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
        },
        stdio,
    });

    const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
    });

    assert.equal(exitCode, 0, "Prisma schema sync failed for isolated Postgres schema");
}

async function copySchemaData(baseDatabaseUrl, schemaName, sourceSchema) {
    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: buildSchemaDatabaseUrl(baseDatabaseUrl, schemaName),
            },
        },
    });

    try {
        for (const tableName of COPY_TABLES) {
            const targetColumns = await prisma.$queryRawUnsafe(
                `select column_name
                 from information_schema.columns
                 where table_schema = '${schemaName}'
                   and table_name = '${tableName}'
                 order by ordinal_position;`
            );
            const sourceColumns = await prisma.$queryRawUnsafe(
                `select column_name
                 from information_schema.columns
                 where table_schema = '${sourceSchema}'
                   and table_name = '${tableName}'
                 order by ordinal_position;`
            );
            const sourceColumnSet = new Set(sourceColumns.map((row) => String(row.column_name)));
            const orderedColumns = targetColumns
                .map((row) => String(row.column_name))
                .filter((columnName) => sourceColumnSet.has(columnName));
            const quotedColumns = orderedColumns.map((columnName) => `"${columnName}"`).join(", ");

            assert(quotedColumns, `No shared columns found for ${tableName} while cloning isolated test schema`);
            await prisma.$executeRawUnsafe(
                `INSERT INTO "${schemaName}"."${tableName}" (${quotedColumns})
                 SELECT ${quotedColumns} FROM "${sourceSchema}"."${tableName}";`
            );
        }
    } finally {
        await prisma.$disconnect();
    }
}

export async function createIsolatedPostgresSchema(prefix, options = {}) {
    const { stdio = "inherit" } = options;
    const baseDatabaseUrl = requirePostgresDatabaseUrl();
    const sourceSchema = getSchemaNameFromDatabaseUrl(baseDatabaseUrl);
    const schemaName = createSchemaName(prefix);
    const databaseUrl = buildSchemaDatabaseUrl(baseDatabaseUrl, schemaName);

    const adminPrisma = new PrismaClient({
        datasources: {
            db: {
                url: baseDatabaseUrl,
            },
        },
    });

    try {
        await adminPrisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    } finally {
        await adminPrisma.$disconnect();
    }

    await runPrismaDbPush(databaseUrl, stdio);
    await copySchemaData(baseDatabaseUrl, schemaName, sourceSchema);

    return {
        baseDatabaseUrl,
        databaseUrl,
        schemaName,
        sourceSchema,
    };
}

export async function dropIsolatedPostgresSchema(baseDatabaseUrl, schemaName) {
    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: requirePostgresDatabaseUrl(baseDatabaseUrl),
            },
        },
    });

    try {
        await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${assertSafeIdentifier(schemaName, "Schema")}" CASCADE`);
    } finally {
        await prisma.$disconnect();
    }
}
