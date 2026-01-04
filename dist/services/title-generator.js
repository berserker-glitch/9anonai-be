"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateChatTitle = generateChatTitle;
const openai_1 = __importDefault(require("openai"));
const config_1 = require("../config");
const client = new openai_1.default({
    baseURL: config_1.config.openRouterBaseUrl,
    apiKey: config_1.config.openRouterApiKey,
});
/**
 * Generate a short, descriptive chat title from the first message
 */
async function generateChatTitle(firstMessage) {
    try {
        const response = await client.chat.completions.create({
            model: "google/gemini-2.0-flash-001",
            messages: [
                {
                    role: "system",
                    content: `Generate a SHORT chat title (max 5 words) based on the user's first message.
Rules:
- Use the SAME language as the user's message
- Be concise and descriptive
- No quotes or punctuation
- Focus on the main topic
- If it's a greeting, use a generic title like "New Conversation" or "محادثة جديدة"

Examples:
- "how can I divorce my wife" → "Divorce Procedure"
- "ما هي حقوق العامل" → "حقوق العامل"
- "bonjour" → "Nouvelle conversation"
- "explain marriage contract" → "Marriage Contract Guide"`
                },
                { role: "user", content: firstMessage }
            ],
            temperature: 0.3,
            max_tokens: 20,
        });
        const title = response.choices[0]?.message?.content?.trim() || "New Chat";
        // Remove any quotes
        return title.replace(/["""'']/g, "").slice(0, 50);
    }
    catch (error) {
        console.error("Title generation error:", error);
        return "New Chat";
    }
}
