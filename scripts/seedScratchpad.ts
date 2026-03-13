import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const prisma = new PrismaClient();

const scratchpadData = [
    { client: "Mikisew", sa: "Monica", dealType: "T&M", team: 1, min: 30, max: 0, target: 30 },
    { client: "Sparetek", sa: "Omair", dealType: "T&M", team: 2, min: 5, max: 0, target: 4 },
    { client: "AKRikks", sa: "Greg", dealType: "T&M", team: 2, min: 2, max: 0, target: 20 },
    { client: "Santec | Canada", sa: "Omair", dealType: "T&M", team: 2, min: 15, max: 0, target: 25 },
    { client: "FPM", sa: "Nikko", dealType: "T&M", team: 3, min: 5, max: 0, target: 3 },
    { client: "Global Light", sa: "James W.", dealType: "Dyna Flex", team: 3, min: 5, max: 210, target: 8 },
    { client: "SodaStream", sa: "Monica", dealType: "T&M", team: 3, min: 30, max: 0, target: 55 },
    { client: "TIN | ThatsItFruit", sa: "Omair", dealType: "Dyna Flex", team: 3, min: 15, max: 0, target: 35 },
    { client: "SIGA", sa: "James W.", dealType: "T&M", team: 4, min: 4, max: 0, target: 15 },
    { client: "LSCU", sa: "Monica", dealType: "T&M", team: 3, min: 10, max: 0, target: 10 },
    { client: "Global Gourmet", sa: "James W.", dealType: "T&M", team: 4, min: 0, max: 0, target: 5 },
    { client: "Dye & Durham", sa: "James W.", dealType: "T&M", team: 4, min: 15, max: 0, target: 20 },
    { client: "A2A", sa: "James/Omair", dealType: "Dyna Flex", team: 4, min: 14, max: 0, target: 2 },
    { client: "ROF", sa: "James W.", dealType: "Dyna Flex", team: 4, min: 8.4, max: 0, target: 14 },
    { client: "HPSA", sa: "James W.", dealType: "Fixed", team: 4, min: 5, max: 0, target: 10 },
    { client: "Jascko", sa: "James W.", dealType: "T&M", team: 4, min: 4, max: 0, target: 25 },
    { client: "Pellucere", sa: "Monica", dealType: "Dyna Flex", team: 5, min: 8, max: 0, target: 15 },
    { client: "BigBolt", sa: "Mike", dealType: "T&M", team: 5, min: 0, max: 0, target: 10 },
    { client: "Centium/Tonix", sa: "Joe", dealType: "T&M", team: 5, min: 10, max: 0, target: 10 },
    { client: "Centium/A3B", sa: "Joe", dealType: "T&M", team: 5, min: 10, max: 0, target: 20 },
    { client: "Centium/C3CW", sa: "Joe", dealType: "T&M", team: 5, min: 10, max: 0, target: 0 },
    { client: "Turing", sa: "Greg", dealType: "T&M", team: 5, min: 17.5, max: 0, target: 17.5 },
    { client: "Happy Feet", sa: "James W.", dealType: "T&M", team: 4, min: 0, max: 0, target: 20 },
    { client: "Service Pros", sa: "", dealType: "Fixed", team: 0, min: 0, max: 0, target: 0 }
];

async function main() {
    const week = "2026-03-02";
    console.log(`Wiping and seeding exact standalone scratchpad rows for week ${week}...`);

    // Wipe existing
    await prisma.clientConfig.deleteMany({ where: { week } });

    // Seed
    for (let i = 0; i < scratchpadData.length; i++) {
        const data = scratchpadData[i];
        const clientId = `row-${i + 1}`;
        await prisma.clientConfig.create({
            data: {
                week,
                clientId,
                clientName: data.client,
                orderIndex: i + 1,
                team: data.team,
                sa: data.sa,
                dealType: data.dealType,
                min: data.min,
                max: data.max,
                target: data.target,
                mtHrs: 0,
                wPlusHrs: 0
            }
        });
        console.log(`Seeded scratchpad row ${clientId}: ${data.client}`);
    }

    console.log("Scratchpad UI Seed complete.");
}

main().catch(console.error).finally(() => prisma.$disconnect());
