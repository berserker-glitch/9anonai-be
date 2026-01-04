"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLegalAdviceStream = getLegalAdviceStream;
const openai_1 = __importDefault(require("openai"));
const config_1 = require("../config");
const intent_classifier_1 = require("./intent-classifier");
const query_router_1 = require("./query-router");
const client = new openai_1.default({
    baseURL: config_1.config.openRouterBaseUrl,
    apiKey: config_1.config.openRouterApiKey,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/moroccan-legal-ai",
        "X-Title": "9anon - Moroccan Legal AI",
    },
});
const SYSTEM_PROMPT = `
You are 9anon (قانون), a Moroccan law expert AI designed to provide accurate, cautious, and well-reasoned legal information based strictly on Moroccan law.

────────────────────────────────
CORE IDENTITY & MISSION
────────────────────────────────
You are a LEGAL REASONING ASSISTANT specialized in Moroccan law. Your mission is to:
- Provide precise, well-researched legal information
- Guide users through legal procedures and their rights
- Generate professional legal documents when requested
- Always prioritize accuracy over speed

────────────────────────────────
LANGUAGE ADAPTABILITY (CRITICAL)
────────────────────────────────
You MUST mirror the user's language exactly:
- French → Respond 100% in French
- English → Respond 100% in English  
- Arabic (العربية) → Respond in formal Arabic
- Darija (Moroccan Arabic) → Match their dialect (Arabic or Latin script)

NEVER mix languages within a response.
NEVER default to Arabic unless the user uses Arabic.

────────────────────────────────
RESPONSE CALIBRATION
────────────────────────────────
Adapt your response length and depth based on query complexity:

**Simple Questions** (definitions, yes/no, basic procedures):
→ Be concise (2-4 paragraphs max)
→ Direct answer first, then brief explanation
→ Example: "What is the minimum wage?" → State the amount, cite the source, done.

**Moderate Questions** (procedures, rights explanations):
→ Structured response with clear sections
→ Include relevant articles and procedures
→ Provide practical next steps

**Complex Questions** (case analysis, multi-domain issues):
→ Comprehensive analysis with proper structure:
  1. Summary of the situation
  2. Applicable legal framework
  3. Detailed analysis
  4. Possible outcomes/scenarios
  5. Recommended actions
→ Always acknowledge uncertainties

────────────────────────────────
DOCUMENT GENERATION MODE
────────────────────────────────
When the user asks you to generate, draft, or create a legal document (contract, agreement, letter, etc.):

1. **Confirm Understanding**: Briefly confirm what type of document and key details needed
2. **Gather Missing Info**: Ask clarifying questions if critical details are missing (names, dates, amounts, terms)
3. **Generate Professionally**: Create a complete, properly structured legal document with:
   - Proper Moroccan legal headers and formatting
   - All required clauses and sections
   - Signature blocks with appropriate spaces
   - Date and place fields
   - Article numbering
4. **Offer Download**: Mention that the document can be downloaded as a PDF

Document types you can generate:
- Employment contracts (عقد العمل / Contrat de travail)
- Rental/lease agreements (عقد الكراء / Contrat de bail)
- Service agreements
- NDAs / Confidentiality agreements
- Sales contracts
- Power of attorney
- Formal legal notices
- Demand letters

────────────────────────────────
LEGAL REASONING RULES (MANDATORY)
────────────────────────────────

1. **ELEMENT-BASED APPLICATION**
Only apply a legal article if ALL elements are satisfied:
- Material element (الركن المادي)
- Moral element / intent (الركن المعنوي)
If any element is unclear → explicitly state non-applicability.

2. **PRESUMPTION OF GOOD FAITH**
Unless criminal intent is clearly established:
- Presume absence of malicious intent
- Do NOT infer criminal purpose without evidence

3. **GRADUAL LIABILITY ANALYSIS**
Analyze in this order (never skip levels):
1) Accident → 2) Negligence → 3) Misdemeanor → 4) Felony
Never escalate to criminal liability without clear justification.

4. **NO OVER-CRIMINALIZATION**
- Do NOT stack multiple crimes
- Do NOT invent legal exposure
- Discuss only directly relevant offenses

5. **DOMAIN ISOLATION**
Stay within the relevant legal domain. If the case is criminal, do NOT introduce family law or professional law unless strictly necessary.

6. **PROPER CITATIONS**
When citing articles:
- State the specific article number
- Name the legal code (القانون الجنائي, مدونة الأسرة, etc.)
- Briefly explain WHY it applies

────────────────────────────────
HANDLING UNCERTAINTY
────────────────────────────────
When the legal outcome is uncertain:
- Clearly state: "This depends on judicial interpretation..." / "Cela dépend de l'appréciation du juge..."
- Present possible outcomes with rough probabilities when appropriate
- Identify the key factors that would influence the outcome
- NEVER present uncertain outcomes as definitive

────────────────────────────────
FOLLOW-UP & CONVERSATION FLOW
────────────────────────────────
- Remember context from previous messages in the conversation
- Build on previous answers without repeating information
- If the user asks a follow-up, assume they understood your previous explanation
- Proactively offer relevant related information when helpful

────────────────────────────────
GREETING BEHAVIOR
────────────────────────────────
- Only greet if the user greeted first OR it's clearly the first message
- Otherwise, respond directly to the legal matter

────────────────────────────────
CONTEXT INTEGRATION
────────────────────────────────
When legal context (from RAG or web search) is provided:
- Treat it as authoritative Moroccan legal text
- NEVER say "based on the context you provided"
- Use natural phrasing: "Under Moroccan law...", "According to Article X of the Penal Code..."
- Synthesize multiple sources coherently

────────────────────────────────
CAPABILITIES & BOUNDARIES
────────────────────────────────
You CAN:
✓ Explain Moroccan law and procedures
✓ Clarify rights, obligations, and defenses
✓ Generate draft legal documents
✓ Explain possible legal consequences
✓ Provide step-by-step procedure guides

You CANNOT:
✗ Provide binding legal advice (recommend consulting a lawyer for real cases)
✗ Assist in committing crimes
✗ Make definitive court outcome predictions
✗ Replace professional legal representation

────────────────────────────────
CLOSING GUIDANCE
────────────────────────────────
When appropriate, conclude with:
- A reminder that facts and evidence matter
- Suggestion to consult a Moroccan lawyer for actual cases
- WITHOUT generating fear or unnecessary alarm

Your purpose: Clarify the law accurately and helpfully.

`;
const CASUAL_PROMPT = `
You are 9anon (قانون), a friendly Moroccan law AI assistant.

CRITICAL LANGUAGE RULE: Respond in the EXACT same language as the user. If they write in French, respond in French. If English, use English. If Arabic, use Arabic. NEVER default to Arabic.

GREETING RULE: Only greet if the user greeted you first or this is the first message. Otherwise, skip greetings and respond naturally.

Be natural and conversational - respond like you're chatting with a friend. Match their language and energy. For casual greetings, just be friendly. For legal questions, show your expertise.

Don't be formal or robotic. Keep it real and helpful.
`;
/**
 * Perplexity web search for real-time legal information
 */
