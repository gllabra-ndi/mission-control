import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
    try {
        const tasks = await prisma.editableTask.findMany();
        console.log(`Found ${tasks.length} editable tasks in local DB.`);
        if (tasks.length > 0) {
            console.log(tasks.slice(0, 3));
        }
    } catch (e) {
        console.error("DB error:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
