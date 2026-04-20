"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateFlexiblePDF = generateFlexiblePDF;
exports.generateContract = generateContract;
exports.getContractTypes = getContractTypes;
const puppeteer_1 = __importDefault(require("puppeteer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("./prisma");
const logger_1 = require("./logger");
const GENERATED_PDFS_DIR = path_1.default.join(__dirname, "../../uploads/pdfs-generated");
/**
 * Escapes HTML entities to prevent XSS when embedding user content in templates.
 */
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
function ensureDirectoryExists(userId) {
    const userDir = path_1.default.join(GENERATED_PDFS_DIR, userId);
    if (!fs_1.default.existsSync(userDir)) {
        fs_1.default.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
}
/**
 * Detect if text contains Arabic characters
 */
function containsArabic(text) {
    return /[\u0600-\u06FF]/.test(text);
}
/**
 * Detect if the content is already HTML (has actual HTML tags, not just text)
 */
function isHtmlContent(content) {
    // Check for common HTML structural tags (not just inline like <br>)
    return /<(?:h[1-6]|p|div|ol|ul|li|table|section|article|header|strong|em)\b/i.test(content);
}
/**
 * Convert markdown-like content to HTML
 * Used only for plain-text/markdown content — NOT for content that's already HTML
 */
function contentToHtml(content) {
    const lines = content.split('\n');
    let html = '';
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            html += '<br/>';
            continue;
        }
        // Headers
        if (trimmed.startsWith('### ')) {
            html += `<h3>${trimmed.replace('### ', '')}</h3>`;
        }
        else if (trimmed.startsWith('## ')) {
            html += `<h2>${trimmed.replace('## ', '')}</h2>`;
        }
        else if (trimmed.startsWith('# ')) {
            html += `<h1>${trimmed.replace('# ', '')}</h1>`;
        }
        // Bold (full line)
        else if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
            html += `<p><strong>${trimmed.replace(/\*\*/g, '')}</strong></p>`;
        }
        // Bullet points
        else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
            html += `<p style="padding-right: 20px;">• ${trimmed.substring(2)}</p>`;
        }
        // Numbered lists
        else if (/^\d+\.\s/.test(trimmed)) {
            html += `<p style="padding-right: 20px;">${trimmed}</p>`;
        }
        // Article headers
        else if (/^Article\s+\d+|^ARTICLE\s+\d+|^المادة|^الفصل|^البند/i.test(trimmed)) {
            html += `<h3 style="margin-top: 20px;">${trimmed}</h3>`;
        }
        // Regular paragraph with inline bold
        else {
            const withBold = trimmed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
            html += `<p>${withBold}</p>`;
        }
    }
    return html;
}
/**
 * Generate the full HTML document for PDF rendering.
 * Handles both raw HTML content (from contract builder) and plain text/markdown.
 */
function generateHtmlTemplate(title, content, language, timestamp) {
    const isRTL = language === 'ar' || containsArabic(content);
    const direction = isRTL ? 'rtl' : 'ltr';
    const textAlign = isRTL ? 'right' : 'left';
    const fontFamily = isRTL ? "'Amiri', 'Traditional Arabic', 'Arial', serif" : "'Times New Roman', serif";
    // Sanitize the title (always plain text)
    const safeTitle = escapeHtml(title);
    // If the content is already HTML (from the contract builder AI), use it directly.
    // Otherwise, convert markdown/plain text to HTML.
    const contentHtml = isHtmlContent(content) ? content : contentToHtml(content);
    return `
<!DOCTYPE html>
<html lang="${language}" dir="${direction}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap" rel="stylesheet">
    <title>${safeTitle}</title>
    <style>
        @page {
            size: A4;
            margin: 20mm;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: ${fontFamily};
            font-size: 12pt;
            line-height: 1.8;
            direction: ${direction};
            text-align: ${textAlign};
            color: #222;
            padding: 0;
        }

        .header {
            text-align: ${isRTL ? 'left' : 'right'};
            font-size: 9pt;
            color: #888;
            margin-bottom: 20px;
            border-bottom: 1px solid #ddd;
            padding-bottom: 8px;
        }

        .content {
            margin-bottom: 30px;
        }

        /* ── Typography for AI-generated contract HTML ── */

        .content h1 {
            font-size: 18pt;
            font-weight: bold;
            text-align: center;
            margin: 10px 0 20px;
            color: #111;
        }

        .content h2 {
            font-size: 13pt;
            font-weight: bold;
            margin: 22px 0 8px;
            color: #222;
            border-bottom: 1px solid #eee;
            padding-bottom: 4px;
        }

        .content h3 {
            font-size: 12pt;
            font-weight: bold;
            margin: 18px 0 6px;
            color: #333;
        }

        .content p {
            margin: 6px 0;
            text-align: justify;
        }

        .content ol, .content ul {
            margin: 8px 0;
            padding-left: ${isRTL ? '0' : '25px'};
            padding-right: ${isRTL ? '25px' : '0'};
        }

        .content li {
            margin: 4px 0;
        }

        .content table {
            width: 100%;
            border-collapse: collapse;
            margin: 12px 0;
        }

        .content table td,
        .content table th {
            border: 1px solid #ccc;
            padding: 6px 10px;
            text-align: ${textAlign};
        }

        .content table th {
            background: #f5f5f5;
            font-weight: bold;
        }

        strong {
            font-weight: bold;
        }

        em {
            font-style: italic;
        }

        .footer {
            margin-top: 40px;
            padding-top: 15px;
            border-top: 1px solid #ddd;
            font-size: 9pt;
            color: #666;
            text-align: center;
        }

        .legal-notice {
            margin-top: 20px;
            padding: 12px;
            background: #f9f9f9;
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            font-size: 9pt;
        }
    </style>
</head>
<body>
    <div class="header">
        <div>9anon - Moroccan Legal AI</div>
        <div>Document ID: ${timestamp}</div>
    </div>

    <div class="content">
        ${contentHtml}
    </div>

    <div class="footer">
        <div class="legal-notice">
            <strong>${isRTL ? 'ملاحظة قانونية:' : language === 'fr' ? 'Mention légale :' : 'Legal Notice:'}</strong><br/>
            ${isRTL
        ? '1. يجب تصحيح الإمضاءات لدى السلطات المحلية (المقاطعة)<br/>2. يجب تسجيل العقد لدى إدارة الضرائب خلال 30 يوماً'
        : language === 'fr'
            ? '1. Les signatures doivent être légalisées auprès des autorités locales (Moqata\'a)<br/>2. Le contrat doit être enregistré auprès de l\'Administration fiscale dans les 30 jours'
            : '1. Legalize signatures at local authorities (Moqata\'a)<br/>2. Register with Tax Administration within 30 days'}
        </div>
        <br/>
        <div>Generated by 9anon - Moroccan Legal AI Assistant</div>
        <div>${language === 'fr'
        ? 'Ce document doit être revu par un professionnel du droit avant signature.'
        : language === 'ar'
            ? 'يجب مراجعة هذا المستند من قبل متخصص قانوني قبل التوقيع.'
            : 'This document should be reviewed by a legal professional before signing.'}</div>
    </div>
</body>
</html>`;
}
/**
 * Generate PDF using Puppeteer (HTML to PDF)
 * Properly handles Arabic, French, and English.
 * Detects whether content is raw HTML or markdown and processes accordingly.
 */
