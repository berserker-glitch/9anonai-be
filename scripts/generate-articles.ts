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

    const searchPrompt = `You are a legal content researcher. Search the web comprehensively to find:

1. What legal topics are Moroccans actively searching for right now?
2. What new Moroccan laws, reforms, or legal changes have been announced or discussed recently?
3. What legal problems or questions are most commonly asked in Morocco?

IMPORTANT CONTEXT:
We have already published articles on the following topics/slugs:
${existingList ? existingList : "None yet."}

DO NOT suggest or research these ALREADY PUBLISHED topics UNLESS there is a significant new development, law change, or new trend specifically related to them that hasn't been covered before.

Search across:
- Moroccan news sites (Hespress, Le360, Médio24, Yabiladi, 2M, TelQuel)
- Legal forums and Q&A sites in Arabic and French
- Moroccan government announcements (legislation, royal decrees)
- Social media trending topics related to law in Morocco
- Google Trends data for Morocco law-related searches

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
- Any recent legislative changes driving the interest
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

Base your topics on the real search trends above.` : ""}

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
 * @returns Generated blog object
 */
async function generateBlogInLanguage(
    topic: BlogTopic,
    language: typeof LANGUAGES[0],
    context: string,
    topicIndex: number,
    langIndex: number,
    imageUrl: string
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

    const systemPrompt = `You are an expert legal writer specializing in Moroccan law.
Your task is to write a professional, educational blog article.

${languageInstructions[language.code]}

WRITING GUIDELINES:
1. Write in clear, accessible language that non-lawyers can understand
2. Include specific references to Moroccan laws, codes, and articles when available in the context
3. Structure the article with clear sections using markdown headings (## for main sections)
4. Include practical examples and real-world applications
5. Mention relevant Moroccan legal institutions and procedures
6. Cite specific article numbers and law names when provided in the context
7. Target length: 800-1200 words (medium-length blog post)
8. Use proper markdown formatting throughout
9. NEVER use emojis

ARTICLE STRUCTURE:
- Brief introduction (2-3 paragraphs)
- 3-4 main sections with practical information
- Conclusion with key takeaways

FAQ GENERATION:
After the main article content and after the "Related Search Terms" section, output
a JSON block of 3-4 FAQ items on a new line, preceded by the exact marker:
<!-- FAQ_JSON -->
Then output the JSON array. Each FAQ item should be a commonly searched question
about this topic with a concise 2-3 sentence answer. Example format:
<!-- FAQ_JSON -->
[{"question": "..?", "answer": "..."}]

At the end of the article (BEFORE the FAQ_JSON block), add this exact section:
---

### Related Search Terms
9anoun ai, 9anon ai, kanon ai, kanoun ai, qanon ai, qanoun ai`;

    const userPrompt = context
        ? `Based on the following legal references from Moroccan law:

${context}

---

Write a blog article with title: "${topic.titles[language.code as keyof typeof topic.titles]}"

Keywords to cover: ${topic.keywords.join(", ")}

Generate a well-structured blog article that educates readers about this area of Moroccan law.`
        : `Write a blog article with title: "${topic.titles[language.code as keyof typeof topic.titles]}"

Keywords to cover: ${topic.keywords.join(", ")}

Generate a well-structured blog article that educates readers about this area of Moroccan law.
Use your knowledge of Moroccan legal frameworks and cite specific laws where applicable.`;

    // Generate the article using the LLM
    const response = await client.chat.completions.create({
        model: "google/gemini-3-flash-preview",
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ],
        max_tokens: 3000,
        temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content || "";
    console.log(`      ✅ [${language.name}] Done (${content.length} chars)`);

    return {
        slug: topic.slug,
        language: language.code,
        title: topic.titles[language.code as keyof typeof topic.titles],
        description: topic.descriptions[language.code as keyof typeof topic.descriptions],
        content: content,
        image: imageUrl,
        sources: [],
        generatedAt: new Date()
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
 */
function saveBlog(blog: GeneratedBlog, language: typeof LANGUAGES[0], outputDir: string): void {
    const filename = `${blog.slug}${language.suffix}.md`;
    const filepath = path.join(outputDir, filename);

    /**
     * Extract FAQ JSON from the generated content if the LLM included
     * the <!-- FAQ_JSON --> marker. The FAQ is stripped from the article
     * body and placed into the frontmatter instead.
     */
    let articleContent = blog.content;
    let faqYaml = "";

    const faqMarkerIdx = articleContent.indexOf("<!-- FAQ_JSON -->");
    if (faqMarkerIdx !== -1) {
        const afterMarker = articleContent.substring(faqMarkerIdx + "<!-- FAQ_JSON -->".length).trim();
        // Remove the FAQ marker and everything after it from the article body
        articleContent = articleContent.substring(0, faqMarkerIdx).trim();

        try {
            // Extract JSON array from the remaining text
            const jsonMatch = afterMarker.match(/\[\s*\{[\s\S]*?\}\s*\]/);
            if (jsonMatch) {
                const faqItems: Array<{ question: string; answer: string }> = JSON.parse(jsonMatch[0]);
                if (faqItems.length > 0) {
                    // Build YAML-formatted FAQ block for frontmatter
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

    // Build the complete markdown content with frontmatter
    const frontmatter = `---
title: "${blog.title}"
date: "${blog.generatedAt.toISOString().split("T")[0]}"
description: "${blog.description}"
image: "${blog.image}"
${faqYaml ? faqYaml + "\n" : ""}---

`;

    const fullContent = frontmatter + articleContent;

    fs.writeFileSync(filepath, fullContent, "utf-8");
    console.log(`      💾 Saved: ${filename}`);
}

/**
 * Main execution function
 * Generates all 8 blog articles in 3 languages and saves them
 */
async function main(): Promise<void> {
    console.log("╔══════════════════════════════════════════════════════════════╗");
    console.log("║     🇲🇦 MOROCCAN LAW MULTILINGUAL BLOG GENERATOR              ║");
    console.log("║     Step 1: Perplexity sonar-pro searches trending topics     ║");
    console.log("║     Step 2: Gemini synthesizes → 8 topics × 3 languages      ║");
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

    console.log(`   🧠 Generating 8 NEW unique topics...`);
    const newTopics = await generateNewTopics(existingSlugs, 8);

    if (newTopics.length === 0) {
        console.log("   ⚠️ No new topics generated. Exiting.");
        return;
    }

    console.log(`   ✅ Generated ${newTopics.length} new topics:\n`);
    newTopics.forEach((t, i) => console.log(`      ${i + 1}. ${t.slug}`));

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

        // Step 1.5: Generate image using Gemini Pro Image via raw OpenRouter API
        // We use fetch directly because the OpenAI SDK strips multimodal image parts
        console.log(`   🎨 Generating image for topic...`);
        let imageUrl = "";
        try {
            /**
             * Generate a professional blog illustration using Gemini's image model.
             * We call OpenRouter directly via fetch because the OpenAI SDK's
             * message.content only captures text — Gemini returns images as
             * multimodal parts (inline_data) which the SDK discards.
             */
            const imagePrompt = [
                // --- Core directive: scene replication ---
                `Create a single, hyper-realistic editorial photograph that tells the STORY of this blog article at a glance.`,
                `Blog title: "${topic.titles.en}".`,
                `Blog keywords: ${topic.keywords.join(", ")}.`,

                // --- Scene composition & narrative ---
                `SCENE DIRECTION: Reconstruct the exact real-world moment the article describes.`,
                `Examples of what this means:`,
                `• A divorce article → a woman sitting across from a lawyer at a desk, signing papers, her expression is conflicted; soft window light rakes across the table.`,
                `• A labor rights article → a factory floor or open-plan office mid-dispute; a supervisor and a worker face each other, body language tense, coworkers watching in the background.`,
                `• A real estate article → a young couple standing in the doorway of an empty apartment, the agent gesturing inside; golden-hour light floods the room.`,
                `• A criminal law article → a dimly lit courtroom corridor; a defendant and their lawyer whispering urgently outside heavy wooden doors.`,
                `Choose the most visually dramatic and emotionally resonant moment from the topic. Capture mid-action, not posed.`,

                // --- Photographic technique ---
                `CAMERA: Shot on a full-frame 35mm sensor. Focal length 35-85mm depending on scene intimacy.`,
                `Use shallow depth of field (f/1.8–f/2.8) to isolate the subject from the environment. Background should be softly bokeh'd but still contextually readable.`,
                `LIGHTING: Motivated natural light — window light, golden hour, or diffused overcast. Allow dramatic shadows and highlights. Avoid flat, even studio lighting.`,
                `COLOR GRADE: Muted, desaturated warm tones — think Kodak Portra 400 film stock. Slight grain is acceptable. Blacks should be lifted slightly (cinematic log look).`,
                `COMPOSITION: Use the rule of thirds or leading lines. Place the emotional anchor (a face, hands on a document, a gesture) at a power point. Include environmental storytelling in the frame edges.`,

                // --- Moroccan identity (subtle) ---
                `CASTING: All people in the scene must have North African / Moroccan facial features, skin tones, and hair textures. This is the ONLY culturally specific element. Everything else — clothing, setting, props — should be modern and universally relatable. No traditional garments, no ornate architecture, no flags, no calligraphy.`,

                // --- Hard constraints ---
                `ABSOLUTE RESTRICTIONS: Zero text, zero words, zero watermarks, zero logos, zero UI overlays, zero borders. The image must be a clean photograph with nothing overlaid.`,
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
                    model: "google/gemini-3-pro-image-preview",
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
                const dataUriMatch = textContent.match(/data:image\/[^;]+;base64,([A-Za-z0-9+/=\s]+)/);
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

                const finalImagePath = path.join(imagesDir, `${topic.slug}.png`);
                const logoPath = path.resolve(__dirname, "..", "..", "FE", "public", "Layer 3.png");

                /**
                 * Composite the 9anon logo onto the bottom-left corner.
                 * Logo is resized to 6% of image width, with 40% opacity and 20px padding.
                 */
                const mainImage = sharp(imageBuffer);
                const metadata = await mainImage.metadata();
                const imgWidth = metadata.width || 800;
                const imgHeight = metadata.height || 600;
                const logoSize = Math.round(imgWidth * 0.06); // 6% of image width — small watermark
                const padding = 20; // px padding from bottom-left edges

                // Resize logo and lower opacity to 40%
                const resizedLogo = await sharp(logoPath)
                    .resize(logoSize)
                    .ensureAlpha()
                    .linear(0.4, 0) // Scale all channels including alpha by 0.4 for 40% opacity
                    .toBuffer();

                // Get resized logo dimensions for precise placement
                const logoMeta = await sharp(resizedLogo).metadata();
                const logoHeight = logoMeta.height || logoSize;

                await sharp(imageBuffer)
                    .composite([{
                        input: resizedLogo,
                        left: padding,
                        top: imgHeight - logoHeight - padding,
                    }])
                    .png()
                    .toFile(finalImagePath);

                imageUrl = `/blog-images/${topic.slug}.png`;
                console.log(`   ✅ Image saved to ${imageUrl} (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
            } else {
                console.warn(`   ⚠️ Could not extract a valid image from the response.`);
                // Log the full structure for debugging
                console.warn(`   📝 Full response structure:`, JSON.stringify(responseJson?.choices?.[0]?.message || {}).slice(0, 500));
            }
        } catch (imageErr) {
            console.error(`   ❌ Failed to generate/composite image:`, imageErr);
        }

        // Step 2: Generate in all 3 languages
        for (let langIdx = 0; langIdx < LANGUAGES.length; langIdx++) {
            const language = LANGUAGES[langIdx];

            try {
                const blog = await generateBlogInLanguage(topic, language, context, topicIdx + 1, langIdx, imageUrl);
                blog.sources = sources.map(s => s.document_name || s.source_file || "Unknown");
                saveBlog(blog, language, outputDir);
                successCount++;

                /**
                 * Auto-commit the newly generated blog to Git.
                 * Executes git add and commit within the FE directory.
                 */
                try {
                    const feDir = path.resolve(__dirname, "..", "..", "FE");
                    const filename = `${blog.slug}${language.suffix}.md`;
                    // Using forward slashes for relative path within FE directory
                    const relPath = `content/blogs/${filename}`;

                    // Add the specific newly created blog file
                    execSync(`git add "${relPath}"`, { cwd: feDir });

                    // Map language code to the format required by the user (eng, fr, ar)
                    const langStr = language.code === 'en' ? 'eng' : (language.code === 'fr' ? 'fr' : 'ar');
                    const safeSlug = blog.slug.replace(/"/g, '\\"');

                    // Commit with the required message format
                    execSync(`git commit -m "feat(blog): added blog ${safeSlug} in ${langStr}"`, { cwd: feDir, stdio: 'pipe' });
                    console.log(`      🚀 Git committed: ${filename}`);
                } catch (gitError) {
                    console.warn(`      ⚠️ Git commit skipped or failed for ${blog.slug} (might be unchanged)`);
                }

                // Add a small delay between API calls to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 1500));
            } catch (error) {
                console.error(`      ❌ [${language.name}] Failed:`, error);
                failCount++;
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
