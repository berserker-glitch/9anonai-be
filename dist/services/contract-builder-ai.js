"use strict";
/**
 * @fileoverview AI service for the Contract Builder feature — Rewritten.
 *
 * Architecture:
 *   Phase 1: RAG retrieval + LLM draft (streams chat text, sends HTML update)
 *   Phase 2: Legal compliance review (CONDITIONAL — only when contract HTML changes)
 *
 * Key improvements:
 * - Current contract HTML is in the system prompt (not the user message)
 * - Phase 2 review is advisory-only — it reports issues but does NOT replace the HTML
 * - Cleaner output format: plain chat text first, then optional <contract> tags
 * - Position-based streaming: chat text streams live, contract HTML is buffered
 * - Better edit instructions to preserve formatting consistency
 * - Lower temperature for consistent legal writing
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
// OpenRouter Client
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
// Language Instructions
// ─────────────────────────────────────────────────────────────────────────────
function getLanguageInstruction(language) {
    switch (language) {
        case "ar":
            return `LANGUAGE: Arabic (العربية)
All responses and contract content MUST be in Arabic.
Use formal Moroccan legal Arabic terminology.
Contract HTML must use dir="rtl" on its root element.`;
        case "en":
            return `LANGUAGE: English
All responses and contract content MUST be in English.
Use standard legal terminology adapted for Moroccan law.`;
        case "fr":
        default:
            return `LANGUAGE: French (Français)
All responses and contract content MUST be in French.
Use formal Moroccan legal French terminology.`;
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// System Prompts
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Builds the main system prompt for Phase 1 (drafting/editing/chatting).
 *
 * KEY DESIGN DECISION: The current contract HTML lives here in the system
 * prompt, NOT in the user message. This keeps the conversation history clean
 * and prevents the AI from being confused by raw HTML in user turns.
 */
function buildSystemPrompt(legalContext, currentHtml, language, contractType) {
    const langInstruction = getLanguageInstruction(language);
    const contractSection = currentHtml
        ? `
══ CURRENT CONTRACT (live draft — modify when user requests edits) ══
${currentHtml}
══ END CURRENT CONTRACT ══`
        : "\n[No contract has been drafted yet.]";
    return `You are 9anon Contract Builder — an expert Moroccan legal document drafter.
You help users create, edit, and refine legally compliant contracts under Moroccan law.

${langInstruction}

══════════════════════════════════════════════════════════════
MOROCCAN LAW REFERENCES (from verified legal database):
══════════════════════════════════════════════════════════════
${legalContext || "No specific legal documents retrieved. Use your knowledge of Moroccan law (DOC, Code du Travail, Code de Commerce, etc.) but note this limitation to the user."}
══════════════════════════════════════════════════════════════

CONTRACT TYPE: ${contractType}
${contractSection}

═══════════════════ HOW TO RESPOND ═══════════════════

SCENARIO 1 — NEW CONTRACT (no current contract exists):
• Ask the user 2–4 smart clarifying questions about parties, terms, and specifics.
• Once you have enough information, generate the FULL contract in HTML.
• If the user already provided detailed info, you may generate immediately.

SCENARIO 2 — EDIT REQUEST (current contract exists, user requests a change):
• Identify EXACTLY what the user wants changed.
• Output the FULL contract HTML with ONLY the requested changes applied.
• CRITICAL: Do NOT reformat, restructure, reorganize, or restyle anything
  that the user did not ask you to change. Preserve every tag, every space,
  every structure exactly as-is — only modify the specific clause or section.

SCENARIO 3 — QUESTION (user asks about law, a clause, or the contract):
• Answer the question in your conversational text.
• Do NOT output any <contract> tags. The existing contract stays unchanged.

SCENARIO 4 — GENERAL CHAT (greetings, thanks, etc.):
• Respond naturally. No <contract> tags needed.

═══════════════════ OUTPUT FORMAT ═══════════════════

STEP 1: Write your conversational message first.
  • This text appears in the chat panel.
  • Explain what you did, cite relevant legal articles, or ask questions.
  • Use markdown (bold, lists, etc.) for readability.

STEP 2 (only if you generated or modified the contract):
  Append the FULL contract HTML at the end, wrapped in tags:

  <contract>
  ...the complete, self-contained contract HTML...
  </contract>

  If you did NOT modify the contract, do NOT include <contract> tags.
  Never include empty <contract></contract> tags.

═══════════════════ CONTRACT HTML RULES ═══════════════════

Structure:
  <h1 style="text-align:center">CONTRACT TITLE</h1>
  <p><strong>Date:</strong> [DATE] &nbsp;&nbsp; <strong>Place:</strong> [CITY]</p>
  <h2>BETWEEN</h2>
  <p>Party details...</p>
  <h2>Article 1 — [Title]</h2>
  <p>Clause text...</p>
  ... more articles ...
  <h2>Signatures</h2>
  <div style="display:flex;justify-content:space-between;margin-top:40px">
    <div style="text-align:center;width:45%">
      <p>____________________</p>
      <p><strong>[Party 1 Name]</strong></p>
    </div>
    <div style="text-align:center;width:45%">
      <p>____________________</p>
      <p><strong>[Party 2 Name]</strong></p>
    </div>
  </div>

Rules:
  • Use semantic HTML: h1, h2, h3, p, ol, li, ul, strong, em, table, br
  • Use <strong> for emphasis — do NOT use ALL CAPS except in the title
  • Use inline styles sparingly (text-align, margin, padding) — no CSS classes
  • Use [PLACEHOLDER] markers for missing info (e.g. [NOM DU BAILLEUR])
  • Do NOT include <html>, <head>, <body>, <style>, or <meta> tags
  • For Arabic: wrap everything in <div dir="rtl" style="text-align:right">
  • Cite applicable Moroccan law articles in each clause where relevant

═══════════════════ LEGAL RULES ═══════════════════

• Ground every clause in Moroccan law. Cite specific articles (e.g. "Article 627 du DOC").
• Include ALL mandatory clauses required by law for this contract type.
• NEVER fabricate law references — only cite articles from the provided context or well-known codes.
• If unsure about a specific legal requirement, say so and ask the user.
• Follow standard Moroccan contract structure and terminology.`;
}
/**
 * Builds the review system prompt for Phase 2 (compliance audit).
 * The review is ADVISORY ONLY — it does not modify the contract HTML.
 */
