import fetch from "node-fetch";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

async function main() {
    console.log("🎨 Generating test image...");

    const imagePrompt = [
        "Create a single, photorealistic editorial photograph for a legal blog article.",
        "ARTICLE TITLE: \"Labor Rights and Remote Work in Morocco\"",
        "SCENE DIRECTION: A modern office setting mixed with a home office vibe in Casablanca. A professional looking at a laptop with legal documents spread out.",
        "CAMERA: Full-frame 35mm, 35-85mm focal length. Shallow depth of field (f/1.8–f/2.8).",
        "LIGHTING: Natural motivated light — window light. Warm cinematic tones.",
        "ASPECT RATIO: Exactly 1200x630 pixels.",
        "PEOPLE: North African / Moroccan appearance in modern clothing.",
        "ABSOLUTE RESTRICTIONS: ZERO text, words, watermarks, logos."
    ].join("\n");

    try {
        const rawResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
                "HTTP-Referer": "https://github.com/moroccan-legal-ai",
                "X-Title": "9anon - Test Image",
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
        const messageObj = responseJson?.choices?.[0]?.message;

        console.log(`Response received... processing image.`);

        let imageBuffer: Buffer | null = null;

        if (messageObj?.images && Array.isArray(messageObj.images) && messageObj.images.length > 0) {
            const imageDataUrl = messageObj.images[0]?.image_url?.url;
            if (imageDataUrl) {
                const dataMatch = imageDataUrl.match(/^data:image\/[^;]+;base64,(.+)/s);
                if (dataMatch) {
                    imageBuffer = Buffer.from(dataMatch[1], "base64");
                } else if (imageDataUrl.startsWith("http")) {
                    const dlRes = await fetch(imageDataUrl);
                    imageBuffer = Buffer.from(await dlRes.arrayBuffer());
                }
            }
        }

        if (!imageBuffer && Array.isArray(messageObj?.content)) {
            for (const part of messageObj.content) {
                if (part.type === "image_url" && part.image_url?.url) {
                    const dataMatch = part.image_url.url.match(/^data:image\/[^;]+;base64,(.+)/s);
                    if (dataMatch) {
                        imageBuffer = Buffer.from(dataMatch[1], "base64");
                        break;
                    }
                    const dlRes = await fetch(part.image_url.url);
                    imageBuffer = Buffer.from(await dlRes.arrayBuffer());
                    break;
                }
            }
        }

        if (imageBuffer) {
            const logoPath = path.resolve(__dirname, "..", "..", "FE", "public", "Layer 3.png");

            console.log("Resizing and compositing...");
            const resizedImage = await sharp(imageBuffer)
                .resize(1200, 630, { fit: "cover", position: "center" })
                .toBuffer();

            const logoSize = Math.round(1200 * 0.06); // 6% of 1200px width
            const padding = 20;

            const resizedLogo = await sharp(logoPath)
                .resize(logoSize)
                .ensureAlpha()
                .linear(0.4, 0)
                .toBuffer();

            const logoMeta = await sharp(resizedLogo).metadata();
            const logoHeight = logoMeta.height || logoSize;

            const outPath = path.join(__dirname, "..", "test-image-output.webp");

            await sharp(resizedImage)
                .composite([{
                    input: resizedLogo,
                    left: padding,
                    top: 630 - logoHeight - padding,
                }])
                .webp({ quality: 85 })
                .toFile(outPath);

            console.log(`✅ Test image saved successfully to: ${outPath}`);
            console.log(`Open this file to see how the image and logo look!`);
        } else {
            console.log("Failed to extract image buffer from response:", JSON.stringify(messageObj).slice(0, 500));
        }

    } catch (e) {
        console.error("Error generating test image:", e);
    }
}

main();
