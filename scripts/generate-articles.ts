/**
 * Automated Multilingual Blog Generator
 * 
 * Uses the RAG system to retrieve Moroccan legal context and generates
 * 8 professional blog articles about Moroccan law in 3 languages (AR, EN, FR).
 * 
 * @module scripts/generate-articles
 * @requires OpenRouter API key set in environment
 */

import dotenv from "dotenv";
// Load environment variables before other imports
dotenv.config();

import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { getTable } from "../src/services/db";
import { getEmbedding } from "../src/services/bi";
import sharp from "sharp";

/**
 * GLOBAL CONFIGURATION
 * Change this to control how many articles are researched and generated.
 */
const NUM_ARTICLES = 8;
// Configure OpenAI client with OpenRouter
const client = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": "https://github.com/moroccan-legal-ai",
        "X-Title": "9anon - Blog Generator",
    },
});

/**
 * Dedicated client for Perplexity sonar-pro search.
 * Uses the same OpenRouter base but needs its own instance so we can
 * pass a different X-Title for tracking if needed.
 */
const perplexityClient = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": "https://9anonai.com",
        "X-Title": "9anon - Trend Research",
    },
});

/**
 * Blog topics to generate - covering different areas of Moroccan law
 * Each topic includes a slug, titles in 3 languages, and keywords for RAG search
 */
/**
 * Scan existing blogs to get a set of used slugs
 */
function getExistingSlugs(outputDir: string): Set<string> {
    const slugs = new Set<string>();
    if (!fs.existsSync(outputDir)) return slugs;

    const files = fs.readdirSync(outputDir);
    files.forEach(file => {
        if (file.endsWith(".md")) {
            // Remove lang suffixes (.en.md, .fr.md) and extension
            const slug = file.replace(/\.(en|fr)\.md$/, "").replace(/\.md$/, "");
            slugs.add(slug);
        }
    });
    return slugs;
}

/**
 * Step 1 of the topic pipeline: search for trending Moroccan law topics.
 *
 * Uses `perplexity/sonar-pro` via OpenRouter — this model performs live
 * web searches and returns grounded results with real citations.
 * The goal is to find what Moroccans are actually searching about their
 * laws RIGHT NOW, so our blogs target real search demand.
 *
 * @param count - How many trend clusters to discover
 * @returns A rich text summary of trending legal topics with citations
 */
async function searchTrendingTopics(existingList: string, count: number = 8): Promise<string> {
    console.log(`   🔎 Querying Perplexity sonar-pro for trending Moroccan law searches...`);

    const searchPrompt = `You are a legal content researcher specializing in the KINGDOM OF MOROCCO. Search the web comprehensively to find:

1. What legal topics are Moroccans actively searching for right now?
2. What new Moroccan laws, reforms, or legal changes (Dahir, Decrees, Circulars) have been announced or discussed recently?
3. What legal problems or questions are most commonly asked in Morocco?

DO NOT suggest or research these ALREADY PUBLISHED topics. You MUST find COMPLETELY NEW and UNIQUE legal developments or questions. 
CRITICAL: If a topic is even remotely similar to an existing one, DISCARD IT. We are looking for "Gaps" in our current coverage of 143+ articles.
Do not suggest "TikTok ban appeal" or generic non-legal trends. 
Only suggest a topic related to an existing one IF there is a major new Law/Dahir/Decree published in the last 30 days that fundamentally changes the previous coverage.

STRICT SOURCE PRIORITY (Search these first):
- الجريدة الرسمية (Official Gazette - sgg.gov.ma)
- المجلس الأعلى للسلطة القضائية (CSPJ - cspj.ma)
- محكمة النقض (Court of Cassation - cassation.cspj.ma)
- وزارة العدل (Ministry of Justice - justice.gov.ma)
- الأمانة العامة للحكومة (SGG - sgg.gov.ma)
- هيئة المحامين بالمغرب (ABAM - abam.ma)
- Moroccan news portals: Hespress, Le360, Médias24, Yabiladi, 2M, TelQuel

GEOGRAPHIC RESTRAINTS:
- ONLY return results related to the Kingdom of Morocco.
- EXCLUDE legal news from other countries (e.g., if a topic mentions "Morocco" but refers to non-Moroccan law, ignore it).
- EXCLUDE social media trends unless they directly relate to a specific Moroccan legal reform or procedural change.

Focus on these legal domains:
- Family law (Moudawana reforms, divorce, custody, inheritance)
- Labor law (Code du Travail reforms, wages, strikes, remote work)
- Criminal law (penal code reforms, cybercrime, drug laws)
- Real estate and property law
- Business and commercial law (company formation, taxes)
- Digital law (data protection, e-commerce, crypto)
- Immigration and nationality
- Consumer rights

Return a detailed report of at least ${count} distinct trending topics, including:
- The topic name and why it's trending
- What specific questions people are asking
- Any recent legislative changes driving the interest (cite specific Dahir/Law numbers if found)
- Relevant search terms in Arabic and French

Be specific and data-driven. Cite your sources.`;

    try {
        const response = await perplexityClient.chat.completions.create({
            // perplexity/sonar-pro performs live web search via OpenRouter
            model: "perplexity/sonar-pro",
            messages: [
                {
                    role: "user",
                    content: searchPrompt,
                }
            ],
            // sonar-pro supports up to 8k output — we want detailed results
            max_tokens: 4000,
        });

        const result = response.choices[0]?.message?.content || "";
        console.log(`   ✅ Perplexity returned ${result.length} chars of trend data`);

        // Log citations if available (Perplexity returns these in non-standard fields)
        const rawResponse = response as any;
        const citations: string[] = rawResponse?.citations || [];
        if (citations.length > 0) {
            console.log(`   📚 Citations: ${citations.slice(0, 5).join(", ")}${citations.length > 5 ? ` (+${citations.length - 5} more)` : ""}`);
        }

        return result;
    } catch (error) {
        console.error(`   ❌ Perplexity search failed:`, error);
        // Fall back to empty string — generateNewTopics will handle it gracefully
        return "";
    }
}

/**
 * Step 2 of the topic pipeline: synthesize search results into blog topics.
 *
 * Feeds the Perplexity trend report to Gemini which then picks the best
 * angles for blog articles — ensuring every post we generate targets
 * something people are actually searching for.
 *
 * @param existingSlugs - Slugs of already-published articles (to avoid duplication)
 * @param count - Number of new topics to generate
 * @returns Array of structured blog topic objects
 */
