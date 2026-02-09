"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.embeddingCache = exports.EmbeddingCache = void 0;
const logger_1 = require("./logger");
const config_1 = require("../config");
/**
 * Simple LRU (Least Recently Used) Cache for Embeddings
 * Purpose: Reduce latency and API costs for repeated queries
 */
class EmbeddingCache {
    constructor(maxSize = config_1.config.embeddingCacheSize) {
        this.cache = new Map();
        this.items = [];
        this.maxSize = maxSize;
    }
    /**
     * Normalize key to ensure case-insensitivity and whitespace handling
     */
    normalizeKey(text) {
        return text.trim().toLowerCase().replace(/\s+/g, ' ');
    }
    /**
     * Get embedding from cache if exists
     */
    get(text) {
        const key = this.normalizeKey(text);
        if (this.cache.has(key)) {
            // Move to end of items array (mark as recently used)
            this.refresh(key);
            logger_1.logger.debug(`[CACHE] Hit for query: "${text.substring(0, 30)}..."`);
            return this.cache.get(key).embedding;
        }
        return null;
    }
    /**
     * Set embedding in cache
     */
    set(text, embedding) {
        const key = this.normalizeKey(text);
        // If already exists, just update timestamp
        if (this.cache.has(key)) {
            this.cache.set(key, { embedding, timestamp: Date.now() });
            this.refresh(key);
            return;
        }
        // Evict if full
        if (this.items.length >= this.maxSize) {
            const oldestKey = this.items.shift();
            if (oldestKey) {
                this.cache.delete(oldestKey);
            }
        }
        // Add new item
        this.cache.set(key, { embedding, timestamp: Date.now() });
        this.items.push(key);
    }
    /**
     * Move key to end of items list (most recently used)
     */
    refresh(key) {
        const index = this.items.indexOf(key);
        if (index > -1) {
            this.items.splice(index, 1);
            this.items.push(key);
        }
    }
    /**
     * Clear cache
     */
    clear() {
        this.cache.clear();
        this.items = [];
        logger_1.logger.info("[CACHE] Embedding cache cleared");
    }
    get size() {
        return this.cache.size;
    }
}
exports.EmbeddingCache = EmbeddingCache;
// Export singleton instance
exports.embeddingCache = new EmbeddingCache();
