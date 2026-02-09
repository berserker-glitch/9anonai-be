"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmbeddingsBatch = exports.getEmbedding = void 0;
const openai_1 = __importDefault(require("openai"));
const config_1 = require("../config");
const client = new openai_1.default({
    baseURL: config_1.config.openRouterBaseUrl,
    apiKey: config_1.config.openRouterApiKey,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/moroccan-legal-ai",
        "X-Title": "Moroccan Legal AI Backend",
    },
});
const embedding_cache_1 = require("./embedding-cache");
const logger_1 = require("./logger");
const getEmbedding = async (text) => {
    // Check cache first
    const cached = embedding_cache_1.embeddingCache.get(text);
    if (cached) {
        return cached;
    }
    try {
        const response = await client.embeddings.create({
            model: config_1.config.embeddingModelName,
            input: text,
        });
        const embedding = response.data[0].embedding;
        // Cache the result
        embedding_cache_1.embeddingCache.set(text, embedding);
        return embedding;
    }
    catch (error) {
        logger_1.logger.error("Error generating embedding:", { error });
        throw error;
    }
};
exports.getEmbedding = getEmbedding;
const getEmbeddingsBatch = async (texts) => {
    try {
        const response = await client.embeddings.create({
            model: config_1.config.embeddingModelName,
            input: texts,
        });
        // Sort by index to maintain order if necessary, though API usually preserves it.
        return response.data.map(d => d.embedding);
    }
    catch (error) {
        console.error("Error generating batched embeddings:", error);
        throw error;
    }
};
exports.getEmbeddingsBatch = getEmbeddingsBatch;
