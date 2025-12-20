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

export const getEmbedding = async (text: string): Promise<number[]> => {
    try {
        const response = await client.embeddings.create({
            model: config.embeddingModelName,
            input: text,
        });
        return response.data[0].embedding;
    } catch (error) {
        console.error("Error generating embedding:", error);
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
