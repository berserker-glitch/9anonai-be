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
};
