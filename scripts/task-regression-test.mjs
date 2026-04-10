import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";
import { createIsolatedPostgresSchema, dropIsolatedPostgresSchema } from "./test-db-utils.mjs";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const hostname = "127.0.0.1";
const port = Number(process.env.REGRESSION_PORT || 3102);
const baseUrl = `http://${hostname}:${port}`;
const targetWeek = process.env.REGRESSION_WEEK || "2026-03-23";
const distDir = `.next-regression-${port}-${Date.now()}`;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncSchema(databaseUrl) {
    const child = spawn("npx", ["prisma", "db", "push", "--skip-generate"], {
        cwd: repoRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "inherit",
    });
    const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
    });
    assert.equal(exitCode, 0, "Prisma schema sync failed for regression suite");
}

async function buildApp(databaseUrl) {
    const child = spawn("npm", ["run", "build"], {
        cwd: repoRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl, AUTH_ENABLED: "false", NEXT_DIST_DIR: distDir, CI: "true" },
        stdio: "inherit",
    });
    const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
    });
    assert.equal(exitCode, 0, "Regression build failed");
}

function startServer(databaseUrl) {
    return spawn("npx", ["next", "start", "--hostname", hostname, "--port", String(port)], {
        cwd: repoRoot,
        env: { ...process.env, DATABASE_URL: databaseUrl, AUTH_ENABLED: "false", NEXT_DIST_DIR: distDir, PORT: String(port), CI: "true" },
        stdio: "inherit",
    });
}

async function waitForServer(timeoutMs = 120000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/api/health`, { cache: "no-store", redirect: "manual" });
            if (response.ok) return;
        } catch {
            // keep waiting
        }
        await sleep(1000);
    }
    throw new Error(`Timed out waiting for ${baseUrl}`);
}

async function stopServer(child) {
    if (!child || child.exitCode !== null) return;
    child.kill("SIGINT");
    await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        sleep(5000),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
}

async function clickTaskBySubject(page, subject) {
    const clicked = await page.evaluate((targetSubject) => {
        const cards = Array.from(document.querySelectorAll("[draggable='true']"));
        const match = cards.find((card) => String(card.textContent || "").includes(targetSubject));
        if (!(match instanceof HTMLElement)) return false;
        match.click();
        return true;
    }, subject);
    assert(clicked, `Unable to find task card for "${subject}"`);
}

async function main() {
    let browser = null;
    let server = null;
    let isolatedDb = null;
    let isolatedPrisma = null;
    let originalTsconfig = null;

    try {
        originalTsconfig = await readFile(path.join(repoRoot, "tsconfig.json"), "utf8");
        isolatedDb = await createIsolatedPostgresSchema("regression");
        await syncSchema(isolatedDb.databaseUrl);
        await buildApp(isolatedDb.databaseUrl);
        server = startServer(isolatedDb.databaseUrl);
        await waitForServer();

        isolatedPrisma = new PrismaClient({
            datasources: {
                db: {
                    url: isolatedDb.databaseUrl,
                },
            },
        });

        const estimateCandidates = await isolatedPrisma.$queryRawUnsafe(`
            select "scopeType", "scopeId", subject, "estimateHours"
            from "EditableTask"
            where "sourceTaskId" is not null
              and week <= '${targetWeek}'
              and ("closedDate" is null or "closedDate" >= '${targetWeek}')
            order by "estimateHours" desc, "updatedAt" desc
            limit 1;
        `);
        const [estimateCandidate] = estimateCandidates;
        assert(estimateCandidate, "No editable placeholder task available for estimate regression check");

        const carryForwardCandidates = await isolatedPrisma.$queryRawUnsafe(`
            select assignee, subject
            from "EditableTask"
            where assignee <> ''
              and week < '${targetWeek}'
              and "plannedWeek" <= '${targetWeek}'
              and ("closedDate" is null or "closedDate" > '${targetWeek}')
            order by "updatedAt" desc
            limit 1;
        `);
        const [carryForwardCandidate] = carryForwardCandidates;
        assert(carryForwardCandidate, "No carry-forward open task available for timesheet regression check");

        browser = await puppeteer.launch({
            headless: process.env.REGRESSION_HEADLESS !== "false",
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
        });
        const page = await browser.newPage();
        page.setViewport({ width: 1600, height: 1000 });
        page.setDefaultTimeout(20000);
        page.setDefaultNavigationTimeout(120000);

        const scopeParam = estimateCandidate.scopeType === "list" ? "listId" : "folderId";
        const boardUrl = `${baseUrl}/?week=${targetWeek}&tab=issues&${scopeParam}=${encodeURIComponent(estimateCandidate.scopeId)}`;
        await page.goto(boardUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.waitForFunction(() => document.querySelectorAll("[draggable='true']").length > 0, { timeout: 30000 });
        await clickTaskBySubject(page, estimateCandidate.subject);
        await page.waitForFunction(() => document.body?.textContent?.includes("Save Task"), { timeout: 30000 });
        const selector = "input[inputmode='decimal']";
        const originalEstimate = await page.$eval(selector, (element) => element instanceof HTMLInputElement ? element.value : "");
        const nextEstimate = String(Number((Number(originalEstimate || "0") + 0.25).toFixed(2)));
        await page.click(selector, { clickCount: 3 });
        await page.keyboard.press("Backspace");
        await page.type(selector, nextEstimate);
        await page.evaluate(() => {
            const button = Array.from(document.querySelectorAll("button")).find((element) =>
                String(element.textContent || "").replace(/\s+/g, " ").trim() === "Save Task"
            );
            if (button instanceof HTMLElement) button.click();
        });
        await sleep(1000);
        await page.goto(boardUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.waitForFunction(() => document.querySelectorAll("[draggable='true']").length > 0, { timeout: 30000 });
        await clickTaskBySubject(page, estimateCandidate.subject);
        await page.waitForFunction(() => document.body?.textContent?.includes("Save Task"), { timeout: 30000 });
        const persistedEstimate = await page.$eval(selector, (element) => element instanceof HTMLInputElement ? element.value : "");
        assert.equal(Number(persistedEstimate), Number(nextEstimate), "Estimate hours did not persist across a fresh board load");

        const timesheetUrl = `${baseUrl}/?week=${targetWeek}&tab=timesheets&assignee=${encodeURIComponent(carryForwardCandidate.assignee)}`;
        await page.goto(timesheetUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page.waitForFunction(
            (subject) => document.body?.textContent?.includes(subject),
            { timeout: 30000 },
            carryForwardCandidate.subject
        );

        console.log(`[regression] Placeholder estimate persistence verified for "${estimateCandidate.subject}"`);
        console.log(`[regression] Carry-forward timesheet visibility verified for "${carryForwardCandidate.subject}"`);
    } finally {
        if (browser) await browser.close();
        if (server) await stopServer(server);
        if (isolatedPrisma) {
            await isolatedPrisma.$disconnect();
        }
        if (originalTsconfig !== null) {
            await writeFile(path.join(repoRoot, "tsconfig.json"), originalTsconfig, "utf8");
        }
        await rm(path.join(repoRoot, distDir), { recursive: true, force: true });
        if (isolatedDb) {
            await dropIsolatedPostgresSchema(isolatedDb.baseDatabaseUrl, isolatedDb.schemaName);
        }
    }
}

main().catch((error) => {
    console.error(`[regression] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
