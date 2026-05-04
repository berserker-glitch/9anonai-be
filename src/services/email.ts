/**
 * @fileoverview Email service for 9anon using Resend.
 * Handles transactional emails: welcome, newsletter, re-engagement.
 *
 * Setup:
 *   1. npm install resend   (in BE/)
 *   2. Set RESEND_API_KEY in .env
 *   3. Set EMAIL_FROM in .env  (e.g. "9anon AI <contact@contact.9anonai.com>")
 *
 * @module services/email
 */

import { Resend } from "resend";
import { logger } from "./logger";

const FROM = process.env.EMAIL_FROM || "9anon AI <contact@contact.9anonai.com>";

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
    const l = (lang === "fr" || lang === "en") ? lang : "ar";

    const content = {
        ar: {
            subject: "مرحباً بك في 9anon AI — مساعدك القانوني الذكي",
            eyebrow: "أهلاً وسهلاً",
            greeting: `مرحباً ${displayName}،`,
            body: `انضممت إلى <strong style="color:#0d1117;">9anon AI</strong> — المستشار القانوني الذكي المخصص للقانون المغربي. يمكنك الآن طرح أسئلتك القانونية في أي وقت والحصول على إجابات دقيقة حول مدونة الأسرة، قانون الشغل، العقارات، وأكثر.`,
            cta: "ابدأ محادثتك الأولى",
            footer: "إذا لم تقم بإنشاء هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.",
        },
        fr: {
            subject: "Bienvenue sur 9anon AI — Votre conseiller juridique IA",
            eyebrow: "Bienvenue",
            greeting: `Bonjour ${displayName},`,
            body: `Vous avez rejoint <strong style="color:#0d1117;">9anon AI</strong> — le conseiller juridique IA dédié au droit marocain. Posez vos questions juridiques à tout moment et obtenez des réponses précises sur la Moudawana, le Code du Travail, l'immobilier, et bien plus.`,
            cta: "Démarrer votre première conversation",
            footer: "Si vous n'avez pas créé ce compte, vous pouvez ignorer cet e-mail.",
        },
        en: {
            subject: "Welcome to 9anon AI — Your Moroccan Legal Counsel",
            eyebrow: "Welcome aboard",
            greeting: `Hello ${displayName},`,
            body: `You've joined <strong style="color:#0d1117;">9anon AI</strong> — the AI legal counsel dedicated to Moroccan law. Ask any legal question anytime and get precise answers on family law, labor law, real estate, and more.`,
            cta: "Start your first conversation",
            footer: "If you didn't create this account, you can safely ignore this email.",
        },
    };

    const c = content[l];

    await sendEmail({
        to: email,
        subject: c.subject,
        html: buildEmailHtml({
            eyebrow: c.eyebrow,
            greeting: c.greeting,
            body: c.body,
            ctaText: c.cta,
            ctaUrl: "https://9anonai.com/chat",
            footer: c.footer,
            dir: l === "ar" ? "rtl" : "ltr",
            lang: l,
        }),
    });
}

// ─── Newsletter welcome email ─────────────────────────────────────────────────

