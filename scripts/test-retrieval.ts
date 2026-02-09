
import { routeQuery } from "../src/services/query-router";
import { classifyIntent } from "../src/services/intent-classifier";
import { embeddingCache } from "../src/services/embedding-cache";
import { logger } from "../src/services/logger";

// Mute logger for cleaner output, or keep it to see logs? 
// Let's keep it but maybe we only want to see the final result.

async function testQuery(query: string) {
    console.log(`\n\n════════════════════════════════════════════════════`);
    console.log(`❓ Query: "${query}"`);
    console.log(`════════════════════════════════════════════════════`);

    const start = Date.now();

    // 1. Intent
    console.log("... Classifying intent ...");
    const intent = await classifyIntent(query);
    console.log(`🔹 Intent: ${JSON.stringify(intent)}`);

    // 2. Route & Retrieve
    console.log("... Routing & Retrieving ...");
    const result = await routeQuery(intent, query);

    const duration = Date.now() - start;

    console.log(`\n✅ Result in ${duration}ms`);
    console.log(`📊 Confidence: ${result.confidenceLevel?.toUpperCase()}`);
    console.log(`📚 Sources Found: ${result.sources.length}`);

    result.sources.forEach((s, i) => {
        console.log(`   ${i + 1}. [${(s.score || 0).toFixed(2)}] ${s.document_name} (${s.category})`);
    });

    if (result.sources.length > 0) {
        console.log(`\n📄 Top Source Preview:\n${result.sources[0].text.substring(0, 150)}...`);
    } else {
        console.log("\n❌ No sources found (likely filtered by threshold).");
    }
}

async function main() {
    try {
        // Test 1: General Greeting (Should result in no RAG)
        await testQuery("Salam, ca va?");

        // Test 2: Specific Legal Question (Should hit RAG)
        await testQuery("ما هي فترة العدة للمطلقة؟"); // Divorce waiting period

        // Test 3: Same Question (Should be faster due to cache)
        console.log("\n🔄 REPEATING QUERY (Testing Cache)...");
        await testQuery("ما هي فترة العدة للمطلقة؟");

        // Test 4: Nonsense/ unrelated (Should yield low confidence/no results)
        await testQuery("كيف تطبخ الطاجين المغربي؟"); // How to cook Tagine

    } catch (error) {
        console.error("Test failed:", error);
    }
}

main();
