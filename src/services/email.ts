/**
 * @fileoverview Email service for 9anon using Resend.
 * Handles transactional emails: welcome, newsletter, re-engagement.
 *
 * Setup:
 *   1. npm install resend   (in BE/)
 *   2. Set RESEND_API_KEY in .env
 *   3. Set EMAIL_FROM in .env  (e.g. "9anon AI <noreply@9anonai.com>")
 *
 * @module services/email
 */

import { Resend } from "resend";
import { logger } from "./logger";

const FROM = process.env.EMAIL_FROM || "9anon AI <noreply@9anonai.com>";

// Lazy singleton — only instantiated when RESEND_API_KEY is set
let _resend: Resend | null = null;
function getResend(): Resend | null {
    if (!process.env.RESEND_API_KEY) return null;
    if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
    return _resend;
}

// ─── Core sendEmail helper ────────────────────────────────────────────────────

export async function sendEmail(opts: {
    to: string;
    subject: string;
    html: string;
}): Promise<void> {
    const client = getResend();
    if (!client) {
        logger.warn("[EMAIL] RESEND_API_KEY not set — skipping email send");
        return;
    }
    try {
        const { error } = await client.emails.send({
            from: FROM,
            to: opts.to,
            subject: opts.subject,
            html: opts.html,
        });
        if (error) {
            logger.error("[EMAIL] Resend error", { error });
        }
    } catch (err: any) {
        logger.error("[EMAIL] Failed to send email", { error: err?.message });
    }
}

// ─── Welcome email (sent after registration) ─────────────────────────────────

export async function sendWelcomeEmail(
    email: string,
    name?: string | null,
    lang: string = "ar"
): Promise<void> {
    const displayName = name || email.split("@")[0];

    const content = {
        ar: {
            subject: "مرحباً بك في 9anon AI 🎉",
            greeting: `مرحباً ${displayName}،`,
            body: `شكراً لانضمامك إلى 9anon AI — مساعدك القانوني الذكي المجاني لكل ما يخص القانون المغربي.<br/><br/>
يمكنك الآن طرح أسئلتك القانونية في أي وقت، والحصول على إجابات دقيقة حول مدونة الأسرة، قانون الشغل، العقارات، وأكثر.`,
            cta: "ابدأ محادثتك الأولى",
            footer: "إذا لم تقم بإنشاء هذا الحساب، يمكنك تجاهل هذه الرسالة.",
        },
        fr: {
            subject: "Bienvenue sur 9anon AI 🎉",
            greeting: `Bonjour ${displayName},`,
            body: `Merci de nous avoir rejoints sur 9anon AI — votre assistant juridique IA gratuit pour le droit marocain.<br/><br/>
Vous pouvez maintenant poser vos questions juridiques à tout moment et obtenir des réponses précises sur la Moudawana, le Code du Travail, l'immobilier, et bien plus.`,
            cta: "Démarrer votre première conversation",
            footer: "Si vous n'avez pas créé ce compte, vous pouvez ignorer cet email.",
        },
        en: {
            subject: "Welcome to 9anon AI 🎉",
            greeting: `Hello ${displayName},`,
            body: `Thank you for joining 9anon AI — your free AI legal assistant for Moroccan law.<br/><br/>
You can now ask legal questions anytime and get accurate answers about family law, labor law, real estate, and more.`,
            cta: "Start your first conversation",
            footer: "If you didn't create this account, you can safely ignore this email.",
        },
    };

    const l = (lang === "fr" || lang === "en") ? lang : "ar";
    const c = content[l];

    await sendEmail({
        to: email,
        subject: c.subject,
        html: buildEmailHtml({
            greeting: c.greeting,
            body: c.body,
            ctaText: c.cta,
            ctaUrl: "https://9anonai.com/chat",
            footer: c.footer,
            dir: l === "ar" ? "rtl" : "ltr",
        }),
    });
}

// ─── Newsletter welcome email ─────────────────────────────────────────────────

