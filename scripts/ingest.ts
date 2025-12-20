
import fs from "fs";
import path from "path";
import readline from "readline";
import { getDb, getTable } from "../src/services/db";
import { getEmbeddingsBatch } from "../src/services/bi";
import { config } from "../src/config";
import * as lancedb from "@lancedb/lancedb";

const DATA_FILE = path.resolve(__dirname, "../data/processed/chunks.jsonl");

interface Chunk {
    id: string;
    text: string;
    chunk_index: number;
    total_chunks: number;
    source_file: string;
    category: string;
    subcategory: string;
    document_type: string;
    document_name: string;
    [key: string]: any;
}

const BATCH_SIZE = 20; // OpenRouter limits might apply, keep batch size reasonable

async function ingest() {
    console.log("🚀 Starting ingestion process...");
    console.log(`📂 Reading from: ${DATA_FILE}`);

    if (!fs.existsSync(DATA_FILE)) {
        console.error("❌ Data file not found!");
        process.exit(1);
    }

    const db = await getDb();
    const existingTables = await db.tableNames();

    // Define Schema implicitly by data or explicitly if needed.
    // LanceDB creates schema from first batch data usually.

    let table: lancedb.Table | null = null;

    if (existingTables.includes(config.tableName)) {
        console.log(`🗑️ Table '${config.tableName}' exists. Dropping it to start fresh...`);
        await db.dropTable(config.tableName);
    }

    const fileStream = fs.createReadStream(DATA_FILE);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    let batch: Chunk[] = [];
    let totalProcessed = 0;

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const chunk: Chunk = JSON.parse(line);
            batch.push(chunk);

            if (batch.length >= BATCH_SIZE) {
                await processBatch(db, batch);
                totalProcessed += batch.length;
                console.log(`✅ Processed ${totalProcessed} chunks...`);
                batch = []; // Clear batch
            }
        } catch (e) {
            console.error("⚠️ Failed to parse line:", line.substring(0, 50) + "...", e);
        }
    }

    // Process remaining
    if (batch.length > 0) {
        await processBatch(db, batch);
        totalProcessed += batch.length;
    }

    console.log(`🎉 Ingestion complete! Total chunks: ${totalProcessed}`);
}

async function processBatch(db: lancedb.Connection, batch: Chunk[]) {
    // 1. Generate Embeddings
    const texts = batch.map((c) => c.text);

    try {
        // Add delay to avoid rate limits?
        const embeddings = await getEmbeddingsBatch(texts);

        // 2. Prepare Data for LanceDB
        // LanceDB expects objects with 'vector' field
        const data = batch.map((chunk, i) => ({
            ...chunk,
            vector: embeddings[i],
        }));

        // 3. Write to DB
        const existingTables = await db.tableNames();
        if (!existingTables.includes(config.tableName)) {
            // Create table with first batch
            await db.createTable(config.tableName, data);
        } else {
            const table = await db.openTable(config.tableName);
            await table.add(data);
        }
    } catch (error) {
        console.error("❌ Error processing batch, skipping...", error);
        // In a real prod env, we might retry or DLQ
    }
}

// Run
ingest().catch(console.error);
