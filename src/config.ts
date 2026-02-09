import dotenv from 'dotenv';
dotenv.config();

// Validate required environment variables
if (!process.env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY environment variable is required");
}

export const config = {
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterBaseUrl: "https://openrouter.ai/api/v1",
    embeddingModel: "text-embedding-3-small",
    embeddingModelName: "openai/text-embedding-3-small",
    dbPath: "data/lancedb_store",
    tableName: "moroccan_laws",

    // Retrieval Tuning
    minRelevanceScore: 0.35,      // Minimum similarity score to be considered relevant
    maxContextTokens: 3500,       // Max tokens for LLM context (approx)
    embeddingCacheSize: 500,      // Number of embeddings to keep in memory
    enableFTS: true,              // Enable Full-Text Search hybrid retrieval
    hybridAlpha: 0.7,             // Weight for vector search (0.7 vector, 0.3 keyword)
};
