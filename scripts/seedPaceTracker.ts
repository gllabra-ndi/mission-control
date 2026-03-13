import { PrismaClient } from '@prisma/client';
import { getTeamTasks } from '../src/lib/clickup';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const prisma = new PrismaClient();

const screenshotData = [
    { client: "Mikisew", sa: "Monica", dealType: "T&M", team: 1, min: 30, max: 0, target: 30 },
    { client: "Sparetek", sa: "Omair", dealType: "T&M", team: 2, min: 5, max: 0, target: 4 },
    { client: "A.K. Rikks", sa: "Greg", dealType: "T&M", team: 2, min: 2, max: 0, target: 20 },
    { client: "Santec | Canada", sa: "Omair", dealType: "T&M", team: 2, min: 15, max: 0, target: 25 },
    { client: "FPM", sa: "Nikko", dealType: "T&M", team: 3, min: 5, max: 0, target: 3 },
    { client: "GLC (Global Light Company)", sa: "James W.", dealType: "Dyna Flex", team: 3, min: 5, max: 210, target: 8 },
    { client: "SodaStream", sa: "Monica", dealType: "T&M", team: 3, min: 30, max: 0, target: 55 },
    { client: "TIN (That's It Fruit)", sa: "Omair", dealType: "Dyna Flex", team: 3, min: 15, max: 0, target: 35 },
    { client: "SIGA", sa: "James W.", dealType: "T&M", team: 4, min: 4, max: 0, target: 15 },
    { client: "LSCU", sa: "Monica", dealType: "T&M", team: 3, min: 10, max: 0, target: 10 },
    { client: "GlobalGourmet", sa: "James W.", dealType: "T&M", team: 4, min: 0, max: 0, target: 5 },
    { client: "Dye & Durham", sa: "James W.", dealType: "T&M", team: 4, min: 15, max: 0, target: 20 },
    { client: "A2A", sa: "James/Omair", dealType: "Dyna Flex", team: 4, min: 14, max: 0, target: 2 },
    { client: "ROF", sa: "James W.", dealType: "Dyna Flex", team: 4, min: 8.4, max: 0, target: 14 },
    { client: "HPSA (Health Steward)", sa: "James W.", dealType: "Fixed", team: 4, min: 5, max: 0, target: 10 },
    { client: "Jascko Corp (HVAC)", sa: "James W.", dealType: "T&M", team: 4, min: 4, max: 0, target: 25 },
    { client: "Pellucere", sa: "Monica", dealType: "Dyna Flex", team: 5, min: 8, max: 0, target: 15 },
    { client: "Big Bolt", sa: "Mike", dealType: "T&M", team: 5, min: 0, max: 0, target: 10 },
    { client: "Centium/Tonix", sa: "Joe", dealType: "T&M", team: 5, min: 10, max: 0, target: 10 }, // Note: 1000% mapping to 10
    { client: "Centium/A3B", sa: "Joe", dealType: "T&M", team: 5, min: 10, max: 0, target: 20 },
    { client: "Centium/C3CW", sa: "Joe", dealType: "T&M", team: 5, min: 10, max: 0, target: 0 },
    { client: "Turing", sa: "Greg", dealType: "T&M", team: 5, min: 17.5, max: 0, target: 17.5 },
    { client: "Happy Feet", sa: "James W.", dealType: "T&M", team: 4, min: 0, max: 0, target: 20 }
];

async function main() {
    console.log("Fetching Folders in PS Workspace to resolve List IDs...");

    const res = await fetch('https://api.clickup.com/api/v2/space/90171692986/folder', {
        headers: { 'Authorization': process.env.CLICKUP_API_KEY as string }
    });
    const data = await res.json();

    // Also fetch folderless lists
    const folderlessRes = await fetch('https://api.clickup.com/api/v2/space/90171692986/list', {
        headers: { 'Authorization': process.env.CLICKUP_API_KEY as string }
    });
    const folderlessData = await folderlessRes.json();

    const listMap = new Map<string, string>(); // name to ID

    if (data.folders) {
        data.folders.forEach((f: any) => {
            if (f.lists) {
                f.lists.forEach((l: any) => {
                    listMap.set(l.name.toLowerCase().replace(/\|/g, '').replace(/  /g, ' ').trim(), l.id);
                });
            }
        });
    }
    if (folderlessData.lists) {
        folderlessData.lists.forEach((l: any) => {
            listMap.set(l.name.toLowerCase().replace(/\|/g, '').replace(/  /g, ' ').trim(), l.id);
        });
    }

    const week = "2026-03-02";
    console.log(`Seeding exact pace tracker layout for week ${week}...`);

    for (const data of screenshotData) {
        // Try to find exact match or partial match
        const searchName = data.client.toLowerCase().replace(/\|/g, '').replace(/  /g, ' ').trim();
        let listId = listMap.get(searchName);

        // Handle special cases
        if (!listId) {
            const potentialMatch = Array.from(listMap.keys()).find(k => k.includes(searchName) || searchName.includes(k));
            if (potentialMatch) {
                listId = listMap.get(potentialMatch);
                console.log(`Fuzzy matched "${data.client}" to List Name "${potentialMatch}" -> List ID ${listId}`);
            }
        }

        if (!listId) {
            console.warn(`WARNING: Could not resolve ClickUp List ID for "${data.client}". Skipping.`);
            continue;
        }

        await prisma.clientConfig.upsert({
            where: { week_clientId: { week, clientId: listId } },
            update: {
                team: data.team,
                sa: data.sa,
                dealType: data.dealType,
                min: data.min,
                max: data.max,
                target: data.target
            },
            create: {
                week,
                clientId: listId,
                team: data.team,
                sa: data.sa,
                dealType: data.dealType,
                min: data.min,
                max: data.max,
                target: data.target
            }
        });
        console.log(`Seeded target for ${data.client} -> ${listId}`);
    }

    console.log("Pace Tracker UI Seed complete.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