export async function sendWelcomeNewsletterEmail(
    email: string,
    lang: string = "ar"
): Promise<void> {
    const l = (lang === "fr" || lang === "en") ? lang : "ar";

    const content = {
        ar: {
            subject: "اشتراكك في النشرة القانونية لـ 9anon ✅",
            eyebrow: "تم الاشتراك",
            greeting: "مرحباً،",
            body: `اشتركت بنجاح في النشرة القانونية الأسبوعية من <strong style="color:#0d1117;">9anon AI</strong>.<br/><br/>ستصلك كل أسبوع أهم الأخبار القانونية في المغرب، ونصائح حول حقوقك، وتحديثات على القوانين الجديدة.`,
            cta: "اطرح سؤالاً قانونياً الآن",
            footer: "يمكنك إلغاء الاشتراك في أي وقت عبر الإعدادات.",
        },
        fr: {
            subject: "Votre abonnement à la newsletter juridique 9anon ✅",
            eyebrow: "Abonnement confirmé",
            greeting: "Bonjour,",
            body: `Vous êtes maintenant abonné(e) à la newsletter juridique hebdomadaire de <strong style="color:#0d1117;">9anon AI</strong>.<br/><br/>Chaque semaine, recevez les dernières actualités juridiques au Maroc, des conseils sur vos droits et les nouvelles lois.`,
            cta: "Poser une question juridique",
            footer: "Vous pouvez vous désabonner à tout moment.",
        },
        en: {
            subject: "You're subscribed to 9anon legal updates ✅",
            eyebrow: "Subscription confirmed",
            greeting: "Hello,",
            body: `You've successfully subscribed to the <strong style="color:#0d1117;">9anon AI</strong> weekly legal newsletter.<br/><br/>Every week you'll receive the latest Moroccan law news, tips on your rights, and updates on new legislation.`,
            cta: "Ask a legal question now",
            footer: "You can unsubscribe at any time.",
        },
    };

    const c = content[l];

    await sendEmail({
        to: email,
        subject: c.subject,
        html: buildEmailHtml({
            eyebrow: c.eyebrow,
            greeting: c.greeting,
            body: c.body,
            ctaText: c.cta,
            ctaUrl: "https://9anonai.com/chat",
            footer: c.footer,
            dir: l === "ar" ? "rtl" : "ltr",
            lang: l,
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
    const l = (lang === "fr" || lang === "en") ? lang : "ar";

    const content = {
        ar: {
            subject: `${displayName}، هل لديك سؤال قانوني؟`,
            eyebrow: "نفتقدك",
            greeting: `مرحباً ${displayName}،`,
            body: `لاحظنا أنك لم تستخدم <strong style="color:#0d1117;">9anon AI</strong> منذ بضعة أيام.<br/><br/>مساعدك القانوني لا يزال في انتظارك — متاح مجاناً على مدار الساعة للإجابة على أسئلتك حول القانون المغربي.`,
            cta: "العودة إلى 9anon AI",
            footer: "9anon AI — مساعدك القانوني المجاني",
        },
        fr: {
            subject: `${displayName}, une question juridique ?`,
            eyebrow: "Vous nous manquez",
            greeting: `Bonjour ${displayName},`,
            body: `Vous n'avez pas utilisé <strong style="color:#0d1117;">9anon AI</strong> depuis quelques jours.<br/><br/>Votre assistant juridique est toujours disponible gratuitement, 24h/24, pour répondre à vos questions sur le droit marocain.`,
            cta: "Retourner sur 9anon AI",
            footer: "9anon AI — Votre assistant juridique gratuit",
        },
        en: {
            subject: `${displayName}, got a legal question?`,
            eyebrow: "We miss you",
            greeting: `Hello ${displayName},`,
            body: `We noticed you haven't used <strong style="color:#0d1117;">9anon AI</strong> in a few days.<br/><br/>Your AI legal assistant is still available 24/7, free of charge, for any questions about Moroccan law.`,
            cta: "Return to 9anon AI",
            footer: "9anon AI — Your free Moroccan legal assistant",
        },
    };

    const c = content[l];

    await sendEmail({
        to: email,
        subject: c.subject,
        html: buildEmailHtml({
            eyebrow: c.eyebrow,
            greeting: c.greeting,
            body: c.body,
            ctaText: c.cta,
            ctaUrl: "https://9anonai.com/chat",
            footer: c.footer,
            dir: l === "ar" ? "rtl" : "ltr",
            lang: l,
        }),
    });
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildEmailHtml(opts: {
    eyebrow: string;
    greeting: string;
    body: string;
    ctaText: string;
    ctaUrl: string;
    footer: string;
    dir: "rtl" | "ltr";
    lang: "ar" | "fr" | "en";
}): string {
    const { dir, lang } = opts;
    const align = dir === "rtl" ? "right" : "left";
    const htmlLang = lang === "ar" ? "ar" : lang === "fr" ? "fr" : "en";

    const features = {
        ar: [
            { icon: "⚖️", label: "قانون مغربي شامل" },
            { icon: "🔒", label: "سري وآمن تماماً" },
            { icon: "⚡", label: "متاح 24 / 7" },
        ],
        fr: [
            { icon: "⚖️", label: "Droit marocain complet" },
            { icon: "🔒", label: "Confidentiel & sécurisé" },
            { icon: "⚡", label: "Disponible 24h/24" },
        ],
        en: [
            { icon: "⚖️", label: "Full Moroccan law coverage" },
            { icon: "🔒", label: "Private & secure" },
            { icon: "⚡", label: "Available 24/7" },
        ],
    };

    const tagline = {
        ar: "المستشار القانوني الذكي",
        fr: "Le Conseiller Juridique IA",
        en: "AI Legal Counsel",
    };

    const footerBrand = {
        ar: "المستشار القانوني المغربي الذكي",
        fr: "Le conseiller juridique marocain IA",
        en: "Your Moroccan AI Legal Counsel",
    };

    const featureCols = features[lang].map(f => `
        <td width="33%" style="padding:0 5px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background-color:#f8f6f1;border:1px solid #e8e3d8;border-radius:10px;padding:18px 12px;text-align:center;">
                <div style="font-size:24px;line-height:1;margin-bottom:10px;">${f.icon}</div>
                <p style="margin:0;font-size:12px;font-weight:600;color:#374151;line-height:1.4;font-family:Georgia,'Times New Roman',serif;">${f.label}</p>
              </td>
            </tr>
          </table>
        </td>`).join("");

    return `<!DOCTYPE html>
<html lang="${htmlLang}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>9anon AI</title>
  <!--[if mso]>
  <noscript>
    <xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
  </noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#ede9e1;font-family:Georgia,'Times New Roman',serif;-webkit-text-size-adjust:100%;mso-line-height-rule:exactly;">

  <!-- Preview text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#ede9e1;">${opts.eyebrow} — 9anon AI&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ede9e1;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- ═══ Moroccan geometric accent strip ═══ -->
          <tr>
            <td style="border-radius:14px 14px 0 0;overflow:hidden;height:8px;background-color:#0d1117;background-image:repeating-linear-gradient(45deg,#10b981 0,#10b981 1px,transparent 0,transparent 50%),repeating-linear-gradient(-45deg,#10b981 0,#10b981 1px,transparent 0,transparent 50%);background-size:10px 10px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- ═══ Dark header ═══ -->
          <tr>
            <td style="background-color:#0d1117;padding:40px 44px 36px;text-align:center;">

              <!-- Logo badge -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 20px;">
                <tr>
                  <td style="background-color:#10b981;border-radius:12px;width:52px;height:52px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:26px;font-weight:900;font-family:'Courier New',Courier,monospace;line-height:52px;display:block;">9</span>
                  </td>
                </tr>
              </table>

              <!-- Wordmark -->
              <p style="margin:0 0 6px;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;font-family:'Courier New',Courier,monospace;">9anon AI</p>
              <p style="margin:0;color:#6ee7b7;font-size:12px;letter-spacing:2px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">${tagline[lang]}</p>

              <!-- Gold rule -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 0;">
                <tr>
                  <td style="width:20px;height:2px;background-color:#0d1117;font-size:0;line-height:0;">&nbsp;</td>
                  <td style="width:60px;height:2px;background-color:#c9a84c;font-size:0;line-height:0;">&nbsp;</td>
                  <td style="width:20px;height:2px;background-color:#0d1117;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ═══ Body ═══ -->
          <tr>
            <td style="background-color:#ffffff;padding:44px 44px 36px;direction:${dir};text-align:${align};">

              <!-- Eyebrow label -->
              <p style="margin:0 0 10px;font-size:11px;color:#10b981;letter-spacing:2px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">${opts.eyebrow}</p>

              <!-- Greeting -->
              <p style="margin:0 0 20px;font-size:24px;font-weight:700;color:#0d1117;line-height:1.3;font-family:Georgia,'Times New Roman',serif;">${opts.greeting}</p>

              <!-- Divider hairline -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td style="height:1px;background-color:#f0ece4;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>

              <!-- Body text -->
              <p style="margin:0 0 32px;font-size:15px;color:#4b5563;line-height:1.85;font-family:Georgia,'Times New Roman',serif;">${opts.body}</p>

              <!-- Feature tiles -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                <tr>${featureCols}</tr>
              </table>

              <!-- CTA button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="border-radius:9px;background-color:#0d1117;text-align:center;">
                    <a href="${opts.ctaUrl}" target="_blank" style="display:inline-block;background-color:#0d1117;color:#ffffff;font-size:14px;font-weight:600;padding:16px 44px;border-radius:9px;text-decoration:none;letter-spacing:0.5px;font-family:Arial,Helvetica,sans-serif;">${opts.ctaText} &rarr;</a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ═══ Footer ═══ -->
          <tr>
            <td style="background-color:#f5f1ea;border-top:1px solid #e8e3d8;border-radius:0 0 14px 14px;padding:24px 44px;text-align:center;">
              <p style="margin:0 0 8px;font-size:12px;color:#9ca3af;line-height:1.7;font-family:Arial,Helvetica,sans-serif;">${opts.footer}</p>
              <p style="margin:0;font-size:12px;color:#c9a84c;font-family:'Courier New',Courier,monospace;font-weight:600;letter-spacing:0.5px;">
                <a href="https://9anonai.com" target="_blank" style="color:#c9a84c;text-decoration:none;">9anonai.com</a>
                &nbsp;·&nbsp;
                <span style="color:#9ca3af;font-family:Arial,sans-serif;font-weight:400;">${footerBrand[lang]}</span>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
