"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchLegalDocs = void 0;
const db_1 = require("./db");
const bi_1 = require("./bi");
/**
 * Search legal documents with optional category filtering
 */
const searchLegalDocs = async (query, limit = 5, options = {}) => {
    try {
        const table = await (0, db_1.getTable)();
        if (!table) {
            console.warn("Table not found, returning empty results.");
            return [];
        }
        const queryEmbedding = await (0, bi_1.getEmbedding)(query);
        // Build search query
        let search = table.search(queryEmbedding);
        // Apply category filter if provided
        if (options.categories && options.categories.length > 0) {
            // Create filter expression for categories
            // LanceDB uses SQL-like where clauses
            const categoryConditions = options.categories
                .map(cat => `category LIKE '%${cat}%'`)
                .join(" OR ");
            search = search.where(categoryConditions);
        }
        const results = await search.limit(limit).toArray();
        return results.map((r, idx) => ({
            id: r.id || `doc_${idx}`,
            text: r.text,
            source_file: r.source_file,
            category: r.category,
            subcategory: r.subcategory,
            score: r._distance ? 1 / (1 + r._distance) : 0, // Convert distance to similarity score
            document_name: r.document_name
        }));
    }
    catch (error) {
        console.error("Error searching legal docs:", error);
        return [];
    }
};
exports.searchLegalDocs = searchLegalDocs;