async function generateNewTopics(existingSlugs: Set<string>, count: number = 8): Promise<any[]> {
    const existingList = Array.from(existingSlugs).join(", ");

    // --- Phase 1: Discover what people are searching for via Perplexity ---
    const trendReport = await searchTrendingTopics(existingList, count);

    // --- Phase 2: Synthesize trend data into structured blog topics ---
    const systemPrompt = `You are a content strategist for "9anon", Morocco's #1 AI legal platform.

You have been given a live research report showing what Moroccans are currently searching for
regarding their laws. Your job is to create ${count} NEW blog article topics based on this real
search demand — topics that will rank on Google because people are actually looking for them.

ALREADY PUBLISHED (DO NOT REPEAT THESE):
${existingList}

${trendReport ? `LIVE TREND RESEARCH FROM THE WEB:
---
${trendReport}
---

Base your topics on the real search trends above. 

CRITICAL ANTI-DUPLICATION RULE: 
You are STRICTLY FORBIDDEN from generating topics that overlap with the existing list. 
The user is concerned about receiving redundant topics. 
Look for niche areas of Moroccan law: administrative litigation, tax disputes, specific commercial regulations, or very recent 2026 Dahirs.
If the search result includes something like "TikTok ban", IGNORE IT as it is likely not a Moroccan legal reform.` : ""}

RULES:
- Each topic must address a real legal question Moroccans are searching for
- Topics should be specific and actionable, not vague
- Prefer topics where there is a recent law change or legal development driving interest
- Mix individual-focused topics (citizen rights, family law) with business topics
- The slug must be in English kebab-case and unique

TITLE RULES (for all 3 languages):
- Start with "How to", a number, or the specific law number (e.g. "Law 10-95")
- Include the current year (2026) for freshness signals
- Add the word "Morocco" or "Moroccan" for geo-targeting
- Max 60 characters — Google truncates longer titles
- Avoid academic phrasing like "An Analysis of" or "Comprehensive Guide to"
- Use power words: "Full Text", "Step-by-Step", "Explained", "Your Rights"
- Use "vs", numbers, or parenthetical years for CTR boost

DESCRIPTION RULES (for all 3 languages):
- 140-155 characters — fills the full Google snippet on desktop
- Formula: [Problem/Question] + [What you'll learn] + [Trust signal]
- Include 1-2 specific details (law numbers, procedures, costs)
- End with an action or benefit, not a trailing sentence
- Never start with "A comprehensive guide" — that's a CTR killer

CATEGORY RULES:
- Assign exactly ONE category from this list: "family-law", "labor-law", "criminal-law", "real-estate", "business-law", "digital-law", "immigration", "consumer-rights", "administrative-law", "tax-law", "traffic-law"
- Choose the most specific matching category

Return ONLY a valid JSON array with exactly this structure:
[
  {
    "slug": "kebab-case-slug-in-english",
    "titles": {
      "ar": "Arabic Title",
      "en": "English Title",
      "fr": "French Title"
    },
    "descriptions": {
      "ar": "Arabic Description (2 sentences)",
      "en": "English Description (2 sentences)",
      "fr": "French Description (2 sentences)"
    },
    "searchQuery": "Arabic search query for legal database lookup",
    "keywords": ["keyword1", "keyword2", "keyword3"],
    "trendReason": "1-sentence explanation of why this topic is trending",
    "category": "one-of-the-categories-above"
  }
]`;

    const response = await client.chat.completions.create({
        model: "google/gemini-2.0-flash-001",
        messages: [{ role: "user", content: systemPrompt }],
        max_tokens: 8000,
        response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content || "[]";
    try {
        let jsonStr = content
            .replace(/^```(json)?\s*/, "")
            .replace(/\s*```$/, "")
            .trim()
            // Fix trailing commas before closing braces/brackets
            .replace(/,\s*([}\]])/g, '$1');

        const parsed = JSON.parse(jsonStr);
        const topics = Array.isArray(parsed) ? parsed : (parsed.topics || []);

        // Log the trend reasons so the operator knows why each topic was chosen
        topics.forEach((t: any, i: number) => {
            console.log(`      ${i + 1}. ${t.slug} — ${t.trendReason || "(no reason given)"}`);
        });

        return topics;
    } catch (e) {
        console.error("Failed to parse generated topics:", e);
        console.error("Raw content:", content);
        return [];
    }
}

/**
 * Language configuration for article generation
 */
const LANGUAGES = [
    { code: "ar", name: "Arabic", suffix: "", direction: "rtl" },
    { code: "en", name: "English", suffix: ".en", direction: "ltr" },
    { code: "fr", name: "French", suffix: ".fr", direction: "ltr" }
];

/**
 * Interface for a generated blog article
 */
interface GeneratedBlog {
    slug: string;
    language: string;
    title: string;
    description: string;
    content: string;
    image: string;
    sources: string[];
    generatedAt: Date;
    /** SEO keywords for meta tags */
    keywords?: string[];
    /** Legal category for filtering */
    category?: string;
    /** Key takeaways for rich snippets */
    keyTakeaways?: string[];
}

/**
 * Search legal documents using the RAG system
 * 
 * @param query - Search query in Arabic or French
 * @param limit - Maximum number of results to return
 * @returns Array of legal document results
 */
async function searchLegalDocs(query: string, limit: number = 5): Promise<any[]> {
    try {
        const table = await getTable();
        if (!table) {
            console.warn("   ⚠️  RAG table not found, proceeding without context.");
            return [];
        }

        // Get embedding for the search query
        const queryEmbedding = await getEmbedding(query);

        // Perform vector similarity search
        const results = await table.search(queryEmbedding).limit(limit).toArray();

        return results.map((r: any, idx: number) => ({
            id: r.id || `doc_${idx}`,
            text: r.text,
            source_file: r.source_file,
            category: r.category,
            subcategory: r.subcategory,
            document_name: r.document_name
        }));
    } catch (error) {
        console.error("   ❌ Error searching legal docs:", error);
        return [];
    }
}

/**
 * Build context string from RAG results for the LLM
 * 
 * @param sources - Array of legal document sources
 * @returns Formatted context string
 */
function buildContext(sources: any[]): string {
    if (sources.length === 0) {
        return "";
    }

    return sources.map((doc, i) => {
        return `[Reference ${i + 1}]: ${doc.document_name || "Legal Document"}
Category: ${doc.category || "General"}${doc.subcategory ? ` > ${doc.subcategory}` : ""}
---
${doc.text}
---`;
    }).join("\n\n");
}

/**
 * Step 3 of the topic pipeline: SERP competitor analysis.
 *
 * Uses Perplexity to search for the exact topic on Google Morocco,
 * identify top-ranking articles and their content gaps, and extract
 * "People Also Ask" questions. This intelligence is fed into the
 * article generation prompt so our content outcompetes existing results.
 *
 * @param topic - The blog topic to research
 * @returns A structured brief with competitor gaps and PAA questions
 */