function buildReviewPrompt(complianceContext, language) {
    const langInstruction = getLanguageInstruction(language);
    return `You are a Moroccan legal compliance auditor. Review the contract for legal issues.

${langInstruction}

══════════════════════════════════════════════════════════════
MOROCCAN LAW COMPLIANCE REFERENCES:
══════════════════════════════════════════════════════════════
${complianceContext || "No specific compliance references found. Use general Moroccan legal principles."}
══════════════════════════════════════════════════════════════

CHECKLIST:
1. Are ALL mandatory clauses present for this contract type under Moroccan law?
2. Do any clauses contradict Moroccan legislation?
3. Are there abusive or unenforceable terms?
4. Are required legal formalities included (signatures, dates, witnesses, registration)?
5. Is the language precise enough to avoid disputes?
6. Are both parties' rights adequately protected?
7. Are penalty/termination clauses within legal limits?

RESPOND IN VALID JSON ONLY — no markdown code blocks, no explanation, just the JSON object:

{
    "issues": [
        {
            "clause": "Article/section reference",
            "severity": "critical",
            "description": "What is wrong and why",
            "lawReference": "Applicable law article"
        }
    ],
    "summary": "Brief 1–3 sentence summary of the review"
}

SEVERITY LEVELS:
  critical — Missing mandatory clause, illegal/void term. Must be fixed.
  warning  — Potentially problematic. Recommended fix.
  info     — Minor suggestion for improvement.

RULES:
  • Only flag genuine legal issues, not stylistic preferences.
  • Always provide a specific law reference for each issue.
  • If the contract is well-drafted, return an empty issues array with a positive summary.
  • Do NOT output a correctedContract — your job is to report issues only.`;
}
// ─────────────────────────────────────────────────────────────────────────────
// RAG Retrieval
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Multi-query RAG retrieval from LanceDB for contract drafting.
 * Runs primary (domain-specific) + secondary (general obligations) + tertiary
 * (unfiltered, user query) searches, deduplicates, and returns top results.
 */
