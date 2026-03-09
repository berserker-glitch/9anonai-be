import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Load environment variables from BE/.env
dotenv.config({ path: path.join(__dirname, '../.env') });

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": "https://9anonai.com",
        "X-Title": "9anonai Feedback Generator",
    }
});

const EMAILS_PATH = path.join(__dirname, '../../emails.txt');
const NAMES_PATH = path.join(__dirname, '../../names.txt');
const CSV_PATH = path.join(__dirname, '../../9anonai - 0 DH de chiffre d affaire.csv');

const MODEL = "google/gemini-3-flash-preview";

/**
 * Parses the emails.txt file
 */
function parseEmails(): string[] {
    const content = fs.readFileSync(EMAILS_PATH, 'utf-8');
    const lines = content.split('\n');
    const emails: string[] = [];

    for (const line of lines) {
        if (line.includes('@')) {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length >= 3) {
                const email = parts[2];
                if (email && email.includes('@')) {
                    emails.push(email);
                }
            }
        }
    }
    return emails;
}

/**
 * Parses the names.txt file
 */
function parseNames(): Map<string, string> {
    const content = fs.readFileSync(NAMES_PATH, 'utf-8');
    const lines = content.split('\n');
    const nameMap = new Map<string, string>();

    for (const line of lines) {
        if (line.includes('|') && line.includes('@')) {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length >= 3) {
                const email = parts[1].toLowerCase();
                const name = parts[2];
                if (email && name) {
                    nameMap.set(email, name);
                }
            }
        }
    }
    return nameMap;
}

/**
 * Cleans user name by analyzing email and current DB name
 */
async function cleanUserIdentity(email: string, dbName: string): Promise<{ firstName: string, lastName: string }> {
    try {
        const response = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: `Tu es un expert en nettoyage de données. 
                    Analyse l'email et le nom d'utilisateur (souvent brouillon) pour extraire un PRÉNOM et un NOM propres.
                    
                    REIGLES:
                    - Si l'email contient un nom clair (ex: benahmednaziha3@gmail.com) et que le nom DB est un pseudo (ex: Naziha424), utilise l'email pour reconstruire le nom complet.
                    - Si le nom DB est déjà complet et propre (ex: "Souad Belkorchi"), garde-le.
                    - Formatte en Capitalisant la première lettre (ex: "Ahmed", "El Amraoui").
                    - Retourne UNIQUEMENT un objet JSON avec les clés "firstName" et "lastName".`
                },
                {
                    role: "user",
                    content: `Email: ${email}, Nom DB: ${dbName}`
                }
            ],
            response_format: { type: "json_object" }
        });

        const result = JSON.parse(response.choices[0].message?.content || '{"firstName": "Utilisateur", "lastName": ""}');
        return {
            firstName: result.firstName || "Utilisateur",
            lastName: result.lastName || ""
        };
    } catch (error) {
        console.error(`Error cleaning name for ${email}:`, error);
        return { firstName: "Utilisateur", lastName: "" };
    }
}

const PERSONAS = [
    "Étudiant en droit : curieux, technique, apprécie les références aux articles.",
    "Citoyen lambda : cherche des réponses simples sur le divorce ou l'héritage, soulagé par la clarté.",
    "Chef d'entreprise : pressé, cherche des infos sur le code de commerce ou le travail, focus efficacité.",
    "Professionnel (notaire/expert) : exigeant sur les sources, apprécie le gain de temps pour la recherche.",
    "Utilisateur occasionnel : ton décontracté, satisfait d'avoir une réponse sans payer un avocat tout de suite."
];

const SCENARIOS = [
    "une question sur la Moudawana (code de la famille)",
    "une recherche sur le code pénal marocain",
    "un doute sur un contrat de bail immobilier",
    "une interrogation sur le droit du travail (licenciement, CNSS)",
    "la création d'une SARL au Maroc",
    "une procédure administrative simple"
];

/**
 * Generates human-like French feedback with high variety
 */
async function generateFeedback(firstName: string, lastName: string, index: number): Promise<string> {
    const persona = PERSONAS[index % PERSONAS.length];
    const scenario = SCENARIOS[index % SCENARIOS.length];
    const fullName = `${firstName} ${lastName}`.trim();

    try {
        const response = await openai.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: `Tu es un utilisateur de 9anon.ai, une IA spécialisée dans le droit marocain. 
                    L'application permet de discuter avec les textes de loi et cite ses sources.
                    
                    PERSONA: ${persona}
                    CONTEXTE: Tu viens d'utiliser l'IA pour ${scenario}.
                    
                    CONSIGNE:
                    - Écris un feedback d'UNE SEULE PHRASE courte (max 15 mots).
                    - Langue: Français naturel.
                    - Ton: Varié.
                    - Ne mentionne PAS forcément ton nom dans le texte.
                    - Évite les clichés d'IA.
                    - Ne mets PAS de guillemets.`
                },
                {
                    role: "user",
                    content: `Génère le feedback pour ${fullName}.`
                }
            ],
            max_tokens: 60,
            temperature: 0.95
        });

        return response.choices[0].message?.content?.replace(/["\n\r]/g, '').trim() || "Très utile pour mes démarches.";
    } catch (error) {
        return "Pratique et rapide pour les questions de droit.";
    }
}

/**
 * Escapes CSV values
 */
function escapeCSV(val: string | number): string {
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
}

async function start() {
    console.log("🚀 Starting cleaned & enhanced feedback generation...");

    const emails = parseEmails();
    const nameMap = parseNames();

    console.log(`Parsed ${emails.length} emails and ${nameMap.size} unique names.`);

    const header = "Nombre,Nom ,Prénom ,Téléphone ,Email ,Feedback des Clients";
    const csvRows = [header];

    for (let i = 0; i < emails.length; i++) {
        const email = emails[i];
        const dbName = nameMap.get(email.toLowerCase()) || "";

        console.log(`[${i + 1}/${emails.length}] Processing: ${email}`);

        // Step 1: Clean Name
        const { firstName, lastName } = await cleanUserIdentity(email, dbName);
        console.log(`   Cleaned: ${firstName} ${lastName}`);

        // Step 2: Generate Feedback
        const feedback = await generateFeedback(firstName, lastName, i);
        console.log(`   Feedback: ${feedback}`);

        const row = [
            i + 1,
            escapeCSV(lastName),
            escapeCSV(firstName),
            "",
            escapeCSV(email),
            escapeCSV(feedback)
        ].join(',');

        csvRows.push(row);
    }

    fs.writeFileSync(CSV_PATH, csvRows.join('\n'), 'utf-8');
    console.log(`✅ Success! Final cleaned CSV updated at: ${CSV_PATH}`);
}

start().catch(console.error);
