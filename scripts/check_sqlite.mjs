import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

async function main() {
    const db = await open({
        filename: './prisma/dev.db',
        driver: sqlite3.Database
    });

    // Check local tasks
    const tasks = await db.all('SELECT id, subject, scopeId, scopeType, week, assignee FROM EditableTask');
    console.log(`Found ${tasks.length} local tasks in Database.`);
    if (tasks.length > 0) {
        console.log("Tasks:", tasks.slice(0, 5));
    }
}
main();