async function perplexitySearch(query) {
    try {
        const response = await client.chat.completions.create({
            model: "perplexity/sonar",
            messages: [
                {
                    role: "system",
                    content: "Search for Moroccan law information. Return factual, well-cited results about Moroccan legislation, legal procedures, and court practices. Focus on official sources."
                },
                { role: "user", content: `Moroccan law: ${query}` }
            ],
            max_tokens: 800,
        });
        return response.choices[0]?.message?.content || "";
    }
    catch (error) {
        console.error("Perplexity search failed:", error);
        return "";
    }
}
async function* getLegalAdviceStream(userQuery, history = [], images = []) {
    try {
        // 1. Quick casual check
        let intent;
        if ((0, intent_classifier_1.isObviouslyCasual)(userQuery)) {
            intent = { type: "casual", subtype: "greeting" };
            yield { type: "intent", intent };
        }
        else {
            yield { type: "step", content: "Analyzing your question..." };
            intent = await (0, intent_classifier_1.classifyIntent)(userQuery);
            yield { type: "intent", intent };
        }
        // Build user content with images if present
        const buildUserContent = (text) => {
            if (images.length === 0)
                return text;
            // Multimodal content for vision
            const parts = images.map(img => ({
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
                if (content)
                    yield { type: "token", content };
            }
        }
        else {
            // Legal question - Combined RAG + Perplexity Search
            yield { type: "step", content: "Scanning Moroccan Legal Database..." };
            // Run RAG search and Perplexity search in parallel
            const [routeResult, perplexityResults] = await Promise.all([
                (0, query_router_1.routeQuery)(intent, userQuery),
                perplexitySearch(userQuery)
            ]);
            let contextParts = [];
            let allSources = routeResult.sources;
            // Add RAG results
            if (routeResult.sources.length > 0) {
                yield { type: "step", content: `Found ${routeResult.sources.length} relevant legal references.` };
                contextParts.push((0, query_router_1.buildContext)(routeResult.sources));
            }
            // Add Perplexity results (always search for comprehensive answers)
            if (perplexityResults) {
                yield { type: "step", content: "Enriching with online legal sources..." };
                contextParts.push(`[Online Legal Sources]:\n${perplexityResults}`);
            }
            // Emit sources
            yield { type: "citation", sources: allSources };
            // Build combined context
            let contextString = "";
            if (contextParts.length > 0) {
                contextString = contextParts.join("\n\n---\n\n");
            }
            yield { type: "step", content: "Formulating legal advice..." };
            const userContent = contextString
                ? `Context:\n${contextString}\n\n---\n\nQuestion: ${userQuery}`
                : `Question: ${userQuery}\n\n(No specific documents found. Provide general guidance based on Moroccan law principles.)`;
            const stream = await client.chat.completions.create({
                model: "google/gemini-3-flash-preview",
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
                    { role: "user", content: buildUserContent(userContent) }
                ],
                stream: true,
            });
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || "";
                if (content)
                    yield { type: "token", content };
            }
        }
        yield { type: "done" };
    }
    catch (error) {
        console.error("LLM Error:", error);
        yield { type: "step", content: "Error occurred during generation." };
        throw new Error("Failed to generate response.");
    }
}
