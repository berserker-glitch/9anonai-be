/**
 * Quick debug script to inspect raw LanceDB distances
 */
import { getTable } from "../src/services/db";
import { getEmbedding } from "../src/services/bi";

async function debug() {
    const query = "ما هي شروط الطلاق في القانون المغربي؟";

    const table = await getTable();
    if (!table) {
        console.log("No table found!");
        return;
    }

    const embedding = await getEmbedding(query);
    const results = await table.search(embedding).limit(5).toArray();

    console.log("\n=== RAW LANCEDB RESULTS ===\n");
    results.forEach((r: any, i: number) => {
        console.log(`Result ${i + 1}:`);
        console.log(`  _distance: ${r._distance}`);
        console.log(`  1/(1+d):   ${1 / (1 + r._distance)}`);
        console.log(`  1-d:       ${1 - r._distance}`);
        console.log(`  category:  ${r.category}`);
        console.log(`  doc_name:  ${r.document_name}`);
        console.log(`  text:      ${(r.text || '').substring(0, 100)}...`);
        console.log();
    });
}

debug().catch(console.error);
