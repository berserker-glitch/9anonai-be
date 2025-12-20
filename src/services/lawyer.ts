import OpenAI from "openai";
import { config } from "../config";
import { classifyIntent, isObviouslyCasual, Intent } from "./intent-classifier";
import { routeQuery, buildContext } from "./query-router";

const client = new OpenAI({
    baseURL: config.openRouterBaseUrl,
    apiKey: config.openRouterApiKey,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/moroccan-legal-ai",
        "X-Title": "9anon - Moroccan Legal AI",
    },
});

const SYSTEM_PROMPT = `
You are 9anon (قانون), a friendly and knowledgeable Moroccan law expert.

## PERSONALITY
Be natural, conversational, and helpful - like chatting with a smart friend who happens to know a lot about law. Don't be formal or robotic. Use a warm, approachable tone. It's okay to use contractions, casual phrasing, and show personality.

## LANGUAGE RULE
Respond in the EXACT same language AND script as the user. If they write in Arabic script (العربية), respond in Arabic script. If they write in French, respond in French. If they write in English, respond in English. If they write Moroccan Darija in Latin letters (like "wach"), respond in the same way. NEVER convert between scripts - match exactly what the user uses.

## WHAT YOU HELP WITH
- Moroccan law, procedures, rights, contracts
- Criminal law - sentences, defenses, consequences
- Family, labor, property, commercial law
- Legal strategies and options
- "What happens if I do X?" questions

## WHAT YOU DON'T DO
- International law or UN stuff (politely redirect to Moroccan law)
- Non-legal topics (kindly say you're a law expert)
- Help commit crimes (but you CAN explain consequences)

## HOW TO RESPOND
- Be direct and helpful, not preachy
- For legal questions: cite relevant laws when you know them
- For casual chat: just chat normally
- Adjust length to the question - short for simple, detailed for complex
- If unsure, suggest consulting a lawyer but still help

## EXAMPLES OF GOOD RESPONSES
User: "What's the penalty for theft?"
You: "In Morocco, theft is covered under Articles 505-534 of the Penal Code. Simple theft can get you 1-5 years. If there was breaking and entering or violence, it goes up to 10-20 years. Want me to explain the specific circumstances?"

User: "Hey"
You: "Hey! What's on your mind?"
`;

const CASUAL_PROMPT = `
You are 9anon (قانون), a friendly Moroccan law AI assistant.

Be natural and conversational - respond like you're chatting with a friend. Match their language and energy. For casual greetings, just be friendly. For legal questions, show your expertise.

Don't be formal or robotic. Keep it real and helpful.
`;


export type StreamEvent =
    | { type: "step"; content: string }
    | { type: "intent"; intent: Intent }
    | { type: "citation"; sources: any[] }
    | { type: "token"; content: string }
    | { type: "done" };

/**
 * Web search fallback using Tavily API (or similar)
 */
async function webSearch(query: string): Promise<string> {
    try {
        // Using OpenRouter's built-in web search via Perplexity or similar
        const response = await client.chat.completions.create({
            model: "perplexity/sonar",
            messages: [
                {
                    role: "system",
                    content: "Search for Moroccan law information. Return factual, cited results only."
                },
                { role: "user", content: `Moroccan law: ${query}` }
            ],
            max_tokens: 500,
        });
        return response.choices[0]?.message?.content || "";
    } catch (error) {
        console.error("Web search failed:", error);
        return "";
    }
}

export type ImageInput = { data: string; mimeType: string };

export async function* getLegalAdviceStream(userQuery: string, history: any[] = [], images: ImageInput[] = []): AsyncGenerator<StreamEvent, void, unknown> {
    try {
        // 1. Quick casual check
        let intent: Intent;

        if (isObviouslyCasual(userQuery)) {
            intent = { type: "casual", subtype: "greeting" };
            yield { type: "intent", intent };
        } else {
            yield { type: "step", content: "Analyzing your question..." };
            intent = await classifyIntent(userQuery);
            yield { type: "intent", intent };
        }

        // Build user content with images if present
        const buildUserContent = (text: string) => {
            if (images.length === 0) return text;

            // Multimodal content for vision
            const parts: any[] = images.map(img => ({
                type: "image_url",
                image_url: { url: `data:${img.mimeType};base64,${img.data}` }
            }));
            parts.push({ type: "text", text });
            return parts;
        };

        // 2. Handle based on intent
        if (intent.type === "casual") {
            yield { type: "citation", sources: [] };

            const stream = await client.chat.completions.create({
                model: "google/gemini-3-flash-preview",
                messages: [
                    { role: "system", content: CASUAL_PROMPT },
                    ...history.slice(-10),
                    { role: "user", content: buildUserContent(userQuery) }
                ],
                stream: true,
            });

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                if (content) yield { type: "token", content };
            }
        } else {
            // Legal question - Smart RAG
            yield { type: "step", content: "Scanning Moroccan Legal Database..." };

            const routeResult = await routeQuery(intent, userQuery);
            let contextString = "";
            let usedWebSearch = false;

            if (routeResult.sources.length > 0) {
                yield { type: "step", content: `Found ${routeResult.sources.length} relevant legal references.` };
                yield { type: "citation", sources: routeResult.sources };
                contextString = buildContext(routeResult.sources);
            } else {
                // Fallback: Web search
                yield { type: "step", content: "No local results. Searching online sources..." };

                const webResults = await webSearch(userQuery);
                if (webResults) {
                    contextString = `[Web Search Results]:\n${webResults}`;
                    usedWebSearch = true;
                    yield { type: "step", content: "Found online legal information." };
                } else {
                    yield { type: "step", content: "Using general legal knowledge..." };
                }
                yield { type: "citation", sources: [] };
            }

            yield { type: "step", content: "Formulating legal advice..." };

            const userContent = contextString
                ? `Context:\n${contextString}\n\n---\n\nQuestion: ${userQuery}${usedWebSearch ? "\n\n(Note: This uses web search results. Please verify with official sources.)" : ""}`
                : `Question: ${userQuery}\n\n(No specific documents found. Provide general guidance based on Moroccan law principles.)`;

            const stream = await client.chat.completions.create({
                model: "google/gemini-3-flash-preview",
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: buildUserContent(userContent) }
                ],
                stream: true,
                // No max_tokens limit
            });

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                if (content) yield { type: "token", content };
            }
        }

        yield { type: "done" };

    } catch (error) {
        console.error("LLM Error:", error);
        yield { type: "step", content: "Error occurred during generation." };
        throw new Error("Failed to generate response.");
    }
}
