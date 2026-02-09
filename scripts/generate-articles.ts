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
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import { getTable } from "../src/services/db";
import { getEmbedding } from "../src/services/bi";

// Load environment variables
dotenv.config();

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
const BLOG_TOPICS = [
    {
        slug: "understanding-moudawana-family-code",
        titles: {
            ar: "فهم مدونة الأسرة المغربية: الحقوق والواجبات",
            en: "Understanding Morocco's Family Code (Moudawana): Rights and Responsibilities",
            fr: "Comprendre le Code de la Famille Marocain (Moudawana) : Droits et Responsabilités"
        },
        descriptions: {
            ar: "دليل شامل حول مدونة الأسرة المغربية وما تتضمنه من حقوق وواجبات للأسرة",
            en: "A comprehensive guide to Morocco's Family Code and the rights and duties it entails",
            fr: "Un guide complet sur le Code de la Famille marocain et les droits et devoirs qu'il implique"
        },
        searchQuery: "القانون الأحوال الشخصية المدونة الأسرة حقوق الأسرة الزواج الطلاق",
        keywords: ["family law", "moudawana", "marriage", "divorce", "custody"]
    },
    {
        slug: "morocco-labor-code-employee-rights",
        titles: {
            ar: "مدونة الشغل المغربية: حقوق العمال وواجبات المشغلين",
            en: "Morocco's Labor Code: Employee Rights and Employer Obligations",
            fr: "Le Code du Travail Marocain : Droits des Employés et Obligations des Employeurs"
        },
        descriptions: {
            ar: "كل ما تحتاج معرفته عن حقوقك كعامل في المغرب وفق مدونة الشغل",
            en: "Everything you need to know about your rights as an employee in Morocco",
            fr: "Tout ce que vous devez savoir sur vos droits en tant qu'employé au Maroc"
        },
        searchQuery: "مدونة الشغل حقوق العمال الأجور العقود الطرد التعسفي",
        keywords: ["labor law", "employment", "worker rights", "contracts", "dismissal"]
    },
    {
        slug: "criminal-justice-penal-code-morocco",
        titles: {
            ar: "العدالة الجنائية في المغرب: شرح القانون الجنائي",
            en: "Criminal Justice in Morocco: The Penal Code Explained",
            fr: "La Justice Pénale au Maroc : Explication du Code Pénal"
        },
        descriptions: {
            ar: "فهم القانون الجنائي المغربي والعقوبات المقررة للجرائم المختلفة",
            en: "Understanding Moroccan criminal law and penalties for various offenses",
            fr: "Comprendre le droit pénal marocain et les sanctions pour diverses infractions"
        },
        searchQuery: "القانون الجنائي المغربي العقوبات الجرائم المحكمة",
        keywords: ["penal code", "criminal law", "offenses", "penalties", "courts"]
    },
    {
        slug: "property-law-buying-selling-inheritance",
        titles: {
            ar: "قانون العقارات في المغرب: البيع والشراء والإرث",
            en: "Property Law in Morocco: Buying, Selling, and Inheritance",
            fr: "Le Droit Immobilier au Maroc : Achat, Vente et Héritage"
        },
        descriptions: {
            ar: "دليلك الكامل للتعامل مع العقارات في المغرب من الشراء إلى الإرث",
            en: "Your complete guide to dealing with real estate in Morocco",
            fr: "Votre guide complet pour les transactions immobilières au Maroc"
        },
        searchQuery: "القانون العقاري الملكية البيع الشراء الإرث التحفيظ العقاري",
        keywords: ["property law", "real estate", "inheritance", "registration", "ownership"]
    },
    {
        slug: "commercial-law-starting-business-morocco",
        titles: {
            ar: "القانون التجاري في المغرب: تأسيس وإدارة الشركات",
            en: "Commercial Law in Morocco: Starting and Running a Business",
            fr: "Le Droit Commercial au Maroc : Création et Gestion d'Entreprise"
        },
        descriptions: {
            ar: "كيفية تأسيس شركة في المغرب والإطار القانوني للأنشطة التجارية",
            en: "How to start a company in Morocco and the legal framework for business",
            fr: "Comment créer une entreprise au Maroc et le cadre juridique des affaires"
        },
        searchQuery: "القانون التجاري الشركات التأسيس السجل التجاري التجارة",
        keywords: ["commercial law", "business", "company formation", "trade", "commerce"]
    },
    {
        slug: "consumer-protection-rights-morocco",
        titles: {
            ar: "حماية المستهلك في المغرب: حقوقك وكيفية المطالبة بها",
            en: "Consumer Protection Rights Under Moroccan Law",
            fr: "La Protection du Consommateur au Maroc : Vos Droits"
        },
        descriptions: {
            ar: "تعرف على حقوقك كمستهلك في المغرب وكيفية تقديم الشكاوى",
            en: "Know your consumer rights in Morocco and how to file complaints",
            fr: "Connaissez vos droits de consommateur au Maroc et comment porter plainte"
        },
        searchQuery: "حماية المستهلك الضمان الحقوق التجارة الشكاوى",
        keywords: ["consumer rights", "protection", "warranties", "complaints", "commerce"]
    },
    {
        slug: "digital-privacy-cybercrime-laws",
        titles: {
            ar: "الخصوصية الرقمية وقوانين الجرائم الإلكترونية في المغرب",
            en: "Digital Privacy and Cybercrime Laws in Morocco",
            fr: "Vie Privée Numérique et Lois sur la Cybercriminalité au Maroc"
        },
        descriptions: {
            ar: "حماية بياناتك الشخصية والعقوبات المقررة للجرائم الإلكترونية",
            en: "Protecting your personal data and penalties for cybercrime",
            fr: "Protection de vos données personnelles et sanctions pour cybercriminalité"
        },
        searchQuery: "حماية المعطيات الشخصية الجرائم الإلكترونية الخصوصية الإنترنت",
        keywords: ["data protection", "privacy", "cybercrime", "digital rights", "internet"]
    },
    {
        slug: "administrative-law-citizen-rights",
        titles: {
            ar: "القانون الإداري في المغرب: حقوق المواطن أمام الإدارة",
            en: "Administrative Law in Morocco: Citizen Rights Against Government",
            fr: "Le Droit Administratif au Maroc : Droits du Citoyen face à l'Administration"
        },
        descriptions: {
            ar: "كيفية الطعن في القرارات الإدارية وحماية حقوقك أمام الإدارة",
            en: "How to challenge administrative decisions and protect your rights",
            fr: "Comment contester les décisions administratives et protéger vos droits"
        },
        searchQuery: "القانون الإداري الطعون المحاكم الإدارية الحقوق الإدارة",
        keywords: ["administrative law", "courts", "appeals", "government", "citizens"]
    }
];

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
    topic: typeof BLOG_TOPICS[0],
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
    for (let topicIdx = 0; topicIdx < BLOG_TOPICS.length; topicIdx++) {
        const topic = BLOG_TOPICS[topicIdx];
        console.log(`\n📝 [${topicIdx + 1}/8] Topic: "${topic.titles.en}"`);

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
        if (topicIdx < BLOG_TOPICS.length - 1) {
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

    // List the newly generated files
    console.log("\n📄 Generated blog files:");
    BLOG_TOPICS.forEach(topic => {
        console.log(`   📂 ${topic.slug}`);
        LANGUAGES.forEach(lang => {
            const filename = `${topic.slug}${lang.suffix}.md`;
            const filepath = path.join(outputDir, filename);
            if (fs.existsSync(filepath)) {
                console.log(`      ✅ ${filename}`);
            } else {
                console.log(`      ❌ ${filename} (missing)`);
            }
        });
    });
}

// Execute the main function
main().catch(console.error);
