import { getTable } from "./db";
import { getEmbedding } from "./bi";
import { config } from "../config";
import { logger } from "./logger";

export interface LegalDocument {
    id?: string;
    text: string;
    source_file: string;
    category: string;
    subcategory?: string;
    score?: number;
    document_name: string;
    document_type?: string;
}

export interface SearchOptions {
    categories?: string[];  // Filter by categories
    minScore?: number;      // Override minimum relevance score
    includeMetadata?: boolean;
}

/**
 * Search legal documents with optional category filtering
 * Implements relevance thresholding and SQL injection protection
 */
export const searchLegalDocs = async (
    query: string,
    limit: number = 5,
    options: SearchOptions = {}
): Promise<LegalDocument[]> => {
    const startTime = Date.now();
    try {
        const table = await getTable();
        if (!table) {
            logger.warn("[RETRIEVER] Table not found, returning empty results.");
            return [];
        }

        const queryEmbedding = await getEmbedding(query);

        // Build search query
        let search = table.search(queryEmbedding);

        // Apply category filter if provided
        if (options.categories && options.categories.length > 0) {
            // Create filter expression for categories with SQL injection protection
            // We escape single quotes by doubling them
            const validCategories = options.categories.filter(c => c && typeof c === 'string');

            if (validCategories.length > 0) {
                const categoryConditions = validCategories
                    .map(cat => `category = '${cat.replace(/'/g, "''")}'`) // Exact match is better than LIKE for categories
                    .join(" OR ");

                search = search.where(categoryConditions);
            }
        }

        // Fetch slightly more than limit to allow for post-filtering
        const fetchLimit = Math.ceil(limit * 1.5);
        const results = await search.limit(fetchLimit).toArray();

        // Process and Filter Results
        const minScore = options.minScore ?? config.minRelevanceScore;

        const processedResults = results
            .map((r: any, idx: number) => {
                // Calculate similarity score (assumes cosine distance)
                // LanceDB distance: 0 = identical, 1 = opposite/orthogonal usually for normalized vectors
                // Similarity = 1 - distance
                const distance = r._distance || 0;
                const score = 1 - distance;

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
            logger.info(`[RETRIEVER] Found ${processedResults.length} docs for "${query.substring(0, 30)}..." in ${duration}ms (Top Score: ${processedResults[0].score.toFixed(2)})`);
        } else {
            logger.warn(`[RETRIEVER] No relevant docs found for "${query.substring(0, 30)}..." (Threshold: ${minScore})`);
        }

        return processedResults;

    } catch (error) {
        logger.error("[RETRIEVER] Error searching legal docs:", { error, query });
        return [];
    }
};
