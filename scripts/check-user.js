const { PrismaClient } = require("@prisma/client");

async function main() {
    const dbUrl = "postgresql://neondb_owner:npg_V2Gwfs8yQmEn@ep-wandering-paper-annx1sbk-pooler.c-6.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
    const prisma = new PrismaClient({
        datasources: {
            db: {
                url: dbUrl,
            },
        },
    });
    try {
        const user = await prisma.appUser.findUnique({
            where: { email: "jemo@netdynamicinc.com" },
        });
        console.log("User data:", JSON.stringify(user, null, 2));
    } catch (e) {
        console.error("Query failed:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
