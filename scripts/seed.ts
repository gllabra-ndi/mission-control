import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { getTeamTasks } from '../src/lib/clickup'
import { prisma } from '../src/lib/prisma'

// W10 data from Google Sheet
const W10_CLIENT_TARGETS: Record<string, number> = {
    "Mikisew": 30.0,
    "Sparetek": 5.0,
    "AKRikks": 2.0,
    "Santec | Canada": 15.0,
    "FPM": 5.0,
    "Global Light": 5.0,
    "SodaStream": 30.0,
    "TIN | ThatsItFruit": 15.0,
    "SIGA": 4.0,
    "LSCU": 10.0,
    "Global Gourmet": 0.0,
    "Dye & Durham": 15.0,
    "A2A": 14.0,
    "ROF": 8.4,
    "HPSA": 5.0,
    "Jascko": 4.0,
    "Pellucere": 8.0,
    "BigBolt": 0.0,
    "Centium/Tonix": 10.0,
    "Centium/A3B": 10.0,
    "Centium/C3CW": 10.0,
    "Turing": 17.5,
    "Happy Feet": 0.0
};

const W10_CONSULTANT_CAPACITY: Record<string, number> = {
    "Omair": 20,
    "Janelle": 40,
    "Mike": 40,
    "Aysha": 40,
    "Nergis": 40,
    "Chris": 20 // Using Chris for Chris B
};

const W10_STRING = "2026-03-02"; // Week 10 Monday

async function main() {
    console.log("Fetching ClickUp Tasks to resolve IDs...");

    // Polyfill fetch for node environment if running directly 
    // Just relying on tsx/node 18+ which has global fetch
    const tasks: any[] = await getTeamTasks();
    if (!Array.isArray(tasks)) {
        console.error("Failed to fetch tasks, check API key.");
        process.exit(1);
    }

    const listMap = new Map<string, string>();
    const userMap = new Map<string, number>();

    tasks.forEach(t => {
        if (t.list?.id) {
            listMap.set(t.list.name, t.list.id);
        }
        if (t.assignees) {
            t.assignees.forEach((a: any) => {
                userMap.set(a.username, a.id);
            });
        }
    });

    console.log(`Found ${listMap.size} unique lists and ${userMap.size} unique users.`);

    // 1. Seed Week Config
    await prisma.weekConfig.upsert({
        where: { week: W10_STRING },
        update: { baseTarget: 350, stretchTarget: 400 },
        create: { week: W10_STRING, baseTarget: 350, stretchTarget: 400 }
    });

    // 2. Seed Client Targets
    for (const [clientName, target] of Object.entries(W10_CLIENT_TARGETS)) {
        // Try to find matching list ID in ClickUp
        let listId = Array.from(listMap.entries()).find(([name]) =>
            name.toLowerCase().includes(clientName.toLowerCase()) || clientName.toLowerCase().includes(name.toLowerCase())
        )?.[1];

        if (!listId) {
            console.log(`⚠️ Warning: Could not find exact ClickUp List match for Client: ${clientName}`);
            // we will insert with clientName as ID if not found just as a fallback, or skip?
            // it's better to skip since dashboard maps by listId
            continue;
        }

        await prisma.clientConfig.upsert({
            where: { week_clientId: { week: W10_STRING, clientId: listId } },
            update: { target, max: 0, team: 0 },
            create: { week: W10_STRING, clientId: listId, target, max: 0, team: 0 }
        });
        console.log(`✅ Seeded Client: ${clientName} (${listId}) -> Target: ${target}`);
    }

    // 3. Seed Consultant Capacities
    for (const [userName, capacity] of Object.entries(W10_CONSULTANT_CAPACITY)) {
        let userId = Array.from(userMap.entries()).find(([name]) =>
            name.toLowerCase().includes(userName.toLowerCase())
        )?.[1];

        if (!userId) {
            console.log(`⚠️ Warning: Could not find exact ClickUp User match for Consultant: ${userName}`);
            continue;
        }

        await prisma.consultantConfig.upsert({
            where: { week_consultantId: { week: W10_STRING, consultantId: userId } },
            update: { maxCapacity: capacity },
            create: { week: W10_STRING, consultantId: userId, maxCapacity: capacity }
        });
        console.log(`✅ Seeded Consultant: ${userName} (${userId}) -> Max Capacity: ${capacity}`);
    }

    console.log("Database seeded successfully!");
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })
