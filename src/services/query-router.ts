import { Intent } from "./intent-classifier";
import { searchLegalDocs, LegalDocument } from "./retriever";

// Map legal domains to database categories
const DOMAIN_TO_CATEGORIES: Record<string, string[]> = {
    family: ["famille", "statut personnel", "mariage", "divorce", "héritage"],
    criminal: ["pénal", "criminel", "infractions", "sanctions"],
    business: ["commercial", "société", "entreprise", "commerce"],
    labor: ["travail", "emploi", "sécurité sociale", "protection sociale"],
    property: ["immobilier", "foncier", "propriété", "urbanisme"],
    administrative: ["administratif", "fonction publique", "état"],
    civil: ["civil", "obligations", "contrats"],
    constitutional: ["constitution", "libertés", "droits fondamentaux"],
    tax: ["fiscal", "impôts", "douane", "TVA"],
    other: [], // No filter, search all
};

export interface RouteResult {
    needsRAG: boolean;
    sources: LegalDocument[];
    searchedCategories?: string[];
}

/**
 * Routes the query to appropriate retrieval strategy based on intent
 */
export async function routeQuery(intent: Intent, query: string): Promise<RouteResult> {
    // Casual queries don't need RAG
    if (intent.type === "casual") {
        return { needsRAG: false, sources: [] };
    }

    // Legal query - perform retrieval
    const domain = intent.domain;
    const categoryFilter = DOMAIN_TO_CATEGORIES[domain] || [];

    try {
        // Search with domain-specific filtering if available
        let results: LegalDocument[];

        if (categoryFilter.length > 0) {
            // Domain-specific search
            results = await searchLegalDocs(query, 8, { categories: categoryFilter });

            // If domain search returns few results, fallback to general search
            if (results.length < 3) {
                const generalResults = await searchLegalDocs(query, 5);
                // Combine and deduplicate
                const existingIds = new Set(results.map(r => r.id));
                for (const r of generalResults) {
                    if (!existingIds.has(r.id)) {
                        results.push(r);
                    }
                }
            }
        } else {
            // General search (no domain filter)
            results = await searchLegalDocs(query, 8);
        }

        // Re-rank by relevance (simple score-based for now)
        results.sort((a, b) => (b.score || 0) - (a.score || 0));

        // Take top 5 most relevant
        const topResults = results.slice(0, 5);

        return {
            needsRAG: true,
            sources: topResults,
            searchedCategories: categoryFilter,
        };

    } catch (error) {
        console.error("Query routing error:", error);
        return { needsRAG: true, sources: [] };
    }
}

/**
 * Builds an optimal context string for the LLM
 */
export function buildContext(sources: LegalDocument[]): string {
    if (sources.length === 0) {
        return "No specific legal documents found in the database.";
    }

    return sources.map((doc, i) => {
        return `[Source ${i + 1}]: ${doc.document_name}
Category: ${doc.category}${doc.subcategory ? ` > ${doc.subcategory}` : ""}
---
${doc.text}
---`;
    }).join("\n\n");
}