async function retrieveLegalContext(contractType, userQuery) {
    const domains = CONTRACT_TYPE_DOMAINS[contractType] || CONTRACT_TYPE_DOMAINS.custom;
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
        // Primary: domain-specific law categories
        if (domains.primary.length > 0) {
            logger_1.logger.info(`[CONTRACT-AI] Primary RAG: type="${contractType}"`, { categories: domains.primary });
            const primaryResults = await (0, retriever_1.searchLegalDocs)(userQuery, 10, { categories: domains.primary });
            addResults(primaryResults);
            logger_1.logger.debug(`[CONTRACT-AI] Primary: ${primaryResults.length} results`);
        }
        // Secondary: general obligations/contracts law
        logger_1.logger.info(`[CONTRACT-AI] Secondary RAG (general obligations)`);
        const secondaryResults = await (0, retriever_1.searchLegalDocs)(userQuery, 8, { categories: domains.secondary });
        addResults(secondaryResults);
        logger_1.logger.debug(`[CONTRACT-AI] Secondary: ${secondaryResults.length} results`);
        // Tertiary: unfiltered search for edge cases
        logger_1.logger.info(`[CONTRACT-AI] Tertiary RAG (unfiltered)`);
        const tertiaryResults = await (0, retriever_1.searchLegalDocs)(userQuery, 5);
        addResults(tertiaryResults);
        logger_1.logger.debug(`[CONTRACT-AI] Tertiary: ${tertiaryResults.length} results`);
    }
    catch (error) {
        logger_1.logger.error("[CONTRACT-AI] RAG retrieval error:", error);
    }
    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    const topResults = allResults.slice(0, 15);
    logger_1.logger.info(`[CONTRACT-AI] Total RAG: ${allResults.length}, using top ${topResults.length}`);
    return topResults;
}
/**
 * Compliance-specific RAG retrieval for the review phase.
 * Searches for mandatory clauses, prohibited terms, and required formalities.
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
        const mandatoryQuery = `clauses obligatoires contrat ${contractType} droit marocain`;
        logger_1.logger.info(`[CONTRACT-AI] Compliance RAG: mandatory clauses`);
        const mandatoryResults = await (0, retriever_1.searchLegalDocs)(mandatoryQuery, 8);
        addResults(mandatoryResults);
        const prohibitedQuery = `clauses abusives interdites contrat ${contractType} maroc`;
        logger_1.logger.info(`[CONTRACT-AI] Compliance RAG: prohibited terms`);
        const prohibitedResults = await (0, retriever_1.searchLegalDocs)(prohibitedQuery, 5);
        addResults(prohibitedResults);
        const formalitiesQuery = `formalités légales obligatoires contrat ${contractType} maroc`;
        logger_1.logger.info(`[CONTRACT-AI] Compliance RAG: formalities`);
        const formalitiesResults = await (0, retriever_1.searchLegalDocs)(formalitiesQuery, 5);
        addResults(formalitiesResults);
    }
    catch (error) {
        logger_1.logger.error("[CONTRACT-AI] Compliance RAG error:", error);
    }
    allResults.sort((a, b) => (b.score || 0) - (a.score || 0));
    return allResults.slice(0, 12);
}
// ─────────────────────────────────────────────────────────────────────────────
// Response Parsing
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Strips legacy XML wrapper tags that the AI might output.
 * These tags (<response>, </response>, and stray <contract> leakage)
 * should never appear in the final chat text shown to the user.
 *
 * This handles:
 *   - Old sessions where the AI was prompted to wrap text in <response> tags
 *   - New sessions where the AI might still use that format from conditioning
 *   - Any other stray XML-style wrapper tags
 */
function stripLegacyXmlTags(text) {
    return text
        // Remove <response> and </response> wrapper tags (old format)
        .replace(/<\/?response>/gi, "")
        // Remove any <contract> tag leakage that reached the chat portion
        .replace(/<contract>[\s\S]*/i, "")
        // Remove other common AI-generated wrapper tags
        .replace(/<\/?chat>/gi, "")
        .replace(/<\/?message>/gi, "")
        .trim();
}
/**
 * Extracts HTML content from inside <contract>...</contract> tags.
 * Returns empty string if no tags found.
 */
function extractContractHtml(text) {
    const match = text.match(/<contract>([\s\S]*?)<\/contract>/i);
    return match ? match[1].trim() : "";
}
/**
 * Extracts the conversational chat message — everything before the <contract> tag.
 * If no <contract> tag exists, returns the entire text.
 * Strips any legacy XML wrapper tags (<response>, </response>, etc.) from the result.
 */
