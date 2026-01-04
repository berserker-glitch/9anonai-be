"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyIntent = classifyIntent;
exports.isObviouslyCasual = isObviouslyCasual;
const openai_1 = __importDefault(require("openai"));
const config_1 = require("../config");
const client = new openai_1.default({
    baseURL: config_1.config.openRouterBaseUrl,
    apiKey: config_1.config.openRouterApiKey,
});
/**
 * LLM-based Intent Classifier
 * Determines if the query is casual conversation or a legal question
 */
async function classifyIntent(query) {
    try {
        const response = await client.chat.completions.create({
            model: "google/gemini-2.0-flash-001",
            messages: [
                {
                    role: "system",
                    content: `You are an intent classifier for a Moroccan legal AI. Analyze the user's query and classify it.

Return ONLY valid JSON in this exact format:

For casual queries (greetings, "who are you", "thanks", small talk):
{"type":"casual","subtype":"greeting"} or {"subtype":"identity"} or {"subtype":"chitchat"} or {"subtype":"thanks"}

For legal queries (any question about law, rights, procedures, documents):
{"type":"legal","domain":"<domain>","complexity":"<simple|complex>"}

Legal domains: family, criminal, business, labor, property, administrative, civil, constitutional, tax, other

Examples:
- "hi" → {"type":"casual","subtype":"greeting"}
- "who are you" → {"type":"casual","subtype":"identity"}
- "شكرا" → {"type":"casual","subtype":"thanks"}
- "ما هي حقوق العامل" → {"type":"legal","domain":"labor","complexity":"simple"}
- "كيف أسجل شركة" → {"type":"legal","domain":"business","complexity":"complex"}
- "divorce procedure" → {"type":"legal","domain":"family","complexity":"complex"}

RESPOND WITH JSON ONLY. NO EXPLANATION.`
                },
                { role: "user", content: query }
            ],
            temperature: 0.1,
            max_tokens: 100,
        });
        const content = response.choices[0]?.message?.content?.trim() || "";
        // Parse JSON from response
        const jsonMatch = content.match(/\{[^}]+\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            // Validate and return
            if (parsed.type === "casual" && parsed.subtype) {
                return { type: "casual", subtype: parsed.subtype };
            }
            else if (parsed.type === "legal") {
                return {
                    type: "legal",
                    domain: parsed.domain || "other",
                    complexity: parsed.complexity || "simple"
                };
            }
        }
        // Default to legal if parsing fails (safer for a legal AI)
        return { type: "legal", domain: "other", complexity: "simple" };
    }
    catch (error) {
        console.error("Intent classification error:", error);
        // Fallback: assume legal to be safe
        return { type: "legal", domain: "other", complexity: "simple" };
    }
}
/**
 * Quick check for obvious casual patterns (optimization to skip LLM call)
 */
function isObviouslyCasual(query) {
    const normalized = query.trim().toLowerCase();
    const casualPatterns = [
        // Greetings (all languages)
        /^(hi|hello|hey|yo|sup)$/i,
        /^(مرحبا|سلام|اهلا|صباح الخير|مساء الخير)$/,
        /^(bonjour|salut|bonsoir|coucou)$/i,
        // Identity questions
        /^who\s+(are\s+)?you/i,
        /^what('s|is)\s+your\s+name/i,
        /^(من أنت|شكون نت|انت شكون)/,
        /^(qui es[- ]tu|c'est qui)/i,
        // Thanks
        /^(thanks?|thank\s+you|thx)$/i,
        /^(شكرا|بارك الله فيك|متشكر)/,
        /^merci$/i,
    ];
    return casualPatterns.some(p => p.test(normalized));
}
