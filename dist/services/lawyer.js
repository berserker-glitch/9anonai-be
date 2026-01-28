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
const prisma_1 = require("./prisma");
const client = new openai_1.default({
    baseURL: config_1.config.openRouterBaseUrl,
    apiKey: config_1.config.openRouterApiKey,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/moroccan-legal-ai",
        "X-Title": "9anon - Moroccan Legal AI",
    },
});
// Tool definition removed
// DOC_GEN_SYSTEM_PROMPT removed
const SYSTEM_PROMPT = `
You are 9anon, a Moroccan law expert AI assistant.

CRITICAL FORMATTING RULES:
1. NEVER use emojis in your responses
2. RESPOND IN THE EXACT SAME LANGUAGE AS THE USER
3. Be professional and concise

LANGUAGE MATCHING:
- English message = English response
- French message = French response
- Arabic message = Arabic response

DOCUMENT GENERATION REQUESTS:
When user asks to create, draft, or generate a contract:

STEP 1 - COLLECT INFORMATION:
First, politely ask for the necessary details:
- For rental contracts: landlord name/ID/address, tenant name/ID/address, property address, rent amount, deposit, start date
- For employment contracts: employer details, employee details, position, salary, start date
- For other contracts: relevant party details and terms

STEP 2 - CONFIRM AND GENERATE:
Once the user provides the information, briefly confirm-you have what you need. The PDF will be generated automatically by the system.

IMPORTANT:
- NEVER write out the full contract text yourself
- NEVER mention "tools" or "functions" 
- NEVER say you will "use a tool" or "call a function"
- Just ask for info, then confirm and the system handles the rest

LEGAL GUIDANCE:
- Cite specific Moroccan law articles when relevant
- Reference Law 67.12 for rentals, Labor Code for employment
- Always recommend consulting a legal professional

CRIMINAL LAW ANALYSIS PRINCIPLES:
1. STRICT INTERPRETATION (التفسير الضيق):
   - Apply the principle of narrow interpretation in criminal law
   - Do NOT use argument by implication (مفهوم المخالفة) to create criminal liability
   - Cite ONLY explicit statutory texts as basis for criminalization
   - If a statute does not expressly criminalize conduct, say so clearly

2. UNCERTAINTY AND DISPUTED MATTERS:
   - When law is ambiguous or disputed, state: "This issue is doctrinally and judicially disputed (محل خلاف فقهي وقضائي)"
   - Include a brief "legal uncertainty notice" when applicable
   - Do NOT assign specific penalties unless there is a clear statutory basis
   - Acknowledge when courts and prosecution have discretion in re-qualification

3. PROPER LEGAL QUALIFICATION:
   - Preserve distinctions between: threat, attempt, and beginning of execution
   - Mention possible alternative qualifications (e.g., psychological violence under Law 103.13, harassment)
   - Clearly state when conduct may lack clear criminal characterization under current law
   - Attribute final qualification authority to courts and prosecution (النيابة العامة والقضاء)

4. PROFESSIONAL LANGUAGE:
   - Use cautious, measured legal language
   - Avoid definitive statements about criminal liability when law is unclear
   - Present multiple interpretations when they exist
   - Always recommend verification with a practicing lawyer or judicial authority
`;
const CASUAL_PROMPT = `
You are 9anon, a friendly Moroccan law AI assistant.

RULES:
1. NEVER use emojis
2. Respond in the same language as the user
3. Be helpful and natural
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
                    content: "Search for Moroccan law information. Return factual, well-cited results."
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
/**
 * Detect language from text
 */
function detectLanguage(text) {
    // Arabic characters
    if (/[\u0600-\u06FF]/.test(text))
        return "ar";
    // French indicators
    if (/\b(je|tu|il|nous|vous|ils|est|sont|avoir|être|pour|dans|avec|contrat|bail|travail)\b/i.test(text))
        return "fr";
    // Default to English
    return "en";
}
/**
 * Check if query is asking for document generation (FULLY FLEXIBLE)
 */
function isDocumentRequest(query) {
    return false; // DISABLED: Contract generation tool is temporarily disabled
}
/**
 * Check if conversation has enough info to generate contract
 */
function hasEnoughContractInfo(query, history) {
    // Combine all conversation text
    const fullConvo = history.map(m => m.content || "").join(" ") + " " + query;
    const lowerQuery = query.toLowerCase();
    // If user is asking to regenerate/resend PDF or change language, and there's history, allow it
    const regenerateKeywords = [
        'regenerate', 'same pdf', 'same contract', 'again', 'resend', 'redo',
        'in french', 'in english', 'in arabic', 'en français', 'بالعربية',
        'generate it', 'create it', 'want it', 'be in arabic', 'be in french', 'be in english',
        'arabic version', 'french version', 'english version',
        'بالعربي', 'version arabe', 'version française'
    ];
    const isRegenerateRequest = regenerateKeywords.some(k => lowerQuery.includes(k));
    if (isRegenerateRequest && history.length > 2) {
        // User wants to regenerate in a different language or same PDF - allow it
        return true;
    }
    // Check for party names in the full conversation
    // Arabic names pattern - looking for Arabic text with spaces
    const arabicNamePattern = /[\u0600-\u06FF]{3,}\s+(?:بن\s+)?[\u0600-\u06FF]{3,}/g;
    const arabicMatches = fullConvo.match(arabicNamePattern) || [];
    // Western/transliterated names
    const westernNamePattern = /\b[A-Z][a-z]+\s+(?:Ben\s+|Ibn\s+)?[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g;
    const westernMatches = fullConvo.match(westernNamePattern) || [];
    const nameCount = arabicMatches.length + westernMatches.length;
    // Check for monetary amounts (dirhams) or property details
    const hasAmounts = /\d{1,3}(?:[,.\s]?\d{3})*\s*(?:MAD|DH|درهم|dirhams?)/i.test(fullConvo);
    const hasProperty = /(?:رقم|عقار|شقة|منزل|أرض|property|apartment|house)/i.test(fullConvo);
    const hasCIN = /(?:[A-Z]{1,2}\d{5,}|بطاقة|CIN|carte)/i.test(fullConvo);
    // More flexible: need at least 2 names OR (1 name + amounts/property/CIN)
    return nameCount >= 2 || (nameCount >= 1 && (hasAmounts || hasProperty || hasCIN));
}
/**
 * Analyze query complexity to adjust response depth
 */
function analyzeComplexity(text) {
    const words = text.trim().split(/\s+/).length;
    // Length heuristic: Long queries are usually complex scenarios
    if (words > 15)
        return 'deep';
    // Keyword heuristic: detailed scenarios
    const deepKeywords = [
        // English
        "story", "situation", "happened", "problem", "issue", "case",
        "accident", "died", "death", "killed", "murder",
        "divorce", "married", "husband", "wife", "children", "custody",
        "inheritance", "legacy", "heir",
        "fired", "dismissed", "boss", "company", "work", "job",
        "police", "arrested", "prison", "jail", "court",
        "scam", "fraud", "money", "debt", "loan",
        // French
        "histoire", "situation", "problème", "cas",
        "accident", "mort", "décès", "tué", "meurtre",
        "divorce", "marié", "mari", "femme", "enfants", "garde",
        "héritage", "succession", "héritier",
        "licencié", "renvoyé", "patron", "entreprise", "travail", "boulot",
        "police", "arrêté", "prison", "tribunal",
        "arnaque", "fraude", "argent", "dette", "crédit",
        // Arabic (Common keywords for stories/problems)
        "مشكلة", "قصة", "حصل", "وقع", "حادثة",
        "موت", "وفاة", "توفي", "قتل",
        "طلاق", "زواج", "زوج", "زوجة", "أطفال", "حضانة",
        "إرث", "ميراث", "ورثة",
        "طرد", "فصل", "شغل", "عمل", "مدير",
        "شرطة", "اعتقال", "سجن", "محكمة",
        "نصب", "احتيال", "فلوس", "دين"
    ];
    const lowerText = text.toLowerCase();
    if (deepKeywords.some(kw => lowerText.includes(kw)))
        return 'deep';
    return 'basic';
}
async function* getLegalAdviceStream(userQuery, history = [], images = [], userId) {
    try {
        // Detect user's language
        const userLang = detectLanguage(userQuery);
        // Fetch User Personalization
        let personalizationContext = "";
        if (userId) {
            try {
                const user = await prisma_1.prisma.user.findUnique({
                    where: { id: userId },
                    select: { personalization: true }
                });
                if (user?.personalization) {
                    let customContext = "";
                    try {
                        // Try to parse as JSON (new format)
                        const parsed = JSON.parse(user.personalization);
                        if (typeof parsed === 'object' && parsed !== null) {
                            if (parsed.tones && Array.isArray(parsed.tones) && parsed.tones.length > 0) {
                                customContext += `PREFERRED TONE/STYLE: ${parsed.tones.join(", ")}.\n`;
                            }
                            if (parsed.customInstructions) {
                                customContext += `CUSTOM INSTRUCTIONS: ${parsed.customInstructions}\n`;
                            }
                            if (parsed.spokenLanguage) {
                                if (parsed.spokenLanguage === "auto") {
                                    // Detect language from user's query and make it explicit
                                    const detectedLang = detectLanguage(userQuery);
                                    const langNames = { "en": "English", "fr": "French", "ar": "Arabic" };
                                    const detectedLangName = langNames[detectedLang] || "English";
                                    customContext += `USER LANGUAGE SETTING: Auto-detect is ON. The user's latest message is in ${detectedLangName}. You MUST respond in ${detectedLangName}.\n`;
                                }
                                else {
                                    // Map codes to full names
                                    const langMap = { "en": "English", "fr": "French", "ar": "Arabic" };
                                    const langName = langMap[parsed.spokenLanguage] || parsed.spokenLanguage;
                                    customContext += `User Profile Preference: ${langName}.\n`;
                                    customContext += `CRITICAL INSTRUCTION: You must ALWAYS match the language of the user's latest message. If the user writes in English, reply in English. If French, reply in French. If Arabic, reply in Arabic. The "Profile Preference" is ONLY a fallback for ambiguous inputs. DO NOT reply in ${langName} if the user is speaking a different language.\n`;
                                }
                            }
                        }
                        else {
                            // Valid JSON but not object (e.g. quoted string)
                            customContext = String(parsed);
                        }
                    }
                    catch (e) {
                        // detailed error or plain text fallback
                        customContext = user.personalization;
                    }
                    if (customContext.trim()) {
                        personalizationContext = `\n\n=== USER PERSONALIZATION ===\n${customContext}\n============================\n`;
                    }
                }
            }
            catch (e) {
                console.warn("Failed to fetch personalization", e);
            }
        }
        // Complexity Analysis & Instruction Injection
        const complexity = analyzeComplexity(userQuery);
        let complexityInstruction = "";
        if (complexity === "deep") {
            complexityInstruction = `
            
=== DYNAMIC RESPONSE MODE: DEEP DIVE ===
The user's query is identified as COMPLEX.
INSTRUCTIONS:
1. Provide a DETAILED and COMPREHENSIVE analysis.
2. Break down the answer into clear sections (Legal Framework, Application to Case, Recommendations).
3. Address nuances and potential "what if" scenarios.
4. Do NOT be brief. Be thorough and explanatory.
========================================
`;
        }
        else {
            complexityInstruction = `

=== DYNAMIC RESPONSE MODE: CONCISE ===
The user's query is identified as BASIC/INFORMATIONAL.
INSTRUCTIONS:
1. Provide a DIRECT and CONCISE answer.
2. Cite the relevant article/law immediately.
3. Keep it short and to the point. Avoid unnecessary preamble.
======================================
`;
        }
        // Append to personalization context (will be added to system prompt)
        personalizationContext += complexityInstruction;
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
                    { role: "system", content: CASUAL_PROMPT + personalizationContext },
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
            // Document generation check is done later with history context
            const isDocRequestNow_check = isDocumentRequest(userQuery);
            console.log("Initial doc request check:", isDocRequestNow_check, "User ID:", userId);
            // Combined RAG + Perplexity Search
            yield { type: "step", content: "Scanning Moroccan Legal Database..." };
            const [routeResult, perplexityResults] = await Promise.all([
                (0, query_router_1.routeQuery)(intent, userQuery),
                perplexitySearch(userQuery)
            ]);
            let contextParts = [];
            let allSources = routeResult.sources;
            if (routeResult.sources.length > 0) {
                yield { type: "step", content: `Found ${routeResult.sources.length} relevant legal references.` };
                contextParts.push((0, query_router_1.buildContext)(routeResult.sources));
            }
            if (perplexityResults) {
                yield { type: "step", content: "Enriching with online legal sources..." };
                contextParts.push(`[Online Legal Sources]:\n${perplexityResults}`);
            }
            yield { type: "citation", sources: allSources };
            let contextString = contextParts.length > 0 ? contextParts.join("\n\n---\n\n") : "";
            // ═══════════════════════════════════════════════════════════
            // REGULAR RESPONSE PATH
            // ═══════════════════════════════════════════════════════════
            yield { type: "step", content: "Formulating response..." };
            const userContent = contextString
                ? `Context:\n${contextString}\n\n---\n\nQuestion: ${userQuery}`
                : `Question: ${userQuery}`;
            const stream = await client.chat.completions.create({
                model: "google/gemini-3-flash-preview",
                messages: [
                    { role: "system", content: SYSTEM_PROMPT + personalizationContext },
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
