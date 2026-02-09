import { logger } from "./logger";
import { config } from "../config";

interface CacheEntry {
    embedding: number[];
    timestamp: number;
}

/**
 * Simple LRU (Least Recently Used) Cache for Embeddings
 * Purpose: Reduce latency and API costs for repeated queries
 */
export class EmbeddingCache {
    private cache: Map<string, CacheEntry>;
    private maxSize: number;
    private items: string[]; // Keep track of order for LRU eviction

    constructor(maxSize: number = config.embeddingCacheSize) {
        this.cache = new Map();
        this.items = [];
        this.maxSize = maxSize;
    }

    /**
     * Normalize key to ensure case-insensitivity and whitespace handling
     */
    private normalizeKey(text: string): string {
        return text.trim().toLowerCase().replace(/\s+/g, ' ');
    }

    /**
     * Get embedding from cache if exists
     */
    public get(text: string): number[] | null {
        const key = this.normalizeKey(text);

        if (this.cache.has(key)) {
            // Move to end of items array (mark as recently used)
            this.refresh(key);

            logger.debug(`[CACHE] Hit for query: "${text.substring(0, 30)}..."`);
            return this.cache.get(key)!.embedding;
        }

        return null;
    }

    /**
     * Set embedding in cache
     */
    public set(text: string, embedding: number[]): void {
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
    private refresh(key: string): void {
        const index = this.items.indexOf(key);
        if (index > -1) {
            this.items.splice(index, 1);
            this.items.push(key);
        }
    }

    /**
     * Clear cache
     */
    public clear(): void {
        this.cache.clear();
        this.items = [];
        logger.info("[CACHE] Embedding cache cleared");
    }

    public get size(): number {
        return this.cache.size;
    }
}

// Export singleton instance
export const embeddingCache = new EmbeddingCache();