export async function sendWelcomeNewsletterEmail(
    email: string,
    lang: string = "ar"
): Promise<void> {
    const content = {
        ar: {
            subject: "اشتراكك في نشرة 9anon القانونية ✅",
            greeting: "مرحباً،",
            body: `لقد اشتركت بنجاح في النشرة القانونية الأسبوعية من 9anon AI.<br/><br/>
ستصلك كل أسبوع أهم الأخبار القانونية في المغرب، ونصائح حول حقوقك، وتحديثات على القوانين الجديدة.`,
            cta: "اطرح سؤالاً قانونياً الآن",
            footer: "إلغاء الاشتراك في أي وقت عبر الإعدادات.",
        },
        fr: {
            subject: "Votre abonnement à la newsletter 9anon ✅",
            greeting: "Bonjour,",
            body: `Vous êtes maintenant abonné(e) à la newsletter juridique hebdomadaire de 9anon AI.<br/><br/>
Chaque semaine, recevez les dernières actualités juridiques au Maroc, des conseils sur vos droits et les nouvelles lois.`,
            cta: "Poser une question juridique maintenant",
            footer: "Vous pouvez vous désabonner à tout moment.",
        },
        en: {
            subject: "You're subscribed to 9anon legal updates ✅",
            greeting: "Hello,",
            body: `You've successfully subscribed to the 9anon AI weekly legal newsletter.<br/><br/>
Every week you'll receive the latest Moroccan law news, tips on your rights, and updates on new legislation.`,
            cta: "Ask a legal question now",
            footer: "You can unsubscribe at any time.",
        },
    };

    const l = (lang === "fr" || lang === "en") ? lang : "ar";
    const c = content[l];

    await sendEmail({
        to: email,
        subject: c.subject,
        html: buildEmailHtml({
            greeting: c.greeting,
            body: c.body,
            ctaText: c.cta,
            ctaUrl: "https://9anonai.com/chat",
            footer: c.footer,
            dir: l === "ar" ? "rtl" : "ltr",
        }),
    });
}

// ─── Re-engagement email (3 days inactive) ───────────────────────────────────

export async function sendReengagementEmail(
    email: string,
    name?: string | null,
    lang: string = "ar"
): Promise<void> {
    const displayName = name || email.split("@")[0];

    const content = {
        ar: {
            subject: `${displayName}، هل لديك سؤال قانوني؟ 🤔`,
            greeting: `مرحباً ${displayName}،`,
            body: `لاحظنا أنك لم تستخدم 9anon AI منذ بضعة أيام.<br/><br/>
تذكّر أن مساعدك القانوني متاح 24/7 مجاناً للإجابة على أسئلتك حول القانون المغربي — سواء كانت تتعلق بالعمل، الأسرة، العقارات أو أي موضوع آخر.`,
            cta: "العودة إلى 9anon AI",
            footer: "9anon AI — مساعدك القانوني المجاني",
        },
        fr: {
            subject: `${displayName}, une question juridique ? 🤔`,
            greeting: `Bonjour ${displayName},`,
            body: `Vous n'avez pas utilisé 9anon AI depuis quelques jours.<br/><br/>
Rappel : votre assistant juridique est disponible 24h/24, gratuitement, pour répondre à vos questions sur le droit marocain.`,
            cta: "Retourner sur 9anon AI",
            footer: "9anon AI — Votre assistant juridique gratuit",
        },
        en: {
            subject: `${displayName}, got a legal question? 🤔`,
            greeting: `Hello ${displayName},`,
            body: `We noticed you haven't used 9anon AI in a few days.<br/><br/>
Your AI legal assistant is still available 24/7, free of charge, to answer any questions about Moroccan law.`,
            cta: "Return to 9anon AI",
            footer: "9anon AI — Your free Moroccan legal assistant",
        },
    };

    const l = (lang === "fr" || lang === "en") ? lang : "ar";
    const c = content[l];

    await sendEmail({
        to: email,
        subject: c.subject,
        html: buildEmailHtml({
            greeting: c.greeting,
            body: c.body,
            ctaText: c.cta,
            ctaUrl: "https://9anonai.com/chat",
            footer: c.footer,
            dir: l === "ar" ? "rtl" : "ltr",
        }),
    });
}

// ─── HTML builder (inline-CSS, email-safe) ────────────────────────────────────

function buildEmailHtml(opts: {
    greeting: string;
    body: string;
    ctaText: string;
    ctaUrl: string;
    footer: string;
    dir: "rtl" | "ltr";
}): string {
    return `<!DOCTYPE html>
<html lang="ar" dir="${opts.dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>9anon AI</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:#10b981;padding:28px 32px;text-align:center;">
              <span style="color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:-0.5px;">9anon AI</span>
              <br/>
              <span style="color:#d1fae5;font-size:12px;">${opts.dir === "rtl" ? "مساعدك القانوني المغربي" : opts.dir === "ltr" ? "Your Moroccan Legal AI" : "Votre IA Juridique Marocaine"}</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;direction:${opts.dir};text-align:${opts.dir === "rtl" ? "right" : "left"};">
              <p style="font-size:16px;color:#111827;margin:0 0 12px 0;font-weight:600;">${opts.greeting}</p>
              <p style="font-size:15px;color:#374151;line-height:1.7;margin:0 0 28px 0;">${opts.body}</p>
              <div style="text-align:center;margin:0 0 28px 0;">
                <a href="${opts.ctaUrl}" style="display:inline-block;background:#10b981;color:#ffffff;font-size:15px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;">${opts.ctaText}</a>
              </div>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px 0;" />
              <p style="font-size:12px;color:#9ca3af;margin:0;">${opts.footer}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
