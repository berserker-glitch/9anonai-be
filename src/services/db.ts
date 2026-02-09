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

import { logger } from "./logger";

export const getDb = async () => {
    if (!dbInstance) {
        logger.info(`[DB] Connecting to LanceDB at ${config.dbPath}`);
        dbInstance = await lancedb.connect(config.dbPath);
    }
    return dbInstance;
};

export const getTable = async (tableName: string = config.tableName) => {
    try {
        const db = await getDb();
        const tables = await db.tableNames();

        if (tables.includes(tableName)) {
            // logger.debug(`[DB] Accessed table: ${tableName}`);
            return await db.openTable(tableName);
        }

        logger.warn(`[DB] Table not found: ${tableName}`);
        return null;
    } catch (error) {
        logger.error(`[DB] Error accessing table ${tableName}:`, { error });
        throw error;
    }
};
