import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { prisma } from "./prisma";

const GENERATED_PDFS_DIR = path.join(__dirname, "../../uploads/pdfs-generated");

export interface ContractData {
    type: string;
    title?: string;
    language?: "fr" | "ar" | "en";
    parties?: Array<{ name?: string; cin?: string; address?: string }>;
    content?: string;
    place?: string;
    startDate?: string;
    duration?: string;
    propertyAddress?: string;
    rentAmount?: string;
    deposit?: string;
    position?: string;
    salary?: string;
    serviceDescription?: string;
    deliverables?: string;
    confidentialInfo?: string;
    ndaDuration?: string;
    customContent?: string;
}

export interface GeneratedDocument {
    id: string;
    filename: string;
    path: string;
    type: string;
    title: string;
}

function ensureDirectoryExists(userId: string) {
    const userDir = path.join(GENERATED_PDFS_DIR, userId);
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
}

/**
 * Detect if text contains Arabic characters
 */
function containsArabic(text: string): boolean {
    return /[\u0600-\u06FF]/.test(text);
}

/**
 * Convert markdown-like content to HTML
 */
function contentToHtml(content: string): string {
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
        } else if (trimmed.startsWith('## ')) {
            html += `<h2>${trimmed.replace('## ', '')}</h2>`;
        } else if (trimmed.startsWith('# ')) {
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
 * Generate HTML template for A4 PDF
 */
function generateHtmlTemplate(title: string, content: string, language: string, timestamp: number): string {
    const isRTL = language === 'ar' || containsArabic(content);
    const direction = isRTL ? 'rtl' : 'ltr';
    const textAlign = isRTL ? 'right' : 'left';
    const fontFamily = isRTL ? "'Amiri', 'Traditional Arabic', 'Arial', serif" : "'Times New Roman', serif";

    const contentHtml = contentToHtml(content);

    return `
<!DOCTYPE html>
<html lang="${language}" dir="${direction}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&display=swap" rel="stylesheet">
    <title>${title}</title>
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
            line-height: 1.6;
            direction: ${direction};
            text-align: ${textAlign};
            color: #333;
            padding: 0;
        }
        
        .header {
            text-align: ${isRTL ? 'left' : 'right'};
            font-size: 9pt;
            color: #666;
            margin-bottom: 30px;
            border-bottom: 1px solid #ddd;
            padding-bottom: 10px;
        }
        
        .title {
            text-align: center;
            font-size: 18pt;
            font-weight: bold;
            margin-bottom: 30px;
            color: #1a1a1a;
        }
        
        .content {
            margin-bottom: 30px;
        }
        
        h1 {
            font-size: 16pt;
            text-align: center;
            margin: 20px 0 15px;
            color: #1a1a1a;
        }
        
        h2 {
            font-size: 14pt;
            margin: 18px 0 12px;
            color: #2a2a2a;
        }
        
        h3 {
            font-size: 12pt;
            margin: 15px 0 10px;
            color: #3a3a3a;
        }
        
        p {
            margin: 8px 0;
            text-align: justify;
        }
        
        strong {
            font-weight: bold;
        }
        
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            font-size: 9pt;
            color: #666;
            text-align: center;
        }
        
        .signatures {
            margin-top: 50px;
            display: flex;
            justify-content: space-between;
        }
        
        .signature-block {
            text-align: center;
            width: 45%;
        }
        
        .signature-line {
            border-top: 1px solid #333;
            margin-top: 50px;
            padding-top: 10px;
        }
        
        .legal-notice {
            margin-top: 30px;
            padding: 15px;
            background: #f9f9f9;
            border: 1px solid #e0e0e0;
            border-radius: 5px;
            font-size: 10pt;
        }
    </style>
</head>
<body>
    <div class="header">
        <div>9anon - Moroccan Legal AI</div>
        <div>Document ID: ${timestamp}</div>
    </div>
    
    <div class="title">${title}</div>
    
    <div class="content">
        ${contentHtml}
    </div>
    
    <div class="footer">
        <div class="legal-notice">
            <strong>${isRTL ? 'ملاحظة قانونية:' : 'Legal Notice:'}</strong><br/>
            ${isRTL
            ? '1. يجب تصحيح الإمضاءات لدى السلطات المحلية (المقاطعة)<br/>2. يجب تسجيل العقد لدى إدارة الضرائب خلال 30 يوماً'
            : '1. Legalize signatures at local authorities (Moqata\'a)<br/>2. Register with Tax Administration within 30 days'
        }
        </div>
        <br/>
        <div>Generated by 9anon - Moroccan Legal AI Assistant</div>
        <div>This document should be reviewed by a legal professional before signing.</div>
    </div>
</body>
</html>`;
}

/**
 * Generate PDF using Puppeteer (HTML to PDF)
 * Properly handles Arabic, French, and English
 */
export async function generateFlexiblePDF(
    userId: string,
    title: string,
    content: string,
    type: string = "document",
    language: string = "en"
): Promise<GeneratedDocument> {
    const userDir = ensureDirectoryExists(userId);
    const timestamp = Date.now();
    const filename = `${type}_${timestamp}.pdf`;
    const filepath = path.join(userDir, filename);

    console.log(`Generating PDF with Puppeteer: language=${language}, type=${type}`);

    // Generate HTML
    const html = generateHtmlTemplate(title, content, language, timestamp);

    // Launch Puppeteer and generate PDF
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
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

        console.log(`PDF generated successfully: ${filepath}`);

        // Save to Database
        const doc = await prisma.generatedDocument.create({
            data: {
                type,
                title,
                filename,
                path: filepath, // OR relative path? FilesModal uses API to list.
                // The API /download/:id uses filepath from DB to res.download.
                // res.download checks fs.exists(document.path).
                // So storing ABSOLUTE path is fine if backend runs on same machine.
                // But usually relative is safer.
                // However, pdf.ts code: `if (fs.existsSync(document.path))` implies absolute or relative to CWD.
                // EnsureDirectoryExists returns absolute.
                // So storing absolute path is consistent with current usage.
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

    } finally {
        await browser.close();
    }
}

/**
 * Main contract generation function
 */
export async function generateContract(
    userId: string,
    data: ContractData
): Promise<GeneratedDocument> {
    throw new Error("PDF generation is permanently disabled.");
}

function getDefaultTitle(type: string, lang?: string): string {
    const titles: Record<string, Record<string, string>> = {
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

function generateTemplateContent(data: ContractData): string {
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

export function getContractTypes() {
    return [
        { type: "rental", title: "Lease Agreement" },
        { type: "employment", title: "Employment Contract" },
        { type: "service", title: "Service Agreement" },
        { type: "nda", title: "Non-Disclosure Agreement" },
        { type: "sales", title: "Sales Contract" },
        { type: "gift", title: "Gift Agreement" },
    ];
}