async function generateFlexiblePDF(userId, title, content, type = "document", language = "en") {
    const userDir = ensureDirectoryExists(userId);
    const timestamp = Date.now();
    const filename = `${type}_${timestamp}.pdf`;
    const filepath = path_1.default.join(userDir, filename);
    logger_1.logger.info(`[PDF] Generating PDF: language=${language}, type=${type}, isHtml=${isHtmlContent(content)}`);
    // Generate the full HTML document
    const html = generateHtmlTemplate(title, content, language, timestamp);
    // Launch Puppeteer and generate PDF
    const browser = await puppeteer_1.default.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    try {
        const page = await browser.newPage();
        // Disable JavaScript in page context to prevent XSS during PDF render
        await page.setJavaScriptEnabled(false);
        await page.setContent(html, { waitUntil: 'networkidle0' });
        // Generate A4 PDF
        await page.pdf({
            path: filepath,
            format: 'A4',
            printBackground: true,
            margin: {
                top: '20mm',
                right: '20mm',
                bottom: '20mm',
                left: '20mm'
            }
        });
        logger_1.logger.info(`[PDF] PDF generated successfully: ${filepath}`);
        // Save to database
        const doc = await prisma_1.prisma.generatedDocument.create({
            data: {
                type,
                title,
                filename,
                path: filepath,
                userId,
                metadata: JSON.stringify({ language })
            }
        });
        return {
            id: doc.id,
            filename: doc.filename,
            path: doc.path,
            type: doc.type,
            title: doc.title
        };
    }
    finally {
        await browser.close();
    }
}
/**
 * Main contract generation function (disabled — use generateFlexiblePDF)
 */
async function generateContract(userId, data) {
    throw new Error("PDF generation is permanently disabled.");
}
function getDefaultTitle(type, lang) {
    const titles = {
        rental: { en: "RESIDENTIAL LEASE AGREEMENT", fr: "CONTRAT DE BAIL", ar: "عقد الكراء" },
        employment: { en: "EMPLOYMENT CONTRACT", fr: "CONTRAT DE TRAVAIL", ar: "عقد العمل" },
        service: { en: "SERVICE AGREEMENT", fr: "CONTRAT DE PRESTATION", ar: "عقد الخدمات" },
        nda: { en: "NON-DISCLOSURE AGREEMENT", fr: "ACCORD DE CONFIDENTIALITE", ar: "اتفاقية السرية" },
        sales: { en: "SALES CONTRACT", fr: "CONTRAT DE VENTE", ar: "عقد البيع" },
        gift: { en: "GIFT AGREEMENT", fr: "CONTRAT DE DONATION", ar: "عقد الهبة" },
        custom: { en: "LEGAL DOCUMENT", fr: "DOCUMENT JURIDIQUE", ar: "وثيقة قانونية" }
    };
    const l = lang || "en";
    return titles[type]?.[l] || titles.custom[l];
}
function generateTemplateContent(data) {
    const party1 = data.parties?.[0] || { name: "[PARTY 1 NAME]" };
    const party2 = data.parties?.[1] || { name: "[PARTY 2 NAME]" };
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    return `
Done at ${data.place || "[CITY]"}, on ${today}

BETWEEN:
Party 1: ${party1.name || "[PARTY 1 NAME]"}
CIN: ${party1.cin || "[CIN]"}
Address: ${party1.address || "[ADDRESS]"}

AND:
Party 2: ${party2.name || "[PARTY 2 NAME]"}
CIN: ${party2.cin || "[CIN]"}
Address: ${party2.address || "[ADDRESS]"}

THE PARTIES HAVE AGREED AS FOLLOWS:

[Contract terms to be specified]

SIGNATURES:

Party 1: _______________                Party 2: _______________
Date: ${today}                          Date: ${today}
`;
}
function getContractTypes() {
    return [
        { type: "rental", title: "Lease Agreement" },
        { type: "employment", title: "Employment Contract" },
        { type: "service", title: "Service Agreement" },
        { type: "nda", title: "Non-Disclosure Agreement" },
        { type: "sales", title: "Sales Contract" },
        { type: "gift", title: "Gift Agreement" },
    ];
}
