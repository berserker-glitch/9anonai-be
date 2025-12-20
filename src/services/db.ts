import * as lancedb from "@lancedb/lancedb";
import { config } from "../config";
import path from "path";
import fs from "fs";

// Ensure data directory exists
const dbDir = path.resolve(process.cwd(), config.dbPath);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

let dbInstance: lancedb.Connection | null = null;

export const getDb = async () => {
    if (!dbInstance) {
        dbInstance = await lancedb.connect(config.dbPath);
    }
    return dbInstance;
};

export const getTable = async (tableName: string = config.tableName) => {
    const db = await getDb();
    // Check if table exists
    const tables = await db.tableNames();
    if (tables.includes(tableName)) {
        return await db.openTable(tableName);
    }
    return null;
};
