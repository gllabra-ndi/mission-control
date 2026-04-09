const { PrismaClient } = require("@prisma/client");
require("dotenv").config({ path: ".env.local" });

async function main() {
    const dbUrl = "postgresql://neondb_owner:npg_V2Gwfs8yQmEn@ep-wandering-paper-annx1sbk-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: dbUrl,
            },
        },
    });
    console.log("Connecting to database directly...");
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
