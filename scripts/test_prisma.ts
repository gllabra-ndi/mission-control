import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { prisma } from '../src/lib/prisma';

async function main() {
    try {
        const tasks = await prisma.editableTask.findMany();
        console.log(`Found ${tasks.length} editable tasks in local DB.`);
        if (tasks.length > 0) {
            console.log(tasks.slice(0, 5).map(t => ({ subject: t.subject, scopeId: t.scopeId, week: t.week })));
        }
    } catch (e) {
        console.error("DB error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
