import { getTable } from "./db";
import { getEmbedding } from "./bi";

export interface LegalDocument {
    id?: string;
    text: string;
    source_file: string;
    category: string;
    subcategory?: string;
    score?: number;
    document_name: string;
}

export interface SearchOptions {
    categories?: string[];  // Filter by categories
}

/**
 * Search legal documents with optional category filtering
 */
export const searchLegalDocs = async (
    query: string,
    limit: number = 5,
    options: SearchOptions = {}
): Promise<LegalDocument[]> => {
    try {
        const table = await getTable();
        if (!table) {
            console.warn("Table not found, returning empty results.");
            return [];
        }

        const queryEmbedding = await getEmbedding(query);

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

        return results.map((r: any, idx: number) => ({
            id: r.id || `doc_${idx}`,
            text: r.text,
            source_file: r.source_file,
            category: r.category,
            subcategory: r.subcategory,
            score: r._distance ? 1 / (1 + r._distance) : 0, // Convert distance to similarity score
            document_name: r.document_name
        }));
    } catch (error) {
        console.error("Error searching legal docs:", error);
        return [];
    }
};
