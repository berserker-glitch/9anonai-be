/**
 * @fileoverview Main Express application entry point for 9anon Legal AI Backend.
 * Configures middleware, routes, and server initialization.
 * @module app
 */

import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";

// Routes
import chatRouter from "./routes/chat";
import authRouter from "./routes/auth";
import chatsRouter from "./routes/chats";
import uploadRouter from "./routes/upload";
import adminRouter from "./routes/admin";
import adminAnalyticsRouter from "./routes/admin-analytics";
import pdfRouter from "./routes/pdf";
import contractBuilderRouter from "./routes/contract-builder";
import newsletterRouter from "./routes/newsletter";
import billingRouter from "./routes/billing";

// Middleware
import { requestLogger, errorHandler, notFoundHandler } from "./middleware";
import { logger } from "./services/logger";
import { initEmailScheduler } from "./services/email-scheduler";

// Configuration
import { config } from "./config";

const app = express();
const PORT = process.env.PORT || 4000;

// ─────────────────────────────────────────────────────────────────────────────
// CORS Configuration
// Parse CORS origins from environment variable (comma-separated) or use defaults
// ─────────────────────────────────────────────────────────────────────────────
const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map(s => s.trim())
    : ["http://localhost:3000", "http://127.0.0.1:3000"];

app.use(cors({
    origin: corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));

// ─────────────────────────────────────────────────────────────────────────────
// Security Headers (Helmet)
// ─────────────────────────────────────────────────────────────────────────────
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'", ...corsOrigins],
        },
    },
    crossOriginEmbedderPolicy: false, // Allow embedding fonts/images from CDN
}));

// ─────────────────────────────────────────────────────────────────────────────
// Paddle Webhook — raw body capture (MUST be before express.json())
// The webhook route needs the raw Buffer for HMAC signature verification.
// ─────────────────────────────────────────────────────────────────────────────
app.use("/api/billing/webhook", express.raw({ type: "application/json" }), (req, _res, next) => {
    (req as any).rawBody = req.body;
    next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Body Parsing Middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ limit: "2mb", extended: true }));

// ─────────────────────────────────────────────────────────────────────────────
// Request Logging Middleware (Winston-based)
// ─────────────────────────────────────────────────────────────────────────────
app.use(requestLogger);

// ─────────────────────────────────────────────────────────────────────────────
// Static File Serving
// ─────────────────────────────────────────────────────────────────────────────
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ─────────────────────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────────────────────
app.use("/api/chat", chatRouter);      // SSE streaming chat
app.use("/api/auth", authRouter);      // Auth (register, login)
app.use("/api/chats", chatsRouter);    // Chat persistence (CRUD)
app.use("/api/upload", uploadRouter);  // File uploads
app.use("/api/admin", adminRouter);    // Admin dashboard
app.use("/api/admin/analytics", adminAnalyticsRouter); // Admin analytics
app.use("/api/pdf", pdfRouter);        // PDF contract generation
app.use("/api/contract-builder", contractBuilderRouter); // Contract Builder
app.use("/api/newsletter", newsletterRouter);           // Newsletter subscriptions
app.use("/api/billing", billingRouter);                // Billing & subscriptions (Paddle)

// ─────────────────────────────────────────────────────────────────────────────
// Health Check Endpoint
// ─────────────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error Handling Middleware (must be after routes)
// ─────────────────────────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────────────
// Server Initialization
// ─────────────────────────────────────────────────────────────────────────────
// Initialize email scheduler (re-engagement cron jobs)
initEmailScheduler();

const server = app.listen(PORT, () => {
    logger.info(`
    🚀 9anon Legal AI Backend is running!
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    📡 Server: http://localhost:${PORT}
    📚 API:    http://localhost:${PORT}/api/chat
    🔐 Auth:   http://localhost:${PORT}/api/auth
    💾 Chats:  http://localhost:${PORT}/api/chats
    📎 Upload: http://localhost:${PORT}/api/upload
    🏥 Health: http://localhost:${PORT}/health
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
});

// ─────────────────────────────────────────────────────────────────────────────
// Graceful Shutdown Handler
// ─────────────────────────────────────────────────────────────────────────────
const gracefulShutdown = (signal: string) => {
    logger.info(`${signal} received. Starting graceful shutdown...`);

    server.close((err) => {
        if (err) {
            logger.error('Error during server shutdown:', { error: err });
            process.exit(1);
        }

        logger.info('Server closed successfully');
        process.exit(0);
    });

    // Force shutdown after 30 seconds if graceful shutdown fails
    setTimeout(() => {
        logger.error('Forced shutdown due to timeout');
        process.exit(1);
    }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', { reason, promise });
});

export default app;