function extractChatMessage(text) {
    // Find the <contract> tag (case-insensitive)
    const lower = text.toLowerCase();
    const contractIdx = lower.indexOf("<contract>");
    const rawChat = contractIdx === -1 ? text : text.slice(0, contractIdx);
    return stripLegacyXmlTags(rawChat);
}
/**
 * Parses the review LLM response as JSON.
 * Handles both clean JSON and JSON embedded in markdown code blocks.
 */
function parseReviewResponse(text) {
    try {
        // Strip markdown code fences if present
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        const jsonStr = jsonMatch ? jsonMatch[1].trim() : text.trim();
        const parsed = JSON.parse(jsonStr);
        return {
            issues: Array.isArray(parsed.issues) ? parsed.issues : [],
            summary: parsed.summary || "Review completed.",
        };
    }
    catch {
        logger_1.logger.warn("[CONTRACT-AI] Failed to parse review JSON, returning empty result");
        return {
            issues: [],
            summary: "Review completed — unable to parse detailed results.",
        };
    }
}
// ─────────────────────────────────────────────────────────────────────────────
// Main Streaming Pipeline
// ─────────────────────────────────────────────────────────────────────────────
/**
 * The main contract builder AI pipeline. Async generator yielding SSE events.
 *
 * Phase 1: RAG retrieval → build system prompt → stream LLM response
 *          Chat text is streamed live. Contract HTML is sent as a single update.
 *
 * Phase 2 (conditional): Only runs if Phase 1 produced contract HTML.
 *          Compliance RAG → LLM review → advisory issues list.
 *          Does NOT modify the contract — just reports issues.
 *
 * @param userMessage    - The user's chat message
 * @param sessionHistory - Previous messages in this contract session
 * @param currentHtml    - The current contract HTML (empty if first message)
 * @param contractType   - The type of contract (rental, employment, etc.)
 * @param language       - The language (ar/fr/en)
 * @param currentVersion - The current version number
 */
