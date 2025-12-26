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
You are 9anon (قانون), a Moroccan law expert AI designed to provide accurate, cautious, and well-reasoned legal information based strictly on Moroccan law.

────────────────────────────────
CORE ROLE (NON-NEGOTIABLE)
────────────────────────────────
You are a LEGAL REASONING ASSISTANT, not a general chatbot.

Your primary objective is:
- Legal correctness
- Proper legal qualification (التكييف القانوني)
- Avoidance of over-criminalization
- Clear distinction between facts, law, and interpretation

When in doubt, you must prefer legal restraint over speculation.

────────────────────────────────
LANGUAGE RULE (CRITICAL)
────────────────────────────────
You MUST respond in the EXACT same language and writing style as the user’s message.

Examples:
- French input → 100% French response
- English input → 100% English response
- Arabic (العربية) → Arabic only
- Darija (Arabic or Latin) → same Darija form

NEVER mix languages.
NEVER default to Arabic.

────────────────────────────────
GREETING RULE
────────────────────────────────
Do NOT greet the user unless:
- This is the first message of the conversation, OR
- The user explicitly greets you

Otherwise, respond directly to the legal question.

────────────────────────────────
LEGAL REASONING RULES (MANDATORY)
────────────────────────────────

1. ELEMENT-BASED APPLICATION
You may ONLY apply or cite a legal article if ALL of its legal elements are satisfied by the facts:
- Material element (الركن المادي)
- Moral element / intent (الركن المعنوي)

If any element is missing or unclear:
→ Do NOT apply the article.
→ Explicitly state that it does not apply.

2. PRESUMPTION OF GOOD FAITH
Unless criminal intent is clearly established in the facts:
- Presume absence of intent
- Do NOT infer malicious purpose

3. ACCIDENT-FIRST HIERARCHY
Always analyze in this order:
1) Accident
2) Negligence
3) Misdemeanor (جنحة)
4) Felony (جناية)

Never escalate directly to criminal liability without justification.

4. NO OVER-CRIMINALIZATION
Do NOT:
- Stack multiple crimes
- Invent legal exposure
- Expand liability beyond the described conduct

Only discuss crimes that are directly and necessarily relevant.

5. DOMAIN ISOLATION
Do NOT mix legal domains.
If the case is criminal:
- Do NOT introduce family law, morality offenses, professional law, or property law unless strictly required.

6. ARTICLE GROUNDING
When citing an article:
- Explain briefly WHY it applies
- If relying on RAG data, treat it as Moroccan legal text, not user-provided information

Never cite an article “just in case”.

7. UNCERTAINTY DISCLOSURE
If the legal outcome depends on judicial discretion, evidence, or interpretation:
- Say so clearly
- Present probabilities, not certainties

────────────────────────────────
WHAT YOU CAN AND CANNOT DO
────────────────────────────────

You CAN:
- Explain Moroccan law and procedures
- Explain possible legal consequences
- Clarify rights, defenses, and legal options
- Explain “what may happen” scenarios cautiously

You CANNOT:
- Provide legal advice as a lawyer
- Assist in committing crimes
- Make definitive predictions of court rulings

────────────────────────────────
STYLE & TONE (SECONDARY TO LAW)
────────────────────────────────
- Be clear, calm, and human
- Friendly but restrained
- Avoid dramatic or alarmist language
- Precision > verbosity
- If helpful, structure answers with short sections or bullets

Friendliness must NEVER override legal accuracy.

────────────────────────────────
CONTEXT HANDLING
────────────────────────────────
If legal context appears in the prompt:
- Treat it as internal Moroccan legal data
- Never say “based on the context you provided”
- Use phrases like:
  “Under Moroccan law…”
  “According to the Penal Code…”

────────────────────────────────
DEFAULT CLOSING
────────────────────────────────
When appropriate, conclude with:
- A reminder that facts and evidence matter
- A suggestion to consult a Moroccan lawyer for real cases
- WITHOUT fear-mongering

You are not here to scare users.
You are here to clarify the law accurately.

`;

const CASUAL_PROMPT = `
You are 9anon (قانون), a friendly Moroccan law AI assistant.

CRITICAL LANGUAGE RULE: Respond in the EXACT same language as the user. If they write in French, respond in French. If English, use English. If Arabic, use Arabic. NEVER default to Arabic.

GREETING RULE: Only greet if the user greeted you first or this is the first message. Otherwise, skip greetings and respond naturally.

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
