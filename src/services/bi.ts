import OpenAI from "openai";
import { config } from "../config";

const client = new OpenAI({
    baseURL: config.openRouterBaseUrl,
    apiKey: config.openRouterApiKey,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/moroccan-legal-ai",
        "X-Title": "Moroccan Legal AI Backend",
    },
});

import { embeddingCache } from "./embedding-cache";
import { logger } from "./logger";

export const getEmbedding = async (text: string): Promise<number[]> => {
    // Check cache first
    const cached = embeddingCache.get(text);
    if (cached) {
        return cached;
    }

    try {
        const response = await client.embeddings.create({
            model: config.embeddingModelName,
            input: text,
        });
        const embedding = response.data[0].embedding;

        // Cache the result
        embeddingCache.set(text, embedding);

        return embedding;
    } catch (error) {
        logger.error("Error generating embedding:", { error });
        throw error;
    }
};

export const getEmbeddingsBatch = async (texts: string[]): Promise<number[][]> => {
    try {
        const response = await client.embeddings.create({
            model: config.embeddingModelName,
            input: texts,
        });
        // Sort by index to maintain order if necessary, though API usually preserves it.
        return response.data.map(d => d.embedding);
    } catch (error) {
        console.error("Error generating batched embeddings:", error);
        throw error;
    }
}
