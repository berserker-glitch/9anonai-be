"use strict";
/**
 * @fileoverview AI service for the Contract Builder feature.
 * Implements a two-phase pipeline:
 *   Phase 1: RAG-powered contract drafting (retrieves Moroccan law from LanceDB)
 *   Phase 2: Legal compliance review (audits the contract for flaws/vulnerabilities)
 *
 * This service is deliberately SEPARATE from lawyer.ts — it has specialized
 * system prompts focused on contract generation, not general legal advice.
 *
 * @module services/contract-builder-ai
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getContractStream = getContractStream;
const openai_1 = __importDefault(require("openai"));
const config_1 = require("../config");
const retriever_1 = require("./retriever");
const query_router_1 = require("./query-router");
const logger_1 = require("./logger");
// ─────────────────────────────────────────────────────────────────────────────
// OpenRouter Client (same config as lawyer.ts)
// ─────────────────────────────────────────────────────────────────────────────
const client = new openai_1.default({
    baseURL: config_1.config.openRouterBaseUrl,
    apiKey: config_1.config.openRouterApiKey,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/moroccan-legal-ai",
        "X-Title": "9anon - Contract Builder",
    },
});
/** The LLM model used for contract generation and review */
const CONTRACT_MODEL = "google/gemini-3-flash-preview";
// ─────────────────────────────────────────────────────────────────────────────
// Contract Type → RAG Domain Mapping
// Maps each contract type to the categories used to query LanceDB
// ─────────────────────────────────────────────────────────────────────────────
const CONTRACT_TYPE_DOMAINS = {
    rental: {
        primary: ["immobilier", "foncier", "propriété", "urbanisme", "bail", "location"],
        secondary: ["civil", "obligations", "contrats"],
    },
    employment: {
        primary: ["travail", "emploi", "sécurité sociale", "protection sociale"],
        secondary: ["civil", "obligations"],
    },
    nda: {
        primary: ["commercial", "société", "entreprise", "confidentialité"],
        secondary: ["civil", "contrats", "obligations"],
    },
    service: {
        primary: ["commercial", "commerce", "prestation"],
        secondary: ["civil", "obligations", "contrats"],
    },
    sale: {
        primary: ["commercial", "immobilier", "vente"],
        secondary: ["civil", "obligations", "contrats"],
    },
    custom: {
        primary: [],
        secondary: ["civil", "obligations", "contrats"],
    },
};
// ─────────────────────────────────────────────────────────────────────────────
// System Prompts
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Builds the drafting system prompt with injected legal context.
 * This prompt tells the AI to produce both a conversational response
 * and the full contract HTML within XML tags.
 */
function buildDraftingPrompt(legalContext, language) {
    const langInstruction = getLanguageInstruction(language);
    return `You are 9anon Contract Builder, a Moroccan legal document drafting expert.
Your role is to draft and edit legally compliant contracts under Moroccan law.

${langInstruction}

═══════════════════════════════════════════════════════════════
MOROCCAN LAW REFERENCE (from verified legal database):
═══════════════════════════════════════════════════════════════
${legalContext || "No specific legal documents found. Use your general knowledge of Moroccan law (DOC, Labor Code, etc.) but warn the user about this limitation."}
═══════════════════════════════════════════════════════════════

CRITICAL RULES:
1. Every clause MUST be grounded in Moroccan law. Reference specific articles.
2. Include ALL mandatory clauses required by law for this contract type.
3. Use proper Moroccan legal terminology and structure.
4. NEVER hallucinate laws — only reference articles from the provided context.
5. If unsure about a specific legal requirement, ASK the user or note the limitation.
6. Follow the standard structure of Moroccan legal contracts (préambule, articles, signatures).

WORKFLOW:
- If user requests a NEW contract: ask clarifying questions first (parties, terms, specifics)
- Once you have enough info: generate the FULL contract
- If user asks to EDIT a clause: modify ONLY the requested part, keep everything else identical
- If user asks a question: answer it without modifying the contract

OUTPUT FORMAT (MANDATORY):
You MUST always output your response using these XML tags:

<response>
Your conversational message to the user goes here.
Explain what you did, what legal articles apply, or ask follow-up questions.
DO NOT include the contract text here.
</response>

<contract>
The FULL HTML of the contract goes here. This must be complete, self-contained HTML.
Use proper formatting: headings, paragraphs, numbered articles, bold for important terms.
Include a professional header with contract title, date placeholder, and party placeholders.
</contract>

IMPORTANT:
- If you are only chatting (asking questions, answering), put "" in <contract> tags
- If you are generating/editing the contract, ALWAYS include the FULL updated HTML
- The contract HTML should look professional and printable
- Use clean semantic HTML (h1, h2, p, ol, li, strong, etc.)
- Include proper Moroccan contract formatting conventions`;
}
/**
 * Builds the legal review system prompt for Phase 2.
 * The reviewer acts as a legal auditor checking the contract for compliance.
 */
