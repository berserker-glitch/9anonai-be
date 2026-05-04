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
            subject: "مرحباً بك في 9anon AI — مستشارك القانوني الذكي",
            eyebrow: "أهلاً وسهلاً",
            greeting: `مرحباً ${displayName}`,
            body: `انضممت إلى <strong style="color:#34c985;">9anon AI</strong> — المستشار القانوني الذكي المخصص للقانون المغربي. اطرح أسئلتك القانونية في أي وقت واحصل على إجابات دقيقة حول مدونة الأسرة، قانون الشغل، العقارات، وأكثر.`,
            cta: "ابدأ محادثتك الأولى",
            footer: "إذا لم تقم بإنشاء هذا الحساب، يمكنك تجاهل هذه الرسالة بأمان.",
        },
        fr: {
            subject: "Bienvenue sur 9anon AI — Votre conseiller juridique IA",
            eyebrow: "Bienvenue",
            greeting: `Bonjour ${displayName}`,
            body: `Vous avez rejoint <strong style="color:#34c985;">9anon AI</strong> — le conseiller juridique IA dédié au droit marocain. Posez vos questions juridiques à tout moment et obtenez des réponses précises sur la Moudawana, le Code du Travail, l'immobilier, et bien plus.`,
            cta: "Démarrer votre première conversation",
            footer: "Si vous n'avez pas créé ce compte, vous pouvez ignorer cet e-mail.",
        },
        en: {
            subject: "Welcome to 9anon AI — Your Moroccan Legal Counsel",
            eyebrow: "Welcome aboard",
            greeting: `Hello ${displayName}`,
            body: `You've joined <strong style="color:#34c985;">9anon AI</strong> — the AI legal counsel dedicated to Moroccan law. Ask any legal question anytime and get precise answers on family law, labor law, real estate, and more.`,
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
            greeting: "أهلاً",
            body: `اشتركت بنجاح في النشرة القانونية الأسبوعية من <strong style="color:#34c985;">9anon AI</strong>.<br/>ستصلك كل أسبوع أهم الأخبار القانونية في المغرب، ونصائح حول حقوقك، وتحديثات على القوانين الجديدة.`,
            cta: "اطرح سؤالاً قانونياً الآن",
            footer: "يمكنك إلغاء الاشتراك في أي وقت عبر الإعدادات.",
        },
        fr: {
            subject: "Votre abonnement à la newsletter juridique 9anon ✅",
            eyebrow: "Abonnement confirmé",
            greeting: "Bonjour",
            body: `Vous êtes maintenant abonné(e) à la newsletter juridique hebdomadaire de <strong style="color:#34c985;">9anon AI</strong>.<br/>Chaque semaine, recevez les dernières actualités juridiques au Maroc, des conseils sur vos droits et les nouvelles lois.`,
            cta: "Poser une question juridique",
            footer: "Vous pouvez vous désabonner à tout moment.",
        },
        en: {
            subject: "You're subscribed to 9anon legal updates ✅",
            eyebrow: "Subscription confirmed",
            greeting: "Hello",
            body: `You've successfully subscribed to the <strong style="color:#34c985;">9anon AI</strong> weekly legal newsletter.<br/>Every week you'll receive the latest Moroccan law news, tips on your rights, and updates on new legislation.`,
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
            greeting: `مرحباً ${displayName}`,
            body: `لاحظنا أنك لم تستخدم <strong style="color:#34c985;">9anon AI</strong> منذ بضعة أيام.<br/>مساعدك القانوني لا يزال في انتظارك — متاح مجاناً على مدار الساعة للإجابة على أي سؤال قانوني.`,
            cta: "العودة إلى 9anon AI",
            footer: "9anon AI — مستشارك القانوني المغربي المجاني",
        },
        fr: {
            subject: `${displayName}, une question juridique ?`,
            eyebrow: "Vous nous manquez",
            greeting: `Bonjour ${displayName}`,
            body: `Vous n'avez pas utilisé <strong style="color:#34c985;">9anon AI</strong> depuis quelques jours.<br/>Votre assistant juridique est toujours disponible gratuitement, 24h/24, pour répondre à toutes vos questions.`,
            cta: "Retourner sur 9anon AI",
            footer: "9anon AI — Votre assistant juridique gratuit",
        },
        en: {
            subject: `${displayName}, got a legal question?`,
            eyebrow: "We miss you",
            greeting: `Hello ${displayName}`,
            body: `We noticed you haven't used <strong style="color:#34c985;">9anon AI</strong> in a few days.<br/>Your AI legal assistant is still available 24/7, free of charge, ready for any question about Moroccan law.`,
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

// ─── HTML builder — dark-mode, matches website design system ─────────────────

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

    // Website palette (light mode) — mirrors globals.css :root variables
    const C = {
        outerBg:    "#ece8e0",   // warm parchment outer wrapper
        cardBg:     "#ffffff",   // pure white card
        headerBg:   "#f7f5f0",   // warm off-white header
        tileBg:     "#f5f2ec",   // feature tile background
        border:     "#e2ddd5",   // warm light border
        emerald:    "#1f7a56",   // primary — website oklch(0.45 0.14 160)
        emeraldDim: "#cdeee0",   // light emerald tint for tile top border
        gold:       "#c9a040",   // gold accent — website oklch(0.72 0.14 85)
        textPrimary:"#1a2920",   // dark green-black foreground
        textSecond: "#5a7268",   // muted foreground
        textMuted:  "#8fa99a",   // very muted
    };

    const features = {
        ar: [
            { icon: "⚖️", label: "قانون مغربي شامل", sub: "مدونة الأسرة، الشغل، العقار" },
            { icon: "🔒", label: "سري وآمن",         sub: "بياناتك محمية دائماً" },
            { icon: "⚡", label: "متاح 24/7",        sub: "أجب في أي وقت، مجاناً" },
        ],
        fr: [
            { icon: "⚖️", label: "Droit marocain complet", sub: "Moudawana, travail, immobilier" },
            { icon: "🔒", label: "Confidentiel",            sub: "Vos données sont protégées" },
            { icon: "⚡", label: "24h/24 · Gratuit",        sub: "Disponible à tout moment" },
        ],
        en: [
            { icon: "⚖️", label: "Full Moroccan law",  sub: "Family, labor, real estate" },
            { icon: "🔒", label: "Private & secure",   sub: "Your data stays protected" },
            { icon: "⚡", label: "24/7 · Free",        sub: "Available whenever you need" },
        ],
    };

    const tagline = {
        ar: "المستشار القانوني الذكي",
        fr: "Le Conseiller Juridique IA",
        en: "AI Legal Counsel",
    };

    const featureTiles = features[lang].map(f => `
      <td width="33%" style="padding:0 5px;vertical-align:top;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="
              background-color:${C.tileBg};
              border:1px solid ${C.border};
              border-top:2px solid ${C.emeraldDim};
              border-radius:10px;
              padding:18px 14px 16px;
              text-align:center;
            ">
              <div style="font-size:22px;margin-bottom:10px;">${f.icon}</div>
              <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:${C.textPrimary};letter-spacing:-0.2px;font-family:Georgia,'Times New Roman',serif;">${f.label}</p>
              <p style="margin:0;font-size:11px;color:${C.textSecond};line-height:1.4;font-family:Arial,Helvetica,sans-serif;">${f.sub}</p>
            </td>
          </tr>
        </table>
      </td>`).join("");

    // Zellige pattern — mirrors website's .bg-zellige translated to email-safe repeating-linear-gradient
    const zelligeBg = `background-color:${C.outerBg};background-image:linear-gradient(30deg,${C.emeraldDim}22 12%,transparent 12.5%,transparent 87%,${C.emeraldDim}22 87.5%),linear-gradient(150deg,${C.emeraldDim}22 12%,transparent 12.5%,transparent 87%,${C.emeraldDim}22 87.5%),linear-gradient(30deg,${C.emeraldDim}22 12%,transparent 12.5%,transparent 87%,${C.emeraldDim}22 87.5%),linear-gradient(150deg,${C.emeraldDim}22 12%,transparent 12.5%,transparent 87%,${C.emeraldDim}22 87.5%),linear-gradient(60deg,${C.emeraldDim}14 25%,transparent 25.5%,transparent 75%,${C.emeraldDim}14 75%),linear-gradient(60deg,${C.emeraldDim}14 25%,transparent 25.5%,transparent 75%,${C.emeraldDim}14 75%);background-size:40px 70px;background-position:0 0,0 0,20px 35px,20px 35px,0 0,20px 35px;`;

    return `<!DOCTYPE html>
<html lang="${htmlLang}" dir="${dir}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>9anon AI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />
  <style>
    @media only screen and (max-width:620px){
      .email-card{width:100%!important;}
      .feature-col{display:block!important;width:100%!important;padding:0 0 8px!important;}
      .feature-cell{margin-bottom:8px!important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;${zelligeBg}font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">

  <!-- Preview text -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:${C.outerBg};">${opts.eyebrow} — 9anon AI&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${zelligeBg}padding:48px 16px;">
    <tr>
      <td align="center">
        <table class="email-card" role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:16px;overflow:hidden;border:1px solid ${C.border};">

          <!-- ── Emerald top bar ── -->
          <tr>
            <td style="height:4px;background:linear-gradient(90deg,${C.emerald},#22a06b,${C.emerald});font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- ── Header ── -->
          <tr>
            <td style="background-color:${C.headerBg};padding:36px 44px 32px;text-align:center;border-bottom:1px solid ${C.border};">

              <!-- Logo badge -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 16px;">
                <tr>
                  <td style="
                    background-color:${C.emerald};
                    border-radius:12px;
                    width:48px;height:48px;
                    text-align:center;vertical-align:middle;
                  ">
                    <span style="color:#ffffff;font-size:24px;font-weight:900;font-family:'Courier New',Courier,monospace;line-height:48px;display:block;letter-spacing:-1px;">9</span>
                  </td>
                </tr>
              </table>

              <!-- Wordmark -->
              <p style="margin:0 0 5px;color:${C.textPrimary};font-size:22px;font-weight:700;letter-spacing:-0.5px;font-family:'Playfair Display',Georgia,serif;">9anon AI</p>

              <!-- Tagline -->
              <p style="margin:0;color:${C.textSecond};font-size:11px;letter-spacing:2px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">${tagline[lang]}</p>

            </td>
          </tr>

          <!-- ── Body ── -->
          <tr>
            <td style="background-color:${C.cardBg};padding:40px 44px 36px;direction:${dir};text-align:${align};">

              <!-- Eyebrow -->
              <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:${C.emerald};letter-spacing:2px;text-transform:uppercase;font-family:Arial,Helvetica,sans-serif;">${opts.eyebrow}</p>

              <!-- Greeting -->
              <p style="margin:0 0 6px;font-size:28px;font-weight:700;color:${C.textPrimary};line-height:1.25;letter-spacing:-0.5px;font-family:'Playfair Display',Georgia,serif;">${opts.greeting}</p>

              <!-- Gold rule -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
                <tr>
                  <td style="height:1px;font-size:0;line-height:0;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:40px;height:2px;background-color:${C.gold};font-size:0;">&nbsp;</td>
                        <td style="width:400px;height:1px;background-color:${C.border};font-size:0;">&nbsp;</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Body text -->
              <p style="margin:0 0 32px;font-size:15px;color:${C.textSecond};line-height:1.8;font-family:Arial,Helvetica,sans-serif;">${opts.body}</p>

              <!-- Feature tiles -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:36px;">
                <tr>${featureTiles}</tr>
              </table>

              <!-- CTA button — emerald on dark, matches website primary button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="border-radius:10px;background-color:${C.emerald};">
                    <a href="${opts.ctaUrl}" target="_blank"
                       style="
                         display:inline-block;
                         background-color:${C.emerald};
                         color:#ffffff;
                         font-size:14px;
                         font-weight:700;
                         padding:15px 44px;
                         border-radius:10px;
                         text-decoration:none;
                         letter-spacing:-0.2px;
                         font-family:Arial,Helvetica,sans-serif;
                       "
                    >${opts.ctaText} &rarr;</a>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- ── Footer ── -->
          <tr>
            <td style="background-color:${C.headerBg};border-top:1px solid ${C.border};padding:22px 44px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:${C.textMuted};line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${opts.footer}</p>
              <p style="margin:0;font-size:11px;font-family:Arial,Helvetica,sans-serif;">
                <a href="https://9anonai.com" target="_blank" style="color:${C.emerald};text-decoration:none;font-weight:600;">9anonai.com</a>
                <span style="color:${C.textMuted};">&nbsp;&middot;&nbsp;${tagline[lang]}</span>
              </p>
            </td>
          </tr>

          <!-- ── Bottom emerald bar ── -->
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,${C.emeraldDim},${C.emerald},${C.emeraldDim});font-size:0;line-height:0;">&nbsp;</td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
