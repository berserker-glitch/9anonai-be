"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchLegalDocs = void 0;
const db_1 = require("./db");
const bi_1 = require("./bi");
const config_1 = require("../config");
const logger_1 = require("./logger");
/**
 * Search legal documents with optional category filtering
 * Implements relevance thresholding and SQL injection protection
 */
const searchLegalDocs = async (query, limit = 5, options = {}) => {
    const startTime = Date.now();
    try {
        const table = await (0, db_1.getTable)();
        if (!table) {
            logger_1.logger.warn("[RETRIEVER] Table not found, returning empty results.");
            return [];
        }
        const queryEmbedding = await (0, bi_1.getEmbedding)(query);
        // Build search query
        let search = table.search(queryEmbedding);
        // Apply category filter if provided
        if (options.categories && options.categories.length > 0) {
            // Create filter expression for categories with SQL injection protection
            // We escape single quotes by doubling them
            const validCategories = options.categories.filter(c => c && typeof c === 'string');
            if (validCategories.length > 0) {
                // Use LIKE for fuzzy matching of category folders
                const categoryConditions = validCategories
                    .map(cat => `category LIKE '%${cat.replace(/'/g, "''")}%'`)
                    .join(" OR ");
                search = search.where(categoryConditions);
            }
        }
        // Fetch slightly more than limit to allow for post-filtering
        const fetchLimit = Math.ceil(limit * 1.5);
        const results = await search.limit(fetchLimit).toArray();
        // Process and Filter Results
        const minScore = options.minScore ?? config_1.config.minRelevanceScore;
        const processedResults = results
            .map((r, idx) => {
            // Calculate similarity score from L2 (Euclidean) distance
            // LanceDB uses L2 distance by default: 0 = identical, higher = less similar
            // Convert to 0-1 similarity: 1/(1+d) maps [0,inf) -> (0,1]
            const distance = r._distance || 0;
            const score = 1 / (1 + distance);
            return {
                id: r.id || `doc_${idx}`,
                text: r.text,
                source_file: r.source_file,
                category: r.category,
                subcategory: r.subcategory,
                document_name: r.document_name,
                document_type: r.document_type,
                score: Math.max(0, score), // Ensure no negative scores
            };
        })
            .filter(doc => doc.score >= minScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
        const duration = Date.now() - startTime;
        // Log outcome
        if (processedResults.length > 0) {
            logger_1.logger.info(`[RETRIEVER] Found ${processedResults.length} docs for "${query.substring(0, 30)}..." in ${duration}ms (Top Score: ${processedResults[0].score.toFixed(2)})`);
        }
        else {
            logger_1.logger.warn(`[RETRIEVER] No relevant docs found for "${query.substring(0, 30)}..." (Threshold: ${minScore})`);
        }
        return processedResults;
    }
    catch (error) {
        logger_1.logger.error("[RETRIEVER] Error searching legal docs:", { error, query });
        return [];
    }
};
exports.searchLegalDocs = searchLegalDocs;
