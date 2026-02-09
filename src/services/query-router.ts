import { Intent } from "./intent-classifier";
import { searchLegalDocs, LegalDocument } from "./retriever";
import { logger } from "./logger";
import { config } from "../config";

// Map legal domains to database categories
const DOMAIN_TO_CATEGORIES: Record<string, string[]> = {
    family: ["famille", "statut personnel", "mariage", "divorce", "héritage", "أسرة", "زواج", "طلاق"],
    criminal: ["pénal", "criminel", "infractions", "sanctions", "جنائي", "عقوبات"],
    business: ["commercial", "société", "entreprise", "commerce", "تجاري", "شركات"],
    labor: ["travail", "emploi", "sécurité sociale", "protection sociale", "شغل", "ضمان اجتماعي"],
    property: ["immobilier", "foncier", "propriété", "urbanisme", "عقار", "تحفيظ"],
    administrative: ["administratif", "fonction publique", "état", "إداري", "وظيفة عمومية"],
    civil: ["civil", "obligations", "contrats", "مدني", "التزامات"],
    constitutional: ["constitution", "libertés", "droits fondamentaux", "دستور"],
    tax: ["fiscal", "impôts", "douane", "TVA", "ضريبة", "جبايات"],
    other: [], // No filter, search all
};

export interface RouteResult {
    needsRAG: boolean;
    sources: LegalDocument[];
    searchedCategories?: string[];
    confidenceLevel?: "high" | "medium" | "low" | "none";
}

/**
 * Routes the query to appropriate retrieval strategy based on intent
 */
export async function routeQuery(intent: Intent, query: string): Promise<RouteResult> {
    const start = Date.now();

    // Casual queries don't need RAG
    if (intent.type === "casual") {
        return { needsRAG: false, sources: [] };
    }

    // Legal query - perform retrieval
    const domain = intent.domain;
    const categoryFilter = DOMAIN_TO_CATEGORIES[domain] || [];

    // Adaptive retrieval configuration
    const isComplex = intent.complexity === "complex";
    const baseLimit = isComplex ? 8 : 5;

    logger.info(`[ROUTER] Routing "${query}" (Domain: ${domain}, Complex: ${isComplex})`);

    try {
        // Search with domain-specific filtering if available
        let results: LegalDocument[];

        if (categoryFilter.length > 0) {
            // Domain-specific search
            results = await searchLegalDocs(query, baseLimit, { categories: categoryFilter });

            // If domain search returns few results, fallback to general search
            if (results.length < (isComplex ? 4 : 2)) {
                logger.info("[ROUTER] Low domain results, falling back to general search");
                const generalResults = await searchLegalDocs(query, baseLimit);

                // Combine and deduplicate
                const existingIds = new Set(results.map(r => r.id));
                for (const r of generalResults) {
                    if (!existingIds.has(r.id)) {
                        results.push(r);
                        existingIds.add(r.id!);
                    }
                }
            }
        } else {
            // General search (no domain filter)
            results = await searchLegalDocs(query, baseLimit);
        }

        // Re-rank and limit
        // Using the scores from retriever (already sorted), but we can add secondary logic here
        // For now, just slice to the final context limit
        const finalResults = results.slice(0, isComplex ? 6 : 4);

        // Determine retrieval confidence based on L2-derived scores
        // For 1/(1+d) with L2 distance: 0.49+ = good, 0.45+ = decent, 0.40+ = marginal
        let confidence: "high" | "medium" | "low" | "none" = "none";
        if (finalResults.length > 0) {
            const avgScore = finalResults.reduce((sum, r) => sum + (r.score || 0), 0) / finalResults.length;
            if (avgScore > 0.49) confidence = "high";
            else if (avgScore > 0.45) confidence = "medium";
            else confidence = "low";
        }

        logger.info(`[ROUTER] Completed in ${Date.now() - start}ms. Sources: ${finalResults.length}. Confidence: ${confidence}`);

        return {
            needsRAG: true,
            sources: finalResults,
            searchedCategories: categoryFilter,
            confidenceLevel: confidence
        };

    } catch (error) {
        logger.error("[ROUTER] Error routing query:", { error });
        return { needsRAG: true, sources: [] };
    }
}

/**
 * Builds an optimal context string for the LLM
 */
export function buildContext(sources: LegalDocument[]): string {
    if (sources.length === 0) {
        return "No specific legal documents found in the database for this query.";
    }

    let context = "";
    let currentTokens = 0;
    // Rough estimate: 4 chars per token for Arabic/French mixed usage might be optimistic, 
    // but safe enough for truncation
    const MAX_CHARS = config.maxContextTokens * 3.5;

    for (let i = 0; i < sources.length; i++) {
        const doc = sources[i];

        const entry = `[Source ${i + 1}]: ${doc.document_name} (${doc.document_type || 'Legal Text'})
Category: ${doc.category}${doc.subcategory ? ` > ${doc.subcategory}` : ""}
Relevance: ${(doc.score || 0).toFixed(2)}
---
${doc.text}
---
`;

        if (context.length + entry.length > MAX_CHARS) {
            logger.info(`[CTX] Context limit reached at source ${i + 1}`);
            break;
        }

        context += entry + "\n";
    }

    return context;
}
