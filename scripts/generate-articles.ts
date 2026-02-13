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
import { getTable } from "../src/services/db";
import { getEmbedding } from "../src/services/bi";


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
 * Generate NEW topics using LLM that don't exist in the current set
 */
async function generateNewTopics(existingSlugs: Set<string>, count: number = 3): Promise<any[]> {
    const existingList = Array.from(existingSlugs).join(", ");

    const systemPrompt = `You are a content strategist for a Moroccan legal blog "9anon".
Your goal is to suggest ${count} NEW, UNIQUE, and HIGH-VALUE blog topics about Moroccan law.
You must NOT suggest topics that are already covered.

ALREADY COVERED TOPICS (DO NOT REPEAT):
${existingList}

Return the response as a JSON array of objects with this EXACT structure:
[
  {
    "slug": "kebab-case-slug-in-english",
    "titles": {
      "ar": "Arabic Title",
      "en": "English Title",
      "fr": "French Title"
    },
    "descriptions": {
      "ar": "Arabic Description",
      "en": "English Description",
      "fr": "French Description"
    },
    "searchQuery": "Arabic search query for RAG",
    "keywords": ["keyword1", "keyword2"]
  }
]`;

    const response = await client.chat.completions.create({
        model: "google/gemini-2.0-flash-001",
        messages: [{ role: "system", content: systemPrompt }],
        max_tokens: 8000,
        response_format: { type: "json_object" }
    });

    const content = response.choices[0]?.message?.content || "[]";
    try {
        // Strip out markdown code blocks if present (```json ... ``` or just ``` ... ```)
        let jsonStr = content.replace(/^```(json)?\s*/, "").replace(/\s*```$/, "");
        // Remove any leading/trailing whitespace
        jsonStr = jsonStr.trim();

        const parsed = JSON.parse(jsonStr);
        return Array.isArray(parsed) ? parsed : (parsed.topics || []);
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
    sources: string[];
    generatedAt: Date;
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
}

/**
 * Generate a single blog article in a specific language
 * 
 * @param topic - The blog topic configuration
 * @param language - Target language configuration
 * @param context - RAG context (legal references)
 * @param topicIndex - Topic number (1-8)
 * @param langIndex - Language index (0-2)
 * @returns Generated blog object
 */
async function generateBlogInLanguage(
    topic: BlogTopic,
    language: typeof LANGUAGES[0],
    context: string,
    topicIndex: number,
    langIndex: number
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

At the end, add this exact section:
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
        sources: [],
        generatedAt: new Date()
    };
}

/**
 * Save a blog article to the filesystem as a Markdown file
 * 
 * @param blog - The generated blog article
 * @param language - Language configuration
 * @param outputDir - Directory to save blog files
 */
function saveBlog(blog: GeneratedBlog, language: typeof LANGUAGES[0], outputDir: string): void {
    const filename = `${blog.slug}${language.suffix}.md`;
    const filepath = path.join(outputDir, filename);

    // Build the complete markdown content with frontmatter
    const frontmatter = `---
title: "${blog.title}"
date: "${blog.generatedAt.toISOString().split("T")[0]}"
description: "${blog.description}"
---

`;

    const fullContent = frontmatter + blog.content;

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
    console.log("║     Generating 8 articles × 3 languages = 24 blog posts      ║");
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

        // Step 2: Generate in all 3 languages
        for (let langIdx = 0; langIdx < LANGUAGES.length; langIdx++) {
            const language = LANGUAGES[langIdx];

            try {
                const blog = await generateBlogInLanguage(topic, language, context, topicIdx + 1, langIdx);
                blog.sources = sources.map(s => s.document_name || s.source_file || "Unknown");
                saveBlog(blog, language, outputDir);
                successCount++;

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
}

// Execute the main function
main().catch(console.error);