async function analyzeSERPCompetitors(topic: BlogTopic): Promise<string> {
    console.log(`   🔬 Analyzing SERP competitors for: "${topic.titles.en}"...`);

    const serpPrompt = `Search Google and authoritative Moroccan portals for the following query and analyze the top results. 

Query: "${topic.titles.en}" Kingdom of Morocco law

Additional specific searches:
- site:sgg.gov.ma "${topic.titles.ar}" OR "${topic.titles.fr}"
- site:cspj.ma "${topic.titles.ar}"
- site:justice.gov.ma "${topic.titles.ar}"

Also search in French: "${topic.titles.fr}"
And in Arabic: "${topic.titles.ar}"

For each of the top 5 ranking results, analyze:
1. What specific legal articles/laws do they cite? (Prioritize official Dahir or Law numbers)
2. What sections/topics do they cover?
3. What is their approximate word count?
4. What do they MISS or cover poorly?

Also extract:
- All "People Also Ask" questions related to this topic (localized to Morocco)
- Related search suggestions at the bottom of the SERP
- Any featured snippet content

Return a structured brief with:
COMPETITOR GAPS: What the top results miss or cover poorly
PEOPLE ALSO ASK: List of PAA questions found
MUST-COVER TOPICS: Sections we MUST include to outrank competitors (including specific legal citations)
RECOMMENDED WORD COUNT: Based on competitor analysis`;

    try {
        const response = await perplexityClient.chat.completions.create({
            model: "perplexity/sonar-pro",
            messages: [{ role: "user", content: serpPrompt }],
            max_tokens: 3000,
        });

        const result = response.choices[0]?.message?.content || "";
        console.log(`   ✅ SERP analysis complete (${result.length} chars)`);
        return result;
    } catch (error) {
        console.error(`   ❌ SERP analysis failed:`, error);
        // Non-fatal: article generation continues without SERP data
        return "";
    }
}

/**
 * Build a "link bank" of existing articles for internal linking.
 *
 * Reads all existing blog markdown files in the output directory,
 * extracts their slug, title, and keywords from frontmatter, and
 * returns a formatted string the LLM can use to naturally embed
 * internal links in the generated article.
 *
 * @param outputDir - Directory where blog markdown files live
 * @param currentSlug - Slug of the article being generated (excluded)
 * @param lang - Language code to read the right file variant
 * @returns A formatted list of existing articles for LLM context
 */
function buildLinkBank(outputDir: string, currentSlug: string, lang: string): string {
    try {
        const files = fs.readdirSync(outputDir);

        // Filter files for the target language
        const targetFiles = files.filter(f => {
            if (lang === "ar") {
                return f.endsWith(".md") && !f.endsWith(".en.md") && !f.endsWith(".fr.md");
            }
            return f.endsWith(`.${lang}.md`);
        });

        const linkEntries: string[] = [];

        for (const file of targetFiles) {
            const slug = file.replace(/\.(?:[a-z]{2}\.)?md$/, "");
            // Skip the article we're currently generating
            if (slug === currentSlug) continue;

            const filepath = path.join(outputDir, file);
            const content = fs.readFileSync(filepath, "utf-8");

            // Extract title from frontmatter
            const titleMatch = content.match(/^title:\s*"(.+)"/m);
            const title = titleMatch ? titleMatch[1] : slug;

            // Extract keywords if available
            const kwMatch = content.match(/^keywords:\s*\[(.+)\]/m);
            const keywords = kwMatch ? kwMatch[1] : "";

            linkEntries.push(`- [${title}](/blog/${slug}) ${keywords ? `(keywords: ${keywords})` : ""}`);
        }

        if (linkEntries.length === 0) return "";

        return `\nINTERNAL LINK BANK — Use these to embed 2-3 contextually relevant links:\n${linkEntries.join("\n")}`;
    } catch {
        return "";
    }
}

/**
 * Post-generation quality validation gate.
 *
 * Checks that the generated article meets minimum quality thresholds
 * before it's saved. Returns a list of failures; an empty array means
 * the article passed all checks.
 *
 * @param content - The generated markdown article content
 * @param lang - Language code of the article
 * @returns Array of failure descriptions (empty = passed)
 */
