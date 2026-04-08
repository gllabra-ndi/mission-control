import { PrismaClient } from "@prisma/client";
import "dotenv/config";

async function main() {
    const prisma = new PrismaClient();
    console.log("Connecting to database...");
    const start = Date.now();
    try {
        const count = await prisma.appUser.count();
        console.log(`Query successful. User count: ${count}`);
        console.log(`Query took ${Date.now() - start}ms`);
    } catch (e) {
        console.error("Query failed:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
