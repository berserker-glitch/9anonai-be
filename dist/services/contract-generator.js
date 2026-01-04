"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateContract = generateContract;
exports.getContractTypes = getContractTypes;
const pdfkit_1 = __importDefault(require("pdfkit"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Ensure uploads directory exists
const GENERATED_PDFS_DIR = path_1.default.join(__dirname, "../../uploads/pdfs-generated");
function ensureDirectoryExists(userId) {
    const userDir = path_1.default.join(GENERATED_PDFS_DIR, userId);
    if (!fs_1.default.existsSync(userDir)) {
        fs_1.default.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
}
function formatDate(date) {
    if (date)
        return date;
    const now = new Date();
    return `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
}
/**
 * Generate Employment Contract
 */
function generateEmploymentContract(doc, data) {
    const employer = data.parties[0];
    const employee = data.parties[1];
    const lang = data.language || "fr";
    // Title
    doc.fontSize(18).font('Helvetica-Bold');
    if (lang === "fr") {
        doc.text("CONTRAT DE TRAVAIL", { align: "center" });
    }
    else if (lang === "en") {
        doc.text("EMPLOYMENT CONTRACT", { align: "center" });
    }
    else {
        // Arabic - align right for RTL languages
        doc.text("عقد العمل", { align: "right" });
    }
    doc.moveDown(2);
    // Header info
    doc.fontSize(11).font('Helvetica');
    const headerText = lang === "fr"
        ? `Fait à ${data.place || "________"}, le ${formatDate(data.date)}`
        : lang === "en"
            ? `Done at ${data.place || "________"}, on ${formatDate(data.date)}`
            : `حرر ب${data.place || "________"}، بتاريخ ${formatDate(data.date)}`;
    doc.text(headerText);
    doc.moveDown(2);
    // Parties section
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text(lang === "fr" ? "ENTRE LES SOUSSIGNÉS:" : lang === "en" ? "BETWEEN THE UNDERSIGNED:" : "بين الموقعين أدناه:");
    doc.moveDown();
    doc.fontSize(11).font('Helvetica');
    if (lang === "fr") {
        doc.text(`L'EMPLOYEUR: ${employer.name || "________"}`);
        doc.text(`CIN: ${employer.cin || "________"}`);
        doc.text(`Adresse: ${employer.address || "________"}`);
        doc.moveDown();
        doc.text(`L'EMPLOYÉ(E): ${employee?.name || "________"}`);
        doc.text(`CIN: ${employee?.cin || "________"}`);
        doc.text(`Adresse: ${employee?.address || "________"}`);
    }
    else if (lang === "en") {
        doc.text(`EMPLOYER: ${employer.name || "________"}`);
        doc.text(`ID Number: ${employer.cin || "________"}`);
        doc.text(`Address: ${employer.address || "________"}`);
        doc.moveDown();
        doc.text(`EMPLOYEE: ${employee?.name || "________"}`);
        doc.text(`ID Number: ${employee?.cin || "________"}`);
        doc.text(`Address: ${employee?.address || "________"}`);
    }
    doc.moveDown(2);
    // Agreement statement
    doc.text(lang === "fr"
        ? "IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT:"
        : "IT HAS BEEN AGREED AS FOLLOWS:");
    doc.moveDown(2);
    // Articles
    const articles = [
        {
            title: lang === "fr" ? "ARTICLE 1 - ENGAGEMENT" : "ARTICLE 1 - EMPLOYMENT",
            content: lang === "fr"
                ? `L'employeur engage le salarié en qualité de ${data.position || "________"}.`
                : `The employer hires the employee as ${data.position || "________"}.`
        },
        {
            title: lang === "fr" ? "ARTICLE 2 - DURÉE DU CONTRAT" : "ARTICLE 2 - CONTRACT DURATION",
            content: lang === "fr"
                ? `Le présent contrat est conclu pour une durée ${data.duration || "indéterminée"}, prenant effet à compter du ${data.startDate || "________"}.`
                : `This contract is concluded for a duration of ${data.duration || "indefinite"}, effective from ${data.startDate || "________"}.`
        },
        {
            title: lang === "fr" ? "ARTICLE 3 - RÉMUNÉRATION" : "ARTICLE 3 - REMUNERATION",
            content: lang === "fr"
                ? `En contrepartie de ses services, le salarié percevra une rémunération mensuelle brute de ${data.salary || "________"} MAD.`
                : `In consideration for their services, the employee shall receive a gross monthly salary of ${data.salary || "________"} MAD.`
        },
        {
            title: lang === "fr" ? "ARTICLE 4 - PÉRIODE D'ESSAI" : "ARTICLE 4 - PROBATION PERIOD",
            content: lang === "fr"
                ? "Conformément au Code du travail marocain, le présent contrat est soumis à une période d'essai de trois mois, renouvelable une fois."
                : "In accordance with the Moroccan Labor Code, this contract is subject to a three-month probation period, renewable once."
        },
        {
            title: lang === "fr" ? "ARTICLE 5 - LIEU DE TRAVAIL" : "ARTICLE 5 - PLACE OF WORK",
            content: lang === "fr"
                ? `Le salarié exercera ses fonctions à ${employer.address || "________"}.`
                : `The employee shall perform their duties at ${employer.address || "________"}.`
        },
        {
            title: lang === "fr" ? "ARTICLE 6 - HORAIRES DE TRAVAIL" : "ARTICLE 6 - WORKING HOURS",
            content: lang === "fr"
                ? "Le salarié est soumis à la durée légale du travail fixée à 44 heures par semaine, conformément à l'article 184 du Code du travail."
                : "The employee is subject to the legal working hours of 44 hours per week, in accordance with Article 184 of the Labor Code."
        },
        {
            title: lang === "fr" ? "ARTICLE 7 - CONGÉS PAYÉS" : "ARTICLE 7 - PAID LEAVE",
            content: lang === "fr"
                ? "Le salarié bénéficie d'un congé annuel payé conformément aux dispositions du Code du travail (1,5 jour ouvrable par mois de service)."
                : "The employee is entitled to annual paid leave in accordance with the Labor Code provisions (1.5 working days per month of service)."
        },
        {
            title: lang === "fr" ? "ARTICLE 8 - OBLIGATIONS DU SALARIÉ" : "ARTICLE 8 - EMPLOYEE OBLIGATIONS",
            content: lang === "fr"
                ? "Le salarié s'engage à exécuter de bonne foi les tâches qui lui sont confiées, à respecter le règlement intérieur et à préserver la confidentialité des informations de l'entreprise."
                : "The employee undertakes to perform their assigned tasks in good faith, comply with internal regulations, and maintain confidentiality of company information."
        },
        {
            title: lang === "fr" ? "ARTICLE 9 - RÉSILIATION" : "ARTICLE 9 - TERMINATION",
            content: lang === "fr"
                ? "Le présent contrat peut être résilié par l'une ou l'autre des parties dans le respect des délais de préavis prévus par le Code du travail."
                : "This contract may be terminated by either party in compliance with the notice periods provided by the Labor Code."
        },
        {
            title: lang === "fr" ? "ARTICLE 10 - LITIGES" : "ARTICLE 10 - DISPUTES",
            content: lang === "fr"
                ? "Tout litige relatif à l'exécution du présent contrat sera soumis aux juridictions compétentes du lieu de travail."
                : "Any dispute relating to the performance of this contract shall be submitted to the competent courts of the place of work."
        }
    ];
    articles.forEach((article, index) => {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text(article.title);
        doc.font('Helvetica');
        doc.text(article.content);
        doc.moveDown();
    });
    // Additional clauses
    if (data.additionalClauses && data.additionalClauses.length > 0) {
        doc.moveDown();
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text(lang === "fr" ? "CLAUSES ADDITIONNELLES:" : "ADDITIONAL CLAUSES:");
        doc.font('Helvetica');
        data.additionalClauses.forEach((clause, i) => {
            doc.text(`${i + 1}. ${clause}`);
        });
    }
    // Signatures
    doc.moveDown(3);
    const sigTitle = lang === "fr" ? "SIGNATURES:" : "SIGNATURES:";
    doc.fontSize(12).font('Helvetica-Bold').text(sigTitle);
    doc.moveDown(2);
    doc.fontSize(11).font('Helvetica');
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const halfWidth = pageWidth / 2;
    const y = doc.y;
    doc.text(lang === "fr" ? "L'Employeur:" : "Employer:", doc.page.margins.left, y);
    doc.text(lang === "fr" ? "L'Employé(e):" : "Employee:", doc.page.margins.left + halfWidth, y);
    doc.moveDown(3);
    const signY = doc.y;
    doc.text("_______________________", doc.page.margins.left, signY);
    doc.text("_______________________", doc.page.margins.left + halfWidth, signY);
    doc.moveDown();
    doc.text(`${employer.name || ""}`, doc.page.margins.left, doc.y);
    doc.text(`${employee?.name || ""}`, doc.page.margins.left + halfWidth, doc.y - 14);
}
/**
 * Generate Rental/Lease Contract
 */
function generateRentalContract(doc, data) {
    const landlord = data.parties[0];
    const tenant = data.parties[1];
    const lang = data.language || "fr";
    doc.fontSize(18).font('Helvetica-Bold');
    doc.text(lang === "fr" ? "CONTRAT DE BAIL" : "LEASE AGREEMENT", { align: "center" });
    doc.moveDown(2);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Fait à ${data.place || "________"}, le ${formatDate(data.date)}`);
    doc.moveDown(2);
    // Parties
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text("ENTRE LES SOUSSIGNÉS:");
    doc.moveDown();
    doc.fontSize(11).font('Helvetica');
    doc.text(`LE BAILLEUR: ${landlord.name || "________"}`);
    doc.text(`CIN: ${landlord.cin || "________"}`);
    doc.text(`Adresse: ${landlord.address || "________"}`);
    doc.moveDown();
    doc.text(`LE LOCATAIRE: ${tenant?.name || "________"}`);
    doc.text(`CIN: ${tenant?.cin || "________"}`);
    doc.text(`Adresse: ${tenant?.address || "________"}`);
    doc.moveDown(2);
    doc.text("IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT:");
    doc.moveDown(2);
    const articles = [
        {
            title: "ARTICLE 1 - OBJET DU CONTRAT",
            content: `Le bailleur donne en location au locataire le bien immobilier situé à:\n${data.propertyAddress || "________"}`
        },
        {
            title: "ARTICLE 2 - DURÉE",
            content: `Le présent bail est consenti pour une durée de ${data.rentPeriod || "un an"}, prenant effet à compter du ${data.startDate || "________"}.`
        },
        {
            title: "ARTICLE 3 - LOYER",
            content: `Le loyer mensuel est fixé à ${data.rentAmount || "________"} MAD, payable au plus tard le 5 de chaque mois.`
        },
        {
            title: "ARTICLE 4 - DÉPÔT DE GARANTIE",
            content: `Le locataire verse ce jour au bailleur la somme de ${data.deposit || "________"} MAD à titre de dépôt de garantie.`
        },
        {
            title: "ARTICLE 5 - CHARGES",
            content: "Les charges locatives (eau, électricité, syndic) sont à la charge du locataire."
        },
        {
            title: "ARTICLE 6 - DESTINATION",
            content: "Le local est destiné exclusivement à l'usage d'habitation. Toute modification d'usage nécessite l'accord écrit du bailleur."
        },
        {
            title: "ARTICLE 7 - ENTRETIEN",
            content: "Le locataire s'engage à maintenir les lieux en bon état d'entretien et à effectuer les réparations locatives à sa charge."
        },
        {
            title: "ARTICLE 8 - RÉSILIATION",
            content: "Chaque partie peut résilier le contrat moyennant un préavis de trois mois, notifié par lettre recommandée."
        },
        {
            title: "ARTICLE 9 - ÉTAT DES LIEUX",
            content: "Un état des lieux contradictoire sera établi à l'entrée et à la sortie du locataire."
        },
        {
            title: "ARTICLE 10 - LOI APPLICABLE",
            content: "Le présent contrat est soumis à la loi n° 67-12 relative aux baux d'habitation ou à usage professionnel."
        }
    ];
    articles.forEach(article => {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text(article.title);
        doc.font('Helvetica');
        doc.text(article.content);
        doc.moveDown();
    });
    // Signatures
    doc.moveDown(2);
    doc.fontSize(12).font('Helvetica-Bold').text("SIGNATURES:");
    doc.moveDown(2);
    doc.fontSize(11).font('Helvetica');
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const halfWidth = pageWidth / 2;
    const y = doc.y;
    doc.text("Le Bailleur:", doc.page.margins.left, y);
    doc.text("Le Locataire:", doc.page.margins.left + halfWidth, y);
    doc.moveDown(3);
    const signY = doc.y;
    doc.text("_______________________", doc.page.margins.left, signY);
    doc.text("_______________________", doc.page.margins.left + halfWidth, signY);
}
/**
 * Generate NDA Contract
 */
function generateNDAContract(doc, data) {
    const disclosingParty = data.parties[0];
    const receivingParty = data.parties[1];
    const lang = data.language || "fr";
    doc.fontSize(18).font('Helvetica-Bold');
    doc.text(lang === "fr" ? "ACCORD DE CONFIDENTIALITÉ" : "NON-DISCLOSURE AGREEMENT", { align: "center" });
    doc.moveDown(2);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Fait à ${data.place || "________"}, le ${formatDate(data.date)}`);
    doc.moveDown(2);
    // Parties
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text("ENTRE:");
    doc.moveDown();
    doc.fontSize(11).font('Helvetica');
    doc.text(`PARTIE DIVULGATRICE: ${disclosingParty.name || "________"}`);
    doc.text(`Adresse: ${disclosingParty.address || "________"}`);
    doc.moveDown();
    doc.text(`PARTIE RÉCEPTRICE: ${receivingParty?.name || "________"}`);
    doc.text(`Adresse: ${receivingParty?.address || "________"}`);
    doc.moveDown(2);
    const articles = [
        {
            title: "ARTICLE 1 - OBJET",
            content: "Le présent accord a pour objet de définir les conditions de confidentialité applicables aux informations communiquées entre les parties."
        },
        {
            title: "ARTICLE 2 - INFORMATIONS CONFIDENTIELLES",
            content: `Sont considérées comme confidentielles:\n${data.confidentialInfo || "- Toutes informations techniques, commerciales, financières ou stratégiques\n- Tous documents, données, savoir-faire, procédés\n- Toutes informations orales ou écrites identifiées comme confidentielles"}`
        },
        {
            title: "ARTICLE 3 - OBLIGATIONS",
            content: "La partie réceptrice s'engage à:\n- Ne pas divulguer les informations confidentielles à des tiers\n- Ne les utiliser qu'aux fins expressément autorisées\n- Prendre toutes mesures pour préserver leur confidentialité"
        },
        {
            title: "ARTICLE 4 - DURÉE",
            content: `Les obligations de confidentialité restent en vigueur pendant ${data.ndaDuration || "cinq (5) ans"} à compter de la signature du présent accord.`
        },
        {
            title: "ARTICLE 5 - EXCLUSIONS",
            content: "Ne sont pas considérées comme confidentielles les informations:\n- Déjà connues du public\n- Développées indépendamment par la partie réceptrice\n- Communiquées par un tiers autorisé"
        },
        {
            title: "ARTICLE 6 - SANCTIONS",
            content: "Toute violation des présentes obligations pourra donner lieu à des poursuites judiciaires et au versement de dommages et intérêts."
        },
        {
            title: "ARTICLE 7 - LOI APPLICABLE",
            content: "Le présent accord est régi par le droit marocain. Tout litige sera soumis aux tribunaux compétents."
        }
    ];
    articles.forEach(article => {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text(article.title);
        doc.font('Helvetica');
        doc.text(article.content);
        doc.moveDown();
    });
    // Signatures
    doc.moveDown(2);
    doc.fontSize(12).font('Helvetica-Bold').text("SIGNATURES:");
    doc.moveDown(2);
    doc.fontSize(11).font('Helvetica');
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const halfWidth = pageWidth / 2;
    const y = doc.y;
    doc.text("Partie Divulgatrice:", doc.page.margins.left, y);
    doc.text("Partie Réceptrice:", doc.page.margins.left + halfWidth, y);
    doc.moveDown(3);
    const signY = doc.y;
    doc.text("_______________________", doc.page.margins.left, signY);
    doc.text("_______________________", doc.page.margins.left + halfWidth, signY);
}
/**
 * Generate Service Agreement
 */
function generateServiceContract(doc, data) {
    const client = data.parties[0];
    const provider = data.parties[1];
    doc.fontSize(18).font('Helvetica-Bold');
    doc.text("CONTRAT DE PRESTATION DE SERVICES", { align: "center" });
    doc.moveDown(2);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Fait à ${data.place || "________"}, le ${formatDate(data.date)}`);
    doc.moveDown(2);
    // Parties
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text("ENTRE LES SOUSSIGNÉS:");
    doc.moveDown();
    doc.fontSize(11).font('Helvetica');
    doc.text(`LE CLIENT: ${client.name || "________"}`);
    doc.text(`Adresse: ${client.address || "________"}`);
    doc.moveDown();
    doc.text(`LE PRESTATAIRE: ${provider?.name || "________"}`);
    doc.text(`Adresse: ${provider?.address || "________"}`);
    doc.moveDown(2);
    const articles = [
        {
            title: "ARTICLE 1 - OBJET",
            content: `Le prestataire s'engage à fournir les services suivants:\n${data.serviceDescription || "________"}`
        },
        {
            title: "ARTICLE 2 - DURÉE",
            content: `Le présent contrat prend effet le ${data.startDate || "________"} pour une durée de ${data.duration || "________"}.`
        },
        {
            title: "ARTICLE 3 - LIVRABLES",
            content: `Les livrables attendus sont:\n${data.deliverables || "________"}`
        },
        {
            title: "ARTICLE 4 - RÉMUNÉRATION",
            content: `Le prestataire percevra une rémunération de ${data.salary || "________"} MAD.\nConditions de paiement: ${data.paymentTerms || "À la livraison"}`
        },
        {
            title: "ARTICLE 5 - OBLIGATIONS DU PRESTATAIRE",
            content: "Le prestataire s'engage à:\n- Exécuter les services avec diligence et professionnalisme\n- Respecter les délais convenus\n- Informer le client de tout obstacle à l'exécution"
        },
        {
            title: "ARTICLE 6 - OBLIGATIONS DU CLIENT",
            content: "Le client s'engage à:\n- Fournir toutes informations nécessaires à l'exécution\n- Procéder au paiement dans les délais convenus"
        },
        {
            title: "ARTICLE 7 - CONFIDENTIALITÉ",
            content: "Chaque partie s'engage à préserver la confidentialité des informations échangées."
        },
        {
            title: "ARTICLE 8 - RÉSILIATION",
            content: "Le contrat peut être résilié par l'une ou l'autre des parties moyennant un préavis de 30 jours."
        }
    ];
    articles.forEach(article => {
        doc.fontSize(11).font('Helvetica-Bold');
        doc.text(article.title);
        doc.font('Helvetica');
        doc.text(article.content);
        doc.moveDown();
    });
    // Signatures
    doc.moveDown(2);
    doc.fontSize(12).font('Helvetica-Bold').text("SIGNATURES:");
    doc.moveDown(2);
    doc.fontSize(11).font('Helvetica');
    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const halfWidth = pageWidth / 2;
    const y = doc.y;
    doc.text("Le Client:", doc.page.margins.left, y);
    doc.text("Le Prestataire:", doc.page.margins.left + halfWidth, y);
    doc.moveDown(3);
    const signY = doc.y;
    doc.text("_______________________", doc.page.margins.left, signY);
    doc.text("_______________________", doc.page.margins.left + halfWidth, signY);
}
/**
 * Main function to generate PDF contract
 */
