"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeQuery = routeQuery;
exports.buildContext = buildContext;
const retriever_1 = require("./retriever");
const logger_1 = require("./logger");
const config_1 = require("../config");
// Map legal domains to actual database category names
// These MUST match the category values stored in LanceDB (from the data/processed/text folder structure)
const DOMAIN_TO_CATEGORIES = {
    family: ["الأسرية", "famille", "statut personnel"],
    criminal: ["الجنائية", "الأمنية", "pénal", "criminel"],
    business: ["التجارية", "الاستثمار", "commercial", "société"],
    labor: ["الاجتماعية", "الوظيفة العمومية", "travail", "emploi"],
    property: ["العقارية", "الكرائية", "immobilier", "foncier"],
    administrative: ["الإدارية", "الجماعات الترابية", "administratif"],
    civil: ["المدنية", "civil", "obligations"],
    constitutional: ["الدستورية", "التشريعية", "التنفيذية", "القضائية", "constitution"],
    tax: ["الجبائية", "المالية", "fiscal", "impôts"],
    other: [], // No filter, search all
};
/**
 * Routes the query to appropriate retrieval strategy based on intent
 */
async function routeQuery(intent, query) {
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
    logger_1.logger.info(`[ROUTER] Routing "${query}" (Domain: ${domain}, Complex: ${isComplex})`);
    try {
        // Search with domain-specific filtering if available
        let results;
        if (categoryFilter.length > 0) {
            // Domain-specific search
            results = await (0, retriever_1.searchLegalDocs)(query, baseLimit, { categories: categoryFilter });
            // If domain search returns few results, fallback to general search
            if (results.length < (isComplex ? 4 : 2)) {
                logger_1.logger.info("[ROUTER] Low domain results, falling back to general search");
                const generalResults = await (0, retriever_1.searchLegalDocs)(query, baseLimit);
                // Combine and deduplicate
                const existingIds = new Set(results.map(r => r.id));
                for (const r of generalResults) {
                    if (!existingIds.has(r.id)) {
                        results.push(r);
                        existingIds.add(r.id);
                    }
                }
            }
        }
        else {
            // General search (no domain filter)
            results = await (0, retriever_1.searchLegalDocs)(query, baseLimit);
        }
        // Re-rank and limit
        // Using the scores from retriever (already sorted), but we can add secondary logic here
        // For now, just slice to the final context limit
        const finalResults = results.slice(0, isComplex ? 6 : 4);
        // Determine retrieval confidence based on L2-derived scores
        // Observed range: 0.44-0.49 for good results with text-embedding-3-small
        let confidence = "none";
        if (finalResults.length > 0) {
            const avgScore = finalResults.reduce((sum, r) => sum + (r.score || 0), 0) / finalResults.length;
            if (avgScore > 0.47)
                confidence = "high";
            else if (avgScore > 0.43)
                confidence = "medium";
            else
                confidence = "low";
        }
        logger_1.logger.info(`[ROUTER] Completed in ${Date.now() - start}ms. Sources: ${finalResults.length}. Confidence: ${confidence}`);
        return {
            needsRAG: true,
            sources: finalResults,
            searchedCategories: categoryFilter,
            confidenceLevel: confidence
        };
    }
    catch (error) {
        logger_1.logger.error("[ROUTER] Error routing query:", { error });
        return { needsRAG: true, sources: [] };
    }
}
/**
 * Builds an optimal context string for the LLM
 */
function buildContext(sources) {
    if (sources.length === 0) {
        return "No specific legal documents found in the database for this query.";
    }
    let context = "";
    let currentTokens = 0;
    // Rough estimate: 4 chars per token for Arabic/French mixed usage might be optimistic, 
    // but safe enough for truncation
    const MAX_CHARS = config_1.config.maxContextTokens * 3.5;
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
            logger_1.logger.info(`[CTX] Context limit reached at source ${i + 1}`);
            break;
        }
        context += entry + "\n";
    }
    return context;
}
