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
        priceUSD: 0,
        messagesPerConversation: 15, // 0 = unlimited
        contractsPerMonth: 0,
        maxSavedChats: 10,           // 0 = unlimited
        features: JSON.stringify(['chat', 'blog', 'seo_pages']),
    },
    {
        name: 'basic',
        displayName: 'Asasi',
        priceUSD: 499,               // $4.99/mo stored as cents
        messagesPerConversation: 0,  // unlimited
        contractsPerMonth: 3,
        maxSavedChats: 0,            // unlimited
        features: JSON.stringify(['chat', 'blog', 'seo_pages', 'contract_builder', 'chat_history']),
    },
    {
        name: 'pro',
        displayName: 'Mihani',
        priceUSD: 1499,              // $14.99/mo stored as cents
        messagesPerConversation: 0,  // unlimited
        contractsPerMonth: 0,        // unlimited
        maxSavedChats: 0,            // unlimited
        features: JSON.stringify([
            'chat', 'blog', 'seo_pages', 'contract_builder', 'chat_history',
            'file_uploads', 'priority_responses',
        ]),
    },
    {
        name: 'enterprise',
        displayName: 'Mouassasa',
        priceUSD: 0,                 // custom pricing — handled manually
        messagesPerConversation: 0,
        contractsPerMonth: 0,
        maxSavedChats: 0,
        features: JSON.stringify([
            'chat', 'blog', 'seo_pages', 'contract_builder', 'chat_history',
            'file_uploads', 'priority_responses', 'api_access', 'team_seats', 'sla',
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
                priceUSD: plan.priceUSD,
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
