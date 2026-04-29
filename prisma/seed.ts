/**
 * @fileoverview Prisma seed script — populates the Plan table.
 * Run with: npx ts-node prisma/seed.ts  OR  npx prisma db seed
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const plans = [
    {
        name: 'free',
        displayName: 'Majjani',
        priceMAD: 0,
        priceEUR: 0,
        messagesPerConversation: 15, // 0 = unlimited
        contractsPerMonth: 0,        // free plan has no contract builder access
        maxSavedChats: 10,           // 0 = unlimited
        features: JSON.stringify(['chat', 'blog', 'seo_pages']),
    },
    {
        name: 'basic',
        displayName: 'Asasi',
        priceMAD: 4900,   // 49.00 MAD stored as centimes
        priceEUR: 499,    // 4.99 EUR stored as cents
        messagesPerConversation: 0,  // unlimited
        contractsPerMonth: 3,
        maxSavedChats: 0,            // unlimited
        features: JSON.stringify(['chat', 'blog', 'seo_pages', 'contract_builder', 'chat_history']),
    },
    {
        name: 'pro',
        displayName: 'Mihani',
        priceMAD: 14900,  // 149.00 MAD stored as centimes
        priceEUR: 1499,   // 14.99 EUR stored as cents
        messagesPerConversation: 0,  // unlimited
        contractsPerMonth: 0,        // unlimited
        maxSavedChats: 0,            // unlimited
        features: JSON.stringify([
            'chat', 'blog', 'seo_pages', 'contract_builder', 'chat_history',
            'file_uploads', 'priority_responses', 'legal_alerts',
        ]),
    },
    {
        name: 'enterprise',
        displayName: 'Mouassasa',
        priceMAD: 50000,  // 500.00 MAD minimum, stored as centimes
        priceEUR: 4999,   // 49.99 EUR minimum, stored as cents
        messagesPerConversation: 0,
        contractsPerMonth: 0,
        maxSavedChats: 0,
        features: JSON.stringify([
            'chat', 'blog', 'seo_pages', 'contract_builder', 'chat_history',
            'file_uploads', 'priority_responses', 'legal_alerts',
            'api_access', 'team_seats', 'sla',
        ]),
    },
];

async function main() {
    console.log('Seeding plans...');

    for (const plan of plans) {
        await prisma.plan.upsert({
            where: { name: plan.name },
            update: {
                displayName: plan.displayName,
                priceMAD: plan.priceMAD,
                priceEUR: plan.priceEUR,
                messagesPerConversation: plan.messagesPerConversation,
                contractsPerMonth: plan.contractsPerMonth,
                maxSavedChats: plan.maxSavedChats,
                features: plan.features,
            },
            create: plan,
        });
        console.log(`  ✓ Plan "${plan.name}" (${plan.displayName}) upserted`);
    }

    console.log('Seed complete.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