async function* getContractStream(userMessage, sessionHistory, currentHtml, contractType, language, currentVersion) {
    try {
        // ═══════════════════════════════════════════════════════════════
        // PHASE 1: RAG-Powered Drafting
        // ═══════════════════════════════════════════════════════════════
        logger_1.logger.info("[CONTRACT-AI] Starting pipeline", {
            contractType,
            language,
            hasHtml: currentHtml.length > 0,
            version: currentVersion,
        });
        yield { type: "step", content: "Searching Moroccan legal database..." };
        // Multi-query RAG retrieval
        const legalSources = await retrieveLegalContext(contractType, userMessage);
        if (legalSources.length > 0) {
            yield {
                type: "step",
                content: `Found ${legalSources.length} relevant legal references.`,
            };
            yield { type: "sources", sources: legalSources };
        }
        else {
            yield {
                type: "step",
                content: "No specific references found — using general knowledge.",
            };
            yield { type: "sources", sources: [] };
        }
        // Build the system prompt with legal context + current contract HTML
        const legalContext = (0, query_router_1.buildContext)(legalSources);
        const systemPrompt = buildSystemPrompt(legalContext, currentHtml, language, contractType);
        // Build the messages array: system → history → user message
        const messages = [
            { role: "system", content: systemPrompt },
        ];
        // Add session history (last 10 messages to manage context window).
        // IMPORTANT: Strip legacy XML tags from stored assistant messages so the
        // AI doesn't learn to continue using the old <response>...</response> format.
        for (const msg of sessionHistory.slice(-10)) {
            const content = msg.role === "assistant"
                ? stripLegacyXmlTags(msg.content)
                : msg.content;
            messages.push({
                role: msg.role,
                content,
            });
        }
        // The user message goes in clean — no HTML injection
        messages.push({ role: "user", content: userMessage });
        yield { type: "step", content: "Drafting response..." };
        // ── Stream the LLM response ─────────────────────────────────
        const stream = await client.chat.completions.create({
            model: CONTRACT_MODEL,
            messages,
            stream: true,
            temperature: 0.3,
        });
        // Position-based streaming:
        // We stream all text to the frontend as "token" events UNTIL we hit
        // the <contract> tag. After that, we buffer silently.
        let fullResponse = "";
        let lastStreamedPos = 0;
        let hitContractTag = false;
        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content || "";
            if (!delta)
                continue;
            fullResponse += delta;
            // Look for the <contract> opening tag
            const tagPos = fullResponse.indexOf("<contract>");
            if (tagPos === -1) {
                // No contract tag yet — stream all new content to the chat,
                // but strip any legacy XML wrapper tags before sending.
                const newContent = stripLegacyXmlTags(fullResponse.slice(lastStreamedPos));
                if (newContent) {
                    yield { type: "token", content: newContent };
                    lastStreamedPos = fullResponse.length;
                }
            }
            else if (!hitContractTag) {
                // Just found the contract tag — stream any remaining chat text before it.
                hitContractTag = true;
                if (lastStreamedPos < tagPos) {
                    const remaining = stripLegacyXmlTags(fullResponse.slice(lastStreamedPos, tagPos));
                    if (remaining.trim()) {
                        yield { type: "token", content: remaining };
                    }
                }
                lastStreamedPos = fullResponse.length;
            }
            // If we already hit the tag, just buffer silently
        }
        // ── Parse the completed response ────────────────────────────
        const contractHtml = extractContractHtml(fullResponse);
        const chatMessage = extractChatMessage(fullResponse);
        // Edge case: if nothing was streamed (e.g. AI put everything in weird
        // format, or response was a single chunk), send the chat message now.
        // chatMessage is already stripped of legacy XML tags by extractChatMessage().
        if (lastStreamedPos === 0 && chatMessage) {
            yield { type: "token", content: chatMessage };
        }
        // If no contract HTML was produced, this was a chat-only reply → done
        if (!contractHtml) {
            logger_1.logger.info("[CONTRACT-AI] Chat-only response (no contract HTML generated)");
            yield { type: "done" };
            return;
        }
        // Contract HTML was generated — send it as a single update
        const newVersion = currentVersion + 1;
        yield { type: "html_update", html: contractHtml, version: newVersion };
        yield { type: "step", content: "Reviewing for legal compliance..." };
        // ═══════════════════════════════════════════════════════════════
        // PHASE 2: Legal Compliance Review (advisory only)
        // ═══════════════════════════════════════════════════════════════
        logger_1.logger.info("[CONTRACT-AI] Starting compliance review (Phase 2)");
        try {
            const complianceSources = await retrieveComplianceContext(contractType, contractHtml);
            const complianceContext = (0, query_router_1.buildContext)(complianceSources);
            logger_1.logger.info(`[CONTRACT-AI] Compliance RAG: ${complianceSources.length} references`);
            const reviewPrompt = buildReviewPrompt(complianceContext, language);
            const reviewResponse = await client.chat.completions.create({
                model: CONTRACT_MODEL,
                messages: [
                    { role: "system", content: reviewPrompt },
                    {
                        role: "user",
                        content: `Review this ${contractType} contract:\n\n${contractHtml}`,
                    },
                ],
                stream: false,
                temperature: 0.1,
            });
            const reviewText = reviewResponse.choices[0]?.message?.content || "";
            const review = parseReviewResponse(reviewText);
            logger_1.logger.info(`[CONTRACT-AI] Review complete: ${review.issues.length} issues`, {
                critical: review.issues.filter((i) => i.severity === "critical").length,
                warning: review.issues.filter((i) => i.severity === "warning").length,
                info: review.issues.filter((i) => i.severity === "info").length,
            });
            // Send review results (advisory — does NOT change the HTML)
            yield { type: "review_result", issues: review.issues, summary: review.summary };
            // Final step message
            const criticalCount = review.issues.filter((i) => i.severity === "critical").length;
            if (criticalCount > 0) {
                yield {
                    type: "step",
                    content: `Contract ready — ${criticalCount} critical issue(s) found. Ask me to fix them.`,
                };
            }
            else if (review.issues.length > 0) {
                yield {
                    type: "step",
                    content: `Contract ready — ${review.issues.length} suggestion(s) noted.`,
                };
            }
            else {
                yield { type: "step", content: "Contract ready — no legal issues found." };
            }
        }
        catch (reviewError) {
            // Review failure is non-blocking — the contract is still usable
            logger_1.logger.error("[CONTRACT-AI] Review failed (non-blocking):", reviewError);
            yield { type: "step", content: "Contract ready — review could not be completed." };
        }
        yield { type: "done" };
    }
    catch (error) {
        logger_1.logger.error("[CONTRACT-AI] Pipeline error:", error);
        yield { type: "error", content: "An error occurred during contract generation." };
        yield { type: "done" };
    }
}