function buildReviewPrompt(complianceContext, language) {
    const langInstruction = getLanguageInstruction(language);
    return `You are a Moroccan legal compliance auditor.
Your job is to review a drafted contract and check it against Moroccan law.

${langInstruction}

═══════════════════════════════════════════════════════════════
MOROCCAN LAW COMPLIANCE REFERENCE:
═══════════════════════════════════════════════════════════════
${complianceContext || "No specific compliance references found. Use general Moroccan legal principles."}
═══════════════════════════════════════════════════════════════

REVIEW CHECKLIST:
1. Are ALL mandatory clauses present per Moroccan law for this contract type?
2. Do any clauses CONTRADICT Moroccan legislation?
3. Are there ABUSIVE or UNENFORCEABLE terms?
4. Are required legal FORMALITIES included (signatures, dates, witnesses, registration)?
5. Is the language precise enough to AVOID DISPUTES?
6. Are BOTH parties' rights adequately protected?
7. Are penalty/termination clauses within legal limits?

OUTPUT FORMAT (MANDATORY - valid JSON):
{
    "issues": [
        {
            "clause": "Article X or section description",
            "severity": "critical" | "warning" | "info",
            "description": "What is wrong and why",
            "lawReference": "Article/Law reference"
        }
    ],
    "correctedContract": "If issues were found, the FULL corrected HTML. If no issues, empty string.",
    "summary": "Brief summary of the review for the user (1-3 sentences)"
}

SEVERITY LEVELS:
- critical: Missing mandatory clause, illegal term, void clause — MUST be fixed
- warning: Potentially problematic, recommended fix — SHOULD be fixed  
- info: Suggestion for improvement — NICE to fix

RULES:
- Be thorough but not overly pedantic
- Only flag real legal issues, not stylistic preferences
- Always provide the law reference for each issue
- If the contract is well-drafted, return an empty issues array with a positive summary`;
}
/**
 * Generates language-specific instructions for the AI.
 * Ensures the contract is drafted in the user's chosen language.
 */