function validateArticleQuality(content: string, lang: string): string[] {
    const failures: string[] = [];

    /**
     * 1. Content length check — uses character count for Arabic (Arabic words
     * average 5-7 chars vs English 4-5, so word splitting underreports).
     * For EN/FR, use word count. Thresholds are tuned to what the LLM
     * actually produces at max_tokens=8000.
     */
    if (lang === "ar") {
        // Arabic: check character count — 5000 chars ≈ 1000 Arabic words ≈ 1500 English words
        const charCount = content.trim().length;
        if (charCount < 5000) {
            failures.push(`Content too short: ${charCount} chars (minimum 5000 for Arabic)`);
        }
    } else {
        const wordCount = content.trim().split(/\s+/).length;
        if (wordCount < 1000) {
            failures.push(`Word count too low: ${wordCount} (minimum 1000)`);
        }
    }

    // 2. Heading count check — at least 4 ## headings for structure
    const h2Count = (content.match(/^##\s+/gm) || []).length;
    if (h2Count < 4) {
        failures.push(`Too few H2 headings: ${h2Count} (minimum 4)`);
    }

    // 3. Law reference check — should cite specific articles
    const lawRefPatterns = [
        /Article\s+\d+/gi,         // English: "Article 15"
        /المادة\s+\d+/g,           // Arabic: "المادة 15"
        /article\s+\d+/gi,         // French: "article 15"
        /Law\s+(?:No\.?\s*)?\d+/gi, // "Law No. 70.03"
        /القانون\s+رقم\s+\d+/g,   // Arabic law references
        /Loi\s+(?:n°?\s*)?\d+/gi,  // French: "Loi n° 70.03"
    ];
    const lawRefs = lawRefPatterns.reduce((count, pattern) => {
        return count + (content.match(pattern) || []).length;
    }, 0);
    if (lawRefs < 2) {
        failures.push(`Too few law references: ${lawRefs} (minimum 2)`);
    }

    // 4. FAQ check — should have the FAQ_JSON marker
    if (!content.includes("<!-- FAQ_JSON -->")) {
        failures.push("Missing FAQ_JSON block");
    }

    // 5. Internal link check — should have at least 1 internal link
    const internalLinks = (content.match(/\]\(\/blog\//g) || []).length;
    if (internalLinks < 1) {
        // This is a warning, not a hard failure
        console.log(`      ⚠️  No internal links found (recommended: 2-3)`);
    }

    return failures;
}

interface BlogTopic {
    slug: string;
    titles: { ar: string; en: string; fr: string };
    descriptions: { ar: string; en: string; fr: string };
    searchQuery: string;
    keywords: string[];
    /** Assigned legal category for frontmatter grouping */
    category?: string;
    /** Why this topic was chosen (from trend analysis) */
    trendReason?: string;
}

/**
 * Generate a single blog article in a specific language
 * 
 * @param topic - The blog topic configuration
 * @param language - Target language configuration
 * @param context - RAG context (legal references)
 * @param topicIndex - Topic number (1-8)
 * @param langIndex - Language index (0-2)
 * @param imageUrl - URL of the generated image
 * @param serpBrief - SERP competitor analysis brief (from analyzeSERPCompetitors)
 * @param linkBank - Internal link bank string (from buildLinkBank)
 * @returns Generated blog object
 */
async function generateBlogInLanguage(
    topic: BlogTopic,
    language: typeof LANGUAGES[0],
    context: string,
    topicIndex: number,
    langIndex: number,
    imageUrl: string,
    serpBrief: string = "",
    linkBank: string = ""
): Promise<GeneratedBlog> {
    console.log(`      🌐 [${language.name}] Generating...`);

    // Language-specific system prompts
    const languageInstructions: Record<string, string> = {
        ar: `اكتب المقال باللغة العربية الفصحى. استخدم أسلوبًا واضحًا ومفهومًا للقارئ العادي.
لا تستخدم الرموز التعبيرية (emojis) أبدًا.
استخدم علامات الترقيم العربية الصحيحة.`,
        en: `Write the article in clear, professional English accessible to non-lawyers.
Never use emojis.
Use proper British/American English grammar and punctuation.`,
        fr: `Rédigez l'article en français clair et professionnel, accessible aux non-juristes.
N'utilisez jamais d'emojis.
Utilisez une grammaire et une ponctuation françaises correctes.`
    };

    // Build the SERP intelligence section if available
    const serpSection = serpBrief ? `
SERP COMPETITOR INTELLIGENCE (use this to write a BETTER article than competitors):
---
${serpBrief}
---
IMPORTANT: Your article MUST cover everything competitors cover AND fill the gaps they miss.
Answer ALL "People Also Ask" questions within the article body naturally.` : "";

    // Build the internal linking section if available
    const linkingSection = linkBank ? `
INTERNAL LINKING:
Here are related published articles you MUST link to.
${linkBank}

RULES: Naturally embed 2-3 of these internal links using markdown format [anchor text](/blog/slug).
Only link where contextually relevant.
CRITICAL: ABSOLUTELY NEVER link to a blog slug that is not in the list above. DO NOT invent or hallucinate URLs.` : "";

    const systemPrompt = `You are an expert legal writer specializing in Moroccan law.
Your task is to write a professional, educational, SEO-optimized blog article that will RANK #1 on Google.

${languageInstructions[language.code]}

WRITING GUIDELINES:
1. Write in clear, accessible language that non-lawyers can understand
2. Include specific references to Moroccan laws, codes, and articles — cite AT LEAST 5 specific article numbers
3. Structure the article with clear sections using markdown headings (## for main sections, ### for subsections)
4. Include practical examples, real-world scenarios, and step-by-step procedures
5. Mention relevant Moroccan legal institutions, courts, and administrative procedures
6. Cite specific article numbers and law names from the provided context AND your own knowledge
7. Target length: 2000-3000 words — this is NON-NEGOTIABLE, write AT LEAST 2000 words
8. Use proper markdown formatting throughout — bold key terms, use bullet lists for procedures
9. NEVER use emojis
10. Include the current year (2026) naturally for freshness signals
11. Use the E-E-A-T framework: demonstrate Experience, Expertise, Authoritativeness, Trustworthiness

CRITICAL LENGTH REQUIREMENT:
- You MUST write at least 2000 words. Articles under 1500 words are UNACCEPTABLE.
- Each of the 6 mandatory sections below has a MINIMUM word count. Follow it.
- If you feel you are running short, add more examples, more case law, more practical detail.
- NEVER conclude early. Always pad with real, useful legal content if you are under the target.

ARTICLE STRUCTURE (MANDATORY — follow this exactly, meet each section's word minimum):
1. Hook Introduction (250-400 words minimum): Start with a compelling real-world scenario or question that the reader identifies with. State what they will learn.
2. Legal Foundation (350-500 words minimum): Cite the primary laws, codes, and articles that govern this topic.
3. Practical Guide (400-600 words minimum): Step-by-step procedures, required documents, timelines, costs.
4. Key Provisions Explained (400-600 words minimum): Break down the most important legal provisions in plain language.
5. Common Mistakes & How to Avoid Them (250-400 words minimum): Practical pitfalls people encounter.
6. Conclusion with Key Takeaways (200 words): Summarize in bullet points.
${serpSection}
${linkingSection}

KEY TAKEAWAYS GENERATION:
After the conclusion, output a JSON array of 4-5 key takeaways preceded by this exact marker:
<!-- KEY_TAKEAWAYS -->
[{"takeaway": "One-sentence key insight"}]

FAQ GENERATION:
After the key takeaways, output a JSON block of 5-6 FAQ items preceded by the exact marker:
<!-- FAQ_JSON -->
[{"question": "..?", "answer": "..."}]
Each FAQ should be a commonly searched question with a concise 2-3 sentence answer.

At the end of the article (BEFORE the KEY_TAKEAWAYS block), add this exact section:
---

### Related Search Terms
9anoun ai, 9anon ai, kanon ai, kanoun ai, qanon ai, qanoun ai`;

    const userPrompt = context
        ? `Based on the following legal references from Moroccan law:

${context}

---

Write a blog article with title: "${topic.titles[language.code as keyof typeof topic.titles]}"

Keywords to cover: ${topic.keywords.join(", ")}

Generate a comprehensive, in-depth blog article that educates readers about this area of Moroccan law.
Make it the BEST, most complete article on this topic on the entire internet.`
        : `Write a blog article with title: "${topic.titles[language.code as keyof typeof topic.titles]}"

Keywords to cover: ${topic.keywords.join(", ")}

Generate a comprehensive, in-depth blog article that educates readers about this area of Moroccan law.
Use your knowledge of Moroccan legal frameworks and cite specific laws where applicable.
Make it the BEST, most complete article on this topic on the entire internet.`;

    // Generate the article using the LLM — max_tokens raised from 3000 to 8000
    const response = await client.chat.completions.create({
        model: "google/gemini-3-flash-preview",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ],
        max_tokens: 8000,
        // Lower temperature for more authoritative, factual content
        temperature: 0.5,
    });

    const content = response.choices[0]?.message?.content || "";
    console.log(`      ✅ [${language.name}] Done (${content.length} chars, ~${content.trim().split(/\s+/).length} words)`);

    return {
        slug: topic.slug,
        language: language.code,
        title: topic.titles[language.code as keyof typeof topic.titles],
        description: topic.descriptions[language.code as keyof typeof topic.descriptions],
        content: content,
        image: imageUrl,
        sources: [],
        generatedAt: new Date(),
        keywords: topic.keywords,
        category: topic.category || "law",
        keyTakeaways: [],
    };
}

/**
 * Save a blog article to the filesystem as a Markdown file.
 * Parses optional FAQ JSON from the generated content and adds it
 * to the frontmatter YAML for Google FAQ rich snippets.
 * 
 * @param blog - The generated blog article
 * @param language - Language configuration
 * @param outputDir - Directory to save blog files
 * @param validSlugs - List of valid published slugs to protect against hallucinated links
 */
function saveBlog(blog: GeneratedBlog, language: typeof LANGUAGES[0], outputDir: string, validSlugs: Set<string>): void {
    const filename = `${blog.slug}${language.suffix}.md`;
    const filepath = path.join(outputDir, filename);

    /**
     * Prevent LLM internal linking hallucinations.
     * We scan the content for markdown links matching /blog/slug.
     * If the slug is NOT in our valid list, we strip the link syntax and keep just the text.
     */
    let articleContent = blog.content;
    const linkRegex = /\[([^\]]+)\]\((?:\/blog\/|https?:\/\/(?:www\.)?9anon\.com\/blog\/)?([^\)]+)\)/g;
    articleContent = articleContent.replace(linkRegex, (match, anchorText, slugOrUrl) => {
        // Extract just the slug if it's a full URL
        const slug = slugOrUrl.split('/').pop()?.split('#')[0] || slugOrUrl;

        if (validSlugs.has(slug)) {
            // It's a valid internal link
            return `[${anchorText}](/blog/${slug})`;
        } else if (slugOrUrl.startsWith('http') && !slugOrUrl.includes('9anon.com')) {
            // It's an external link (allow it)
            return match;
        } else {
            // It's a hallucinated internal link! Strip it.
            return anchorText;
        }
    });

    /**
     * Extract FAQ JSON and Key Takeaways from the generated content.
     * Both markers are stripped from the article body and placed
     * into the frontmatter YAML for structured data consumption.
     */
    let faqYaml = "";
    let keyTakeawaysYaml = "";

    // --- Extract Key Takeaways ---
    const takeawaysMarkerIdx = articleContent.indexOf("<!-- KEY_TAKEAWAYS -->");
    if (takeawaysMarkerIdx !== -1) {
        const afterTakeaways = articleContent.substring(takeawaysMarkerIdx + "<!-- KEY_TAKEAWAYS -->".length);
        // Remove the marker and everything after it from the article body (FAQ comes after)
        articleContent = articleContent.substring(0, takeawaysMarkerIdx).trim();

        try {
            const jsonMatch = afterTakeaways.match(/\[\s*\{[\s\S]*?\}\s*\]/);
            if (jsonMatch) {
                const items: Array<{ takeaway: string }> = JSON.parse(jsonMatch[0]);
                if (items.length > 0) {
                    keyTakeawaysYaml = "keyTakeaways:\n" + items.map(item =>
                        `  - "${item.takeaway.replace(/"/g, '\\"')}"`
                    ).join("\n");
                    console.log(`      🎯 Extracted ${items.length} key takeaways`);
                }
            }

            // Check if FAQ_JSON marker is in the remaining text after takeaways
            const remainingText = afterTakeaways.substring((jsonMatch?.index || 0) + (jsonMatch?.[0]?.length || 0));
            const faqInRemaining = remainingText.indexOf("<!-- FAQ_JSON -->");
            if (faqInRemaining !== -1) {
                const faqText = remainingText.substring(faqInRemaining + "<!-- FAQ_JSON -->".length).trim();
                const faqJsonMatch = faqText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
                if (faqJsonMatch) {
                    const faqItems: Array<{ question: string; answer: string }> = JSON.parse(faqJsonMatch[0]);
                    if (faqItems.length > 0) {
                        faqYaml = "faq:\n" + faqItems.map(item =>
                            `  - question: "${item.question.replace(/"/g, '\\"')}"\n    answer: "${item.answer.replace(/"/g, '\\"')}"`
                        ).join("\n");
                        console.log(`      📋 Extracted ${faqItems.length} FAQ items for rich snippets`);
                    }
                }
            }
        } catch (err) {
            console.warn(`      ⚠️ Failed to parse key takeaways, skipping:`, err);
        }
    }

    // --- Extract FAQ JSON (if not already extracted above) ---
    if (!faqYaml) {
        const faqMarkerIdx = articleContent.indexOf("<!-- FAQ_JSON -->");
        if (faqMarkerIdx !== -1) {
            const afterMarker = articleContent.substring(faqMarkerIdx + "<!-- FAQ_JSON -->".length).trim();
            // Remove the FAQ marker and everything after it from the article body
            articleContent = articleContent.substring(0, faqMarkerIdx).trim();

            try {
                const jsonMatch = afterMarker.match(/\[\s*\{[\s\S]*?\}\s*\]/);
                if (jsonMatch) {
                    const faqItems: Array<{ question: string; answer: string }> = JSON.parse(jsonMatch[0]);
                    if (faqItems.length > 0) {
                        faqYaml = "faq:\n" + faqItems.map(item =>
                            `  - question: "${item.question.replace(/"/g, '\\"')}"\n    answer: "${item.answer.replace(/"/g, '\\"')}"`
                        ).join("\n");
                        console.log(`      📋 Extracted ${faqItems.length} FAQ items for rich snippets`);
                    }
                }
            } catch (faqErr) {
                console.warn(`      ⚠️ Failed to parse FAQ JSON, skipping:`, faqErr);
            }
        }
    }

    // --- Build enhanced frontmatter with new SEO fields ---
    const keywordsYaml = blog.keywords && blog.keywords.length > 0
        ? `keywords: [${blog.keywords.map(k => `"${k}"`).join(", ")}]\n`
        : "";
    const categoryYaml = blog.category ? `category: "${blog.category}"\n` : "";
    const today = blog.generatedAt.toISOString().split("T")[0];

    const frontmatter = `---
title: "${blog.title}"
date: "${today}"
lastModified: "${today}"
description: "${blog.description}"
image: "${blog.image}"
imageAlt: "${blog.description.slice(0, 120)}"
author: "9anon AI"
${keywordsYaml}${categoryYaml}${keyTakeawaysYaml ? keyTakeawaysYaml + "\n" : ""}${faqYaml ? faqYaml + "\n" : ""}---

`;

    const fullContent = frontmatter + articleContent;

    fs.writeFileSync(filepath, fullContent, "utf-8");
    console.log(`      💾 Saved: ${filename}`);
}

/**
 * FIXED MASTER VISUAL STYLE (Brand Consistency)
 * 
 * These parameters are injected into EVERY image prompt regardless of the topic
 * to ensure a consistent, premium brand identity across the entire blog.
 */
const MASTER_VISUAL_STYLE = {
    camera: "Full-frame 35mm, 35-85mm focal length. Shallow depth of field (f/1.8). Documentary photography style.",
    lighting: "Natural motivated window light, high contrast with dramatic shadows. Golden hour or soft overcast.",
    color: "Warm cinematic tones, Kodak Portra 400 feel. Slight film grain. Deep blacks and rich midtones.",
    composition: "Rule of thirds. Emotional anchor at a power point. Authentic Moroccan modern setting.",
    restrictions: "ABSOLUTE RESTRICTIONS: ZERO text, words, watermarks, logos, UI overlays, or borders. Pure photograph only.",
};

/**
 * Step 4a: Visual Scene Synthesis
 * 
 * Translates the blog's legal context into a highly detailed, representative
 * visual scene description that the image model can then "recreate".
 */
async function generateVisualSceneDescription(topic: BlogTopic, summary: string, takeaways: string[]): Promise<string> {
    const systemPrompt = `You are a creative director for a premium legal magazine.
Your job is to translate a specific Moroccan legal topic into a RECOGNIZABLE, REPRODUCIBLE physical scene.

The goal is to move away from generic "man at desk" or "lawyer talking" shots and instead show a "recreated situation"
that a person experiencing this legal issue would actually find themselves in.

RULES:
- Focus on ENVIRONMENTAL STORYTELLING.
- Describe people in authentic, mid-action moments (not looking at camera).
- Use specific Moroccan urban or interior details (modern Casablanca offices, Rabat coffee shops, modern glass apartments).
- Avoid traditional or cliché "tourist" Moroccan architecture (no arches, mosaics, or djellabas). Focus on MODERN Morocco.
- Describe the emotion, the lighting, and the physical props (documents, specific tech, environmental markers).

TOPIC: "${topic.titles.en}"
SUMMARY: ${summary}
KEY TAKEAWAYS: ${takeaways.join(". ")}
CATEGORY: ${topic.category || "General"}

Return ONLY a 2-3 sentence visual scene description — vivid, physical, and detailed.`;

    try {
        const response = await client.chat.completions.create({
            model: "google/gemini-2.0-flash-001",
            messages: [{ role: "user", content: systemPrompt }],
            max_tokens: 300,
            temperature: 0.7,
        });

        return response.choices[0]?.message?.content?.trim() || "A professional in a modern Moroccan setting focused on legal documentation.";
    } catch (error) {
        console.error("   ⚠️ Scene synthesis failed, using fallback:", error);
        return "A professional in a modern Moroccan setting focused on legal documentation.";
    }
}

/**
 * Main execution function
 * Generates all 8 blog articles in 3 languages and saves them
 */
async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const isSearchOnly = args.includes("--s") || args.includes("-s") || args.includes("--search");

    if (isSearchOnly) {
        console.log("║     🔍 SEARCH-ONLY MODE ACTIVATED                             ║");
    }
    console.log("╚══════════════════════════════════════════════════════════════╝\n");

    // Verify API key is set
    if (!process.env.OPENROUTER_API_KEY) {
        console.error("❌ ERROR: OPENROUTER_API_KEY environment variable is not set.");
        console.error("   Please set it in your .env file.");
        process.exit(1);
    }

    // Output to the FE blogs directory
    const outputDir = path.resolve(__dirname, "..", "..", "FE", "content", "blogs");

    if (!fs.existsSync(outputDir)) {
        console.error("❌ ERROR: Blogs directory not found:", outputDir);
        process.exit(1);
    }
    console.log(`📁 Output directory: ${outputDir}\n`);

    const startTime = Date.now();
    let successCount = 0;
    let failCount = 0;

    // Generate all 8 articles in 3 languages
    // Step 0: Get existing slugs and generate NEW topics
    console.log(`   🔍 Scanning existing blogs...`);
    const existingSlugs = getExistingSlugs(outputDir);
    console.log(`   ✅ Found ${existingSlugs.size} existing articles/topics`);

    console.log(`   🧠 Generating ${NUM_ARTICLES} NEW unique topics...`);
    const newTopics = await generateNewTopics(existingSlugs, NUM_ARTICLES);

    if (newTopics.length === 0) {
        console.log("   ⚠️ No new topics generated. Exiting.");
        return;
    }

    console.log(`   ✅ Generated ${newTopics.length} new topics:\n`);
    newTopics.forEach((t, i) => console.log(`      ${i + 1}. ${t.slug} (${t.titles.en})`));

    if (isSearchOnly) {
        console.log("\n╔══════════════════════════════════════════════════════════════╗");
        console.log("║                    SEARCH MODE COMPLETE                       ║");
        console.log("╚══════════════════════════════════════════════════════════════╝");
        console.log(`\n✅ Found ${newTopics.length} trending topics.`);
        console.log(`⏱️  Total time: ${((Date.now() - startTime) / 1000).toFixed(1)} seconds`);
        return;
    }

    // Generate articles for the new topics
    for (let topicIdx = 0; topicIdx < newTopics.length; topicIdx++) {
        const topic = newTopics[topicIdx];
        console.log(`\n📝 [${topicIdx + 1}/${newTopics.length}] Topic: "${topic.titles.en}"`);

        // Step 1: Search for relevant legal context using RAG (once per topic)
        console.log(`   🔍 Searching legal database...`);
        const sources = await searchLegalDocs(topic.searchQuery, 8);
        console.log(`   ✅ Found ${sources.length} relevant legal references`);

        // Build context from RAG results
        const context = buildContext(sources);

        // Step 2: SERP competitor analysis (once per topic, shared across languages)
        const serpBrief = await analyzeSERPCompetitors(topic);

        // Step 3: Generate articles in all 3 languages FIRST (before image)
        // Image generation is deferred until all languages succeed — this avoids
        // wasting expensive image API calls if articles fail validation.
        let imageUrl = "";
        const savedFiles: Array<{ filepath: string; language: typeof LANGUAGES[0]; blog: GeneratedBlog }> = [];

        for (let langIdx = 0; langIdx < LANGUAGES.length; langIdx++) {
            const language = LANGUAGES[langIdx];

            try {
                // Build internal link bank for this language
                const linkBank = buildLinkBank(outputDir, topic.slug, language.code);

                // Single generation call — no retries to save credits.
                // The prompt is forceful enough about length requirements.
                const blog = await generateBlogInLanguage(
                    topic, language, context, topicIdx + 1, langIdx,
                    imageUrl, serpBrief, linkBank
                );

                // Run quality validation as soft warnings (log but always save)
                const warnings = validateArticleQuality(blog.content, language.code);
                if (warnings.length === 0) {
                    console.log(`      ✅ Quality check passed`);
                } else {
                    console.log(`      ⚠️ Quality warnings (saving anyway):`);
                    warnings.forEach(w => console.log(`         - ${w}`));
                }

                blog.sources = sources.map(s => s.document_name || s.source_file || "Unknown");
                saveBlog(blog, language, outputDir, existingSlugs);
                successCount++;

                // Track saved file for image path update later
                const filename = `${blog.slug}${language.suffix}.md`;
                savedFiles.push({
                    filepath: path.join(outputDir, filename),
                    language,
                    blog,
                });

                // Add a small delay between API calls to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1500));
            } catch (error) {
                console.error(`      ❌ [${language.name}] Failed:`, error);
                failCount++;
            }
        }

        // Step 4: Generate image AFTER all articles are saved
        // Only generate if at least one article was saved successfully
        if (savedFiles.length > 0) {
            console.log(`   🎨 Generating image for topic...`);
            try {
                /**
                 * Generate a contextual blog illustration using Gemini's image model.
                 * Now uses actual article content (key takeaways + description) from
                 * the saved files to produce images tightly tied to the blog content.
                 * Resized to 1200×630 (Open Graph standard) for optimal social previews.
                 */

                // Extract article context from the first saved file for image grounding
                const firstSaved = savedFiles[0];
                const articleDescription = firstSaved.blog.description;
                const articleKeyTakeaways = firstSaved.blog.keyTakeaways || [];
                const articleContext = articleKeyTakeaways.length > 0
                    ? articleKeyTakeaways.slice(0, 3).join(". ")
                    : articleDescription;

                // Step 4a: Synthesize the specific visual scene from content
                console.log(`      🎨 [Scene Synthesis] Creating representative situation...`);
                const sceneDescription = await generateVisualSceneDescription(topic, articleDescription, articleKeyTakeaways);
                console.log(`      🎨 [Scene Description]: "${sceneDescription.slice(0, 100)}..."`);

                // Step 4b: Assemble the master prompt combining fixed style + dynamic scene
                const imagePrompt = [
                    // --- Purpose ---
                    `Create a single, photorealistic editorial photograph for this legal blog article: "${topic.titles.en}".`,
                    ``,
                    // --- Dynamic Scene (The "What" - Recreated Situation) ---
                    `REPRESENTATIVE SCENE (Recreated Situation):`,
                    sceneDescription,
                    ``,
                    // --- Master Visual Style (The "How" - Brand Consistency) ---
                    `TECHNICAL STYLE (Fixed Brand Identity):`,
                    `CAMERA: ${MASTER_VISUAL_STYLE.camera}`,
                    `LIGHTING: ${MASTER_VISUAL_STYLE.lighting}`,
                    `COLOR/FILM: ${MASTER_VISUAL_STYLE.color}`,
                    `COMPOSITION: ${MASTER_VISUAL_STYLE.composition}`,
                    ``,
                    // --- Hard Constraints ---
                    MASTER_VISUAL_STYLE.restrictions,
                ].join("\n");

                const rawResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        "HTTP-Referer": "https://github.com/moroccan-legal-ai",
                        "X-Title": "9anon - Blog Image Generator",
                    },
                    body: JSON.stringify({
                        model: "google/gemini-3.1-flash-image-preview",
                        messages: [
                            { role: "user", content: imagePrompt }
                        ],
                        modalities: ["image", "text"],
                    }),
                });

                const responseJson = await rawResponse.json() as any;

                // Debug: log the response structure to understand the format
                const messageObj = responseJson?.choices?.[0]?.message;
                console.log(`   📦 Response keys: ${JSON.stringify(Object.keys(responseJson?.choices?.[0] || {}))}`);
                console.log(`   📦 Message keys: ${JSON.stringify(Object.keys(messageObj || {}))}`);

                let imageBuffer: Buffer | null = null;

                // OpenRouter returns Gemini images in message.images array
                // Each image object has: { image_url: { url: "data:image/png;base64,..." } }
                if (messageObj?.images && Array.isArray(messageObj.images) && messageObj.images.length > 0) {
                    const imgObj = messageObj.images[0];
                    const imageDataUrl = imgObj?.image_url?.url;

                    if (imageDataUrl) {
                        console.log(`   📸 Found image data URL (length: ${imageDataUrl.length})`);
                        // Extract base64 from data URI
                        const dataMatch = imageDataUrl.match(/^data:image\/[^;]+;base64,(.+)/s);
                        if (dataMatch) {
                            imageBuffer = Buffer.from(dataMatch[1], "base64");
                        } else if (imageDataUrl.startsWith("http")) {
                            // It's a regular URL, download it
                            console.log(`   🔗 Downloading image from URL...`);
                            const dlRes = await fetch(imageDataUrl);
                            imageBuffer = Buffer.from(await dlRes.arrayBuffer());
                        }
                    } else {
                        console.warn(`   ⚠️ images[0] structure:`, JSON.stringify(imgObj).slice(0, 300));
                    }
                }

                // Format 1: OpenRouter multimodal content array
                // content: [{type: "text", text: "..."}, {type: "image_url", image_url: {url: "data:image/png;base64,..."}}]
                if (!imageBuffer && Array.isArray(messageObj?.content)) {
                    for (const part of messageObj.content) {
                        // Check for image_url part with base64 data URI
                        if (part.type === "image_url" && part.image_url?.url) {
                            const dataMatch = part.image_url.url.match(/^data:image\/[^;]+;base64,(.+)/s);
                            if (dataMatch) {
                                console.log(`   📸 Found base64 in content array (image_url part)`);
                                imageBuffer = Buffer.from(dataMatch[1], "base64");
                                break;
                            }
                            // It's a regular URL, download it
                            console.log(`   🔗 Found URL in content array: ${part.image_url.url.slice(0, 80)}...`);
                            const dlRes = await fetch(part.image_url.url);
                            imageBuffer = Buffer.from(await dlRes.arrayBuffer());
                            break;
                        }
                        // Check for inline_data (Gemini native format sometimes passed through)
                        if (part.inline_data?.data) {
                            console.log(`   📸 Found inline_data part`);
                            imageBuffer = Buffer.from(part.inline_data.data, "base64");
                            break;
                        }
                    }
                }

                // Format 2: content is a plain string (text with possible base64 or URL)
                if (!imageBuffer && typeof messageObj?.content === "string" && messageObj.content.length > 0) {
                    const textContent = messageObj.content;
                    console.log(`   📦 Text content length: ${textContent.length}, preview: ${textContent.slice(0, 100)}...`);

                    // Check for data URI in the text
                    const dataUriMatch = textContent.match(/data:image\/[^;]+;base664,([A-Za-z0-9+/=\s]+)/);
                    if (dataUriMatch) {
                        console.log(`   📸 Found data URI in text content`);
                        imageBuffer = Buffer.from(dataUriMatch[1].replace(/\s/g, ""), "base64");
                    }

                    // Check for raw base64 (long string with no spaces)
                    if (!imageBuffer && textContent.length > 500 && !textContent.includes(" ")) {
                        console.log(`   📸 Text looks like raw base64`);
                        imageBuffer = Buffer.from(textContent.trim(), "base64");
                    }

                    // Check for URL
                    if (!imageBuffer) {
                        const mdMatch = textContent.match(/!\[.*?\]\(([^)]+)\)/);
                        const urlMatch = textContent.match(/https?:\/\/[^\s)]+/);
                        const url = mdMatch ? mdMatch[1] : urlMatch ? urlMatch[0] : "";
                        if (url) {
                            console.log(`   🔗 Found URL in text: ${url.slice(0, 80)}...`);
                            const dlRes = await fetch(url);
                            imageBuffer = Buffer.from(await dlRes.arrayBuffer());
                        }
                    }
                }

                if (imageBuffer && imageBuffer.length > 100) {
                    // Ensure output directory exists
                    const imagesDir = path.resolve(__dirname, "..", "..", "FE", "public", "blog-images");
                    if (!fs.existsSync(imagesDir)) {
                        fs.mkdirSync(imagesDir, { recursive: true });
                    }

                    const finalImagePath = path.join(imagesDir, `${topic.slug}.webp`);
                    const logoPath = path.resolve(__dirname, "..", "..", "FE", "public", "Layer 3.png");

                    /**
                     * Resize to OG-standard 1200×630 and composite the 9anon logo.
                     * This exact aspect ratio is optimal for Facebook, Twitter, LinkedIn,
                     * WhatsApp, and Google Discover preview cards.
                     */
                    const resizedImage = await sharp(imageBuffer)
                        .resize(1200, 630, { fit: "cover", position: "center" })
                        .toBuffer();

                    const logoSize = Math.round(1200 * 0.06); // 6% of 1200px width
                    const padding = 20;

                    // Resize logo and lower opacity to 40%
                    const resizedLogo = await sharp(logoPath)
                        .resize(logoSize)
                        .ensureAlpha()
                        .linear(0.4, 0)
                        .toBuffer();

                    const logoMeta = await sharp(resizedLogo).metadata();
                    const logoHeight = logoMeta.height || logoSize;

                    // Composite logo onto bottom-left corner and output as WebP
                    await sharp(resizedImage)
                        .composite([{
                            input: resizedLogo,
                            left: padding,
                            top: 630 - logoHeight - padding,
                        }])
                        .webp({ quality: 85 })
                        .toFile(finalImagePath);

                    imageUrl = `/blog-images/${topic.slug}.webp`;
                    console.log(`   ✅ Image saved as WebP to ${imageUrl}`);

                    // Retroactively update all saved markdown files with the image path
                    for (const saved of savedFiles) {
                        try {
                            let mdContent = fs.readFileSync(saved.filepath, "utf-8");
                            // Replace the empty image field in frontmatter
                            mdContent = mdContent.replace(/^image: ""\s*$/m, `image: "${imageUrl}"`);
                            fs.writeFileSync(saved.filepath, mdContent, "utf-8");
                            console.log(`      📝 Updated image path in: ${path.basename(saved.filepath)}`);
                        } catch (updateErr) {
                            console.warn(`      ⚠️ Failed to update image in ${path.basename(saved.filepath)}`);
                        }
                    }
                } else {
                    console.warn(`   ⚠️ Could not extract a valid image from the response.`);
                    console.warn(`   📝 Full response structure:`, JSON.stringify(responseJson?.choices?.[0]?.message || {}).slice(0, 500));
                }
            } catch (imageErr) {
                console.error(`   ❌ Failed to generate/composite image:`, imageErr);
            }
        }

        // Step 5: Git commit all saved files + image for this topic
        const feDir = path.resolve(__dirname, "..", "..", "FE");

        // Git add the image file if it was generated
        if (imageUrl) {
            try {
                const imageRelPath = `public${imageUrl}`; // e.g. public/blog-images/slug.webp
                execSync(`git add "${imageRelPath}"`, { cwd: feDir });
            } catch { /* image might not exist if gen failed */ }
        }

        // Git add + commit each markdown file
        for (const saved of savedFiles) {
            try {
                const filename = `${saved.blog.slug}${saved.language.suffix}.md`;
                const relPath = `content/blogs/${filename}`;

                execSync(`git add "${relPath}"`, { cwd: feDir });

                const langStr = saved.language.code === 'en' ? 'eng' : (saved.language.code === 'fr' ? 'fr' : 'ar');
                const safeSlug = saved.blog.slug.replace(/"/g, '\\"');

                execSync(`git commit -m "feat(blog): added blog ${safeSlug} in ${langStr}"`, { cwd: feDir, stdio: 'pipe' });
                console.log(`      🚀 Git committed: ${filename}`);
            } catch (gitError) {
                console.warn(`      ⚠️ Git commit skipped or failed for ${path.basename(saved.filepath)}`);
            }
        }

        // Delay between topics
        if (topicIdx < newTopics.length - 1) {
            console.log(`   ⏳ Waiting 3 seconds before next topic...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

    // Print summary
    console.log("\n╔══════════════════════════════════════════════════════════════╗");
    console.log("║                    GENERATION COMPLETE                        ║");
    console.log("╚══════════════════════════════════════════════════════════════╝");
    console.log(`\n✅ Successfully generated: ${successCount} blog posts`);
    if (failCount > 0) {
        console.log(`❌ Failed: ${failCount} blog posts`);
    }
    console.log(`⏱️  Total time: ${duration} minutes`);
    console.log(`📁 Blogs saved to: ${outputDir}`);

    /**
     * Final Git operation: push the committed generated blogs to the repository.
     * Operates from the FE directory contexts.
     */
    try {
        console.log(`\n☁️  Pushing to git repository...`);
        const feDir = path.resolve(__dirname, "..", "..", "FE");
        execSync(`git push`, { cwd: feDir, stdio: 'inherit' });
        console.log(`   ✅ Successfully pushed all generated blogs.`);
    } catch (pushError) {
        console.error(`   ❌ Failed to push to git repository:`, pushError);
    }
}

// Execute the main function
main().catch(console.error);
