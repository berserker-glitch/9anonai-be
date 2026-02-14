import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function verifyPersistence() {
    console.log("🔍 Starting persistence verification...");

    try {
        // 1. Check for recent messages
        const recentMessages = await prisma.message.findMany({
            orderBy: { createdAt: "desc" },
            take: 5,
            include: { chat: true }
        });

        if (recentMessages.length === 0) {
            console.log("ℹ️ No messages found in the database. Please send a message in the UI first.");
            return;
        }

        console.log(`✅ Found ${recentMessages.length} recent messages.`);

        // 2. Check for double stringification in sources
        for (const msg of recentMessages) {
            console.log(`\n📄 Message ID: ${msg.id} | Role: ${msg.role}`);
            console.log(`   Chat ID: ${msg.chatId} | Title: ${msg.chat.title}`);

            if (msg.sources) {
                try {
                    const parsed = JSON.parse(msg.sources);
                    if (typeof parsed === 'string') {
                        console.error(`   ❌ FAIL: Sources are double-stringified (parsed result is a string: "${parsed.substring(0, 50)}...")`);
                    } else if (Array.isArray(parsed)) {
                        console.log(`   ✅ PASS: Sources are correctly stringified once (parsed as array with ${parsed.length} items)`);
                    } else {
                        console.log(`   ⚠️ WARN: Sources parsed as unexpected type: ${typeof parsed}`);
                    }
                } catch (e) {
                    console.error(`   ❌ FAIL: Failed to parse sources JSON: ${e instanceof Error ? e.message : String(e)}`);
                }
            } else {
                console.log(`   ℹ️ No sources for this message.`);
            }
        }

    } catch (error) {
        console.error("❌ Verification failed:", error);
    } finally {
        await prisma.$disconnect();
    }
}

verifyPersistence();
