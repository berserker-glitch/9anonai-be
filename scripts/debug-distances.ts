/**
 * Quick debug: test with NO category filter to confirm scoring works
 */
import { searchLegalDocs } from "../src/services/retriever";

async function debug() {
    const query = "ما هي فترة العدة للمطلقة؟";

    console.log("=== Test 1: NO FILTER ===");
    const results1 = await searchLegalDocs(query, 5);
    console.log(`Found: ${results1.length}`);
    results1.forEach((r, i) => {
        console.log(`  ${i + 1}. [${r.score?.toFixed(3)}] ${r.document_name} | ${r.category}`);
    });

    console.log("\n=== Test 2: WITH CATEGORY FILTER (Arabic) ===");
    const results2 = await searchLegalDocs(query, 5, {
        categories: ["أسرة", "زواج", "طلاق"]
    });
    console.log(`Found: ${results2.length}`);
    results2.forEach((r, i) => {
        console.log(`  ${i + 1}. [${r.score?.toFixed(3)}] ${r.document_name} | ${r.category}`);
    });

    console.log("\n=== Test 3: WITH BROADER FILTER ===");
    const results3 = await searchLegalDocs(query, 5, {
        categories: ["الأسرية"]
    });
    console.log(`Found: ${results3.length}`);
    results3.forEach((r, i) => {
        console.log(`  ${i + 1}. [${r.score?.toFixed(3)}] ${r.document_name} | ${r.category}`);
    });
}

debug().catch(console.error);