async function generateContract(userId, data) {
    const userDir = ensureDirectoryExists(userId);
    const timestamp = Date.now();
    const filename = `${data.type}_${timestamp}.pdf`;
    const filepath = path_1.default.join(userDir, filename);
    // Title map
    const titleMap = {
        employment: "Contrat de Travail",
        rental: "Contrat de Bail",
        service: "Contrat de Prestation",
        nda: "Accord de Confidentialité",
        sales: "Contrat de Vente",
        power_of_attorney: "Procuration",
        demand_letter: "Mise en Demeure"
    };
    return new Promise((resolve, reject) => {
        const doc = new pdfkit_1.default({
            size: 'A4',
            margins: { top: 50, bottom: 50, left: 60, right: 60 },
            info: {
                Title: titleMap[data.type] || "Legal Document",
                Author: "9anon - Moroccan Legal AI",
                Subject: `${data.type} contract`,
                Creator: "9anon Legal Document Generator"
            }
        });
        const writeStream = fs_1.default.createWriteStream(filepath);
        doc.pipe(writeStream);
        // Header
        doc.fontSize(9).font('Helvetica');
        doc.text("9anon - Assistant Juridique Marocain", { align: "right" });
        doc.moveDown(2);
        // Generate based on type
        switch (data.type) {
            case "employment":
                generateEmploymentContract(doc, data);
                break;
            case "rental":
                generateRentalContract(doc, data);
                break;
            case "nda":
                generateNDAContract(doc, data);
                break;
            case "service":
                generateServiceContract(doc, data);
                break;
            default:
                // Generic document
                doc.fontSize(16).font('Helvetica-Bold');
                doc.text("DOCUMENT JURIDIQUE", { align: "center" });
                doc.moveDown(2);
                doc.fontSize(11).font('Helvetica');
                doc.text("Ce document a été généré par 9anon.");
        }
        // Footer
        doc.moveDown(3);
        doc.fontSize(8).font('Helvetica');
        doc.text("─".repeat(70));
        doc.text("Document généré par 9anon - Assistant Juridique IA Marocain");
        doc.text("Ce document est un modèle et doit être vérifié par un professionnel du droit avant signature.");
        doc.end();
        writeStream.on("finish", () => {
            resolve({
                id: `doc_${timestamp}`,
                filename,
                path: `/uploads/pdfs-generated/${userId}/${filename}`,
                type: data.type,
                title: titleMap[data.type] || "Legal Document"
            });
        });
        writeStream.on("error", reject);
    });
}
/**
 * Get contract type titles for display
 */
function getContractTypes() {
    return [
        { type: "employment", title: "Contrat de Travail", titleEn: "Employment Contract" },
        { type: "rental", title: "Contrat de Bail", titleEn: "Lease Agreement" },
        { type: "service", title: "Contrat de Prestation", titleEn: "Service Agreement" },
        { type: "nda", title: "Accord de Confidentialité", titleEn: "Non-Disclosure Agreement" },
        { type: "sales", title: "Contrat de Vente", titleEn: "Sales Contract" },
    ];
}