function getLanguageInstruction(language) {
    switch (language) {
        case "ar":
            return "يجب أن يكون العقد والمحادثة بالكامل باللغة العربية. استخدم المصطلحات القانونية العربية المغربية.";
        case "fr":
            return "OBLIGATOIRE: Le contrat et la conversation doivent être ENTIÈREMENT en français. Utilisez la terminologie juridique marocaine française.";
        case "en":
        default:
            return "MANDATORY: The contract and conversation must be ENTIRELY in English. Use standard Moroccan legal terminology translated to English.";
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// RAG Retrieval
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Performs multi-query RAG retrieval from LanceDB for contract drafting.
 * Executes primary + secondary searches based on contract type,
 * plus a targeted search for the specific user query.
 *
 * @param contractType - The type of contract (rental, employment, etc.)
 * @param userQuery - The user's message/request
 * @returns Deduplicated and ranked legal documents
 */
async function retrieveLegalContext(contractType, userQuery) {
    const domains = CONTRACT_TYPE_DOMAINS[contractType] || CONTRACT_TYPE_DOMAINS.custom;
    const allResults = [];
    const seenIds = new Set();
    /**
     * Helper to add results while deduplicating by document ID
     */
    const addResults = (results) => {
        for (const doc of results) {
            const id = doc.id || `${doc.source_file}_${doc.text.slice(0, 50)}`;
            if (!seenIds.has(id)) {
                seenIds.add(id);
                allResults.push(doc);
            }
        }
    };
    try {
        // Primary search: contract-type-specific law categories
        if (domains.primary.length > 0) {
            logger_1.logger.info(`[CONTRACT-AI] Primary RAG search for type="${contractType}"`, {
                categories: domains.primary,
            });
            const primaryResults = await (0, retriever_1.searchLegalDocs)(userQuery, 10, {
                categories: domains.primary,
            });
            addResults(primaryResults);
            logger_1.logger.debug(`[CONTRACT-AI] Primary search returned ${primaryResults.length} results`);
        }
        // Secondary search: general obligations/contracts law (DOC)
        logger_1.logger.info(`[CONTRACT-AI] Secondary RAG search (general obligations)`, {
            categories: domains.secondary,
        });
        const secondaryResults = await (0, retriever_1.searchLegalDocs)(userQuery, 8, {
            categories: domains.secondary,
        });
        addResults(secondaryResults);
        logger_1.logger.debug(`[CONTRACT-AI] Secondary search returned ${secondaryResults.length} results`);
        // Tertiary search: user's specific query without category filter
        // Catches edge cases where the user mentions something outside mapped categories
        logger_1.logger.info(`[CONTRACT-AI] Tertiary RAG search (unfiltered, user query)`);
        const tertiaryResults = await (0, retriever_1.searchLegalDocs)(userQuery, 5);
        addResults(tertiaryResults);
        logger_1.logger.debug(`[CONTRACT-AI] Tertiary search returned ${tertiaryResults.length} results`);
    }
    catch (error) {
        logger_1.logger.error("[CONTRACT-AI] RAG retrieval error:", error);
    }
    // Sort by relevance score (highest first) and take top results
    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    const topResults = allResults.slice(0, 15);
    logger_1.logger.info(`[CONTRACT-AI] Total RAG results: ${allResults.length}, using top ${topResults.length}`);
    return topResults;
}
/**
 * Performs compliance-specific RAG retrieval for the review phase.
 * Searches for mandatory clauses, prohibited terms, and required formalities.
 *
 * @param contractType - The type of contract
 * @param contractHtml - The generated contract HTML (used to build targeted queries)
 * @returns Legal documents relevant for compliance checking
 */
async function retrieveComplianceContext(contractType, contractHtml) {
    const allResults = [];
    const seenIds = new Set();
    const addResults = (results) => {
        for (const doc of results) {
            const id = doc.id || `${doc.source_file}_${doc.text.slice(0, 50)}`;
            if (!seenIds.has(id)) {
                seenIds.add(id);
                allResults.push(doc);
            }
        }
    };
    try {
        // Search for mandatory clauses for this contract type
        const mandatoryQuery = `clauses obligatoires contrat ${contractType} droit marocain`;
        logger_1.logger.info(`[CONTRACT-AI] Compliance RAG: mandatory clauses search`);
        const mandatoryResults = await (0, retriever_1.searchLegalDocs)(mandatoryQuery, 8);
        addResults(mandatoryResults);
        // Search for prohibited/abusive terms
        const prohibitedQuery = `clauses abusives interdites contrat ${contractType} maroc`;
        logger_1.logger.info(`[CONTRACT-AI] Compliance RAG: prohibited terms search`);
        const prohibitedResults = await (0, retriever_1.searchLegalDocs)(prohibitedQuery, 5);
        addResults(prohibitedResults);
        // Search for required formalities
        const formalitiesQuery = `formalités légales obligatoires contrat ${contractType} maroc`;
        logger_1.logger.info(`[CONTRACT-AI] Compliance RAG: formalities search`);
        const formalitiesResults = await (0, retriever_1.searchLegalDocs)(formalitiesQuery, 5);
        addResults(formalitiesResults);
    }
    catch (error) {
        logger_1.logger.error("[CONTRACT-AI] Compliance RAG retrieval error:", error);
    }
    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    return allResults.slice(0, 12);
}
// ─────────────────────────────────────────────────────────────────────────────
// Response Parsing
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Extracts content from XML-style tags in the LLM response.
 * Used to separate the conversational response from the contract HTML.
 *
 * @param text - The full LLM response text
 * @param tag - The tag name to extract (e.g., "response", "contract")
 * @returns The content inside the tags, or empty string if not found
 */
function extractTagContent(text, tag) {
    const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i");
    const match = text.match(regex);
    return match ? match[1].trim() : "";
}
/**
 * Parses the review LLM response as JSON.
 * Handles both clean JSON and JSON embedded in markdown code blocks.
 *
 * @param text - The raw LLM response from the review pass
 * @returns Parsed review result with issues and summary
 */
function parseReviewResponse(text) {
    try {
        // Try to extract JSON from markdown code blocks first
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
        const parsed = JSON.parse(jsonStr);
        return {
            issues: Array.isArray(parsed.issues) ? parsed.issues : [],
            correctedContract: parsed.correctedContract || "",
            summary: parsed.summary || "Review completed.",
        };
    }
    catch (error) {
        logger_1.logger.warn("[CONTRACT-AI] Failed to parse review JSON, attempting manual extraction", error);
        // Fallback: try to extract meaningful content even if JSON is malformed
        return {
            issues: [],
            correctedContract: "",
            summary: "Review completed — unable to parse detailed results.",
        };
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Main Streaming Pipeline
// ─────────────────────────────────────────────────────────────────────────────
/**
 * The main contract builder AI pipeline. This is an async generator that
 * yields SSE events as the AI processes the user's request.
 *
 * Two-phase pipeline:
 *   Phase 1: RAG retrieval + LLM draft (streams tokens + html_update)
 *   Phase 2: Compliance RAG + LLM review (yields review_result)
 *
 * @param userMessage - The user's chat message
 * @param sessionHistory - Previous messages in this contract session
 * @param currentHtml - The current contract HTML (empty if first message)
 * @param contractType - The type of contract being built
 * @param language - The language for the contract (ar/fr/en)
 * @param currentVersion - The current version number of the contract
 * @yields ContractStreamEvent - Events for the frontend to consume
 */
async function* getContractStream(userMessage, sessionHistory, currentHtml, contractType, language, currentVersion) {
    try {
        // ═══════════════════════════════════════════════════════════════
        // PHASE 1: RAG-Powered Drafting
        // ═══════════════════════════════════════════════════════════════
        logger_1.logger.info(`[CONTRACT-AI] Starting contract stream`, {
            contractType,
            language,
            hasExistingHtml: currentHtml.length > 0,
            version: currentVersion,
        });
        yield { type: "step", content: "Searching Moroccan legal database..." };
        // Multi-query RAG retrieval against LanceDB
        const legalSources = await retrieveLegalContext(contractType, userMessage);
        if (legalSources.length > 0) {
            yield { type: "step", content: `Found ${legalSources.length} relevant legal references.` };
            yield { type: "sources", sources: legalSources };
        }
        else {
            yield { type: "step", content: "No specific references found — using general Moroccan law knowledge." };
            yield { type: "sources", sources: [] };
        }
        // Build the legal context string using existing buildContext utility
        const legalContext = (0, query_router_1.buildContext)(legalSources);
        // Build the system prompt with injected legal context
        const draftingPrompt = buildDraftingPrompt(legalContext, language);
        // Build messages array for the LLM
        const messages = [
            { role: "system", content: draftingPrompt },
        ];
        // Add session history (last 10 messages for context window management)
        for (const msg of sessionHistory.slice(-10)) {
            messages.push({
                role: msg.role,
                content: msg.content,
            });
        }
        // Build the user message with current contract context
        let userContent = userMessage;
        if (currentHtml) {
            userContent = `CURRENT CONTRACT HTML (modify this if user asks for edits):\n\`\`\`html\n${currentHtml}\n\`\`\`\n\nUSER REQUEST: ${userMessage}`;
        }
        messages.push({ role: "user", content: userContent });
        yield { type: "step", content: "Drafting contract under Moroccan law..." };
        // Stream the LLM response
        const stream = await client.chat.completions.create({
            model: CONTRACT_MODEL,
            messages,
            stream: true,
        });
        // Accumulate the full response to parse tags after streaming
        let fullResponse = "";
        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
                fullResponse += content;
                // Stream tokens from the <response> section to the chat panel
                // We check if we're still in the <response> section to avoid
                // streaming raw HTML to the chat
                const responseContent = extractTagContent(fullResponse, "response");
                if (responseContent && !fullResponse.includes("</response>")) {
                    // Still streaming inside <response> — send token
                    yield { type: "token", content };
                }
            }
        }
        // Parse the complete response
        const chatResponse = extractTagContent(fullResponse, "response");
        const contractHtml = extractTagContent(fullResponse, "contract");
        // If we couldn't stream tokens live (e.g., response came after contract),
        // send the full chat response as one token
        if (chatResponse && !fullResponse.includes("<response>")) {
            yield { type: "token", content: chatResponse };
        }
        // If no XML tags found, treat the whole response as chat text
        if (!chatResponse && !contractHtml) {
            logger_1.logger.warn("[CONTRACT-AI] No XML tags found in response, using full text as chat");
            yield { type: "token", content: fullResponse };
            yield { type: "done" };
            return;
        }
        // Send remaining chat text that wasn't streamed
        // (handles case where response tag closes mid-stream)
        if (chatResponse) {
            // Check if all tokens were already streamed
            const streamedSoFar = extractTagContent(fullResponse, "response");
            if (streamedSoFar !== chatResponse) {
                // Some text was missed during streaming, send the full response
                yield { type: "token", content: chatResponse };
            }
        }
        // If no contract HTML was generated (just a chat response), we're done
        if (!contractHtml) {
            logger_1.logger.info("[CONTRACT-AI] No contract HTML in response (chat-only reply)");
            yield { type: "done" };
            return;
        }
        // ═══════════════════════════════════════════════════════════════
        // PHASE 2: Legal Compliance Review
        // ═══════════════════════════════════════════════════════════════
        logger_1.logger.info("[CONTRACT-AI] Starting legal compliance review (Phase 2)");
        yield { type: "step", content: "Reviewing contract for legal compliance..." };
        // Compliance-specific RAG retrieval
        const complianceSources = await retrieveComplianceContext(contractType, contractHtml);
        const complianceContext = (0, query_router_1.buildContext)(complianceSources);
        logger_1.logger.info(`[CONTRACT-AI] Compliance RAG: ${complianceSources.length} references found`);
        // Run the review pass (non-streaming — we need the full JSON)
        const reviewPrompt = buildReviewPrompt(complianceContext, language);
        const reviewResponse = await client.chat.completions.create({
            model: CONTRACT_MODEL,
            messages: [
                { role: "system", content: reviewPrompt },
                {
                    role: "user",
                    content: `Review this contract:\n\`\`\`html\n${contractHtml}\n\`\`\`\n\nContract Type: ${contractType}\nLanguage: ${language}`,
                },
            ],
            stream: false,
        });
        const reviewText = reviewResponse.choices[0]?.message?.content || "";
        const reviewResult = parseReviewResponse(reviewText);
        logger_1.logger.info(`[CONTRACT-AI] Review complete: ${reviewResult.issues.length} issues found`, {
            critical: reviewResult.issues.filter(i => i.severity === "critical").length,
            warning: reviewResult.issues.filter(i => i.severity === "warning").length,
            info: reviewResult.issues.filter(i => i.severity === "info").length,
        });
        // Use corrected HTML if the review found and fixed issues, otherwise use original
        const finalHtml = reviewResult.correctedContract || contractHtml;
        const newVersion = currentVersion + 1;
        // Emit the results
        yield { type: "review_result", issues: reviewResult.issues, summary: reviewResult.summary };
        yield { type: "html_update", html: finalHtml, version: newVersion };
        const criticalCount = reviewResult.issues.filter(i => i.severity === "critical").length;
        if (criticalCount > 0) {
            yield { type: "step", content: `Contract ready — ${criticalCount} critical issue(s) found and corrected.` };
        }
        else if (reviewResult.issues.length > 0) {
            yield { type: "step", content: `Contract ready — ${reviewResult.issues.length} minor issue(s) noted.` };
        }
        else {
            yield { type: "step", content: "Contract ready — no legal issues found." };
        }
        yield { type: "done" };
    }
    catch (error) {
        logger_1.logger.error("[CONTRACT-AI] Pipeline error:", error);
        yield { type: "error", content: "An error occurred during contract generation." };
        yield { type: "done" };
    }
}
