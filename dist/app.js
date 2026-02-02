"use strict";
/**
 * @fileoverview Main Express application entry point for 9anon Legal AI Backend.
 * Configures middleware, routes, and server initialization.
 * @module app
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
// Routes
const chat_1 = __importDefault(require("./routes/chat"));
const auth_1 = __importDefault(require("./routes/auth"));
const chats_1 = __importDefault(require("./routes/chats"));
const upload_1 = __importDefault(require("./routes/upload"));
const admin_1 = __importDefault(require("./routes/admin"));
const pdf_1 = __importDefault(require("./routes/pdf"));
// Middleware
const middleware_1 = require("./middleware");
const logger_1 = require("./services/logger");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
// ─────────────────────────────────────────────────────────────────────────────
// CORS Configuration
// Parse CORS origins from environment variable (comma-separated) or use defaults
// ─────────────────────────────────────────────────────────────────────────────
const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map(s => s.trim())
    : ["http://localhost:3000", "http://127.0.0.1:3000"];
app.use((0, cors_1.default)({
    origin: corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
// ─────────────────────────────────────────────────────────────────────────────
// Body Parsing Middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use(express_1.default.json({ limit: "50mb" }));
app.use(express_1.default.urlencoded({ limit: "50mb", extended: true }));
// ─────────────────────────────────────────────────────────────────────────────
// Request Logging Middleware (Winston-based)
// ─────────────────────────────────────────────────────────────────────────────
app.use(middleware_1.requestLogger);
// ─────────────────────────────────────────────────────────────────────────────
// Static File Serving
// ─────────────────────────────────────────────────────────────────────────────
app.use("/uploads", express_1.default.static(path_1.default.join(__dirname, "../uploads")));
// ─────────────────────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────────────────────
app.use("/api/chat", chat_1.default); // SSE streaming chat
app.use("/api/auth", auth_1.default); // Auth (register, login)
app.use("/api/chats", chats_1.default); // Chat persistence (CRUD)
app.use("/api/upload", upload_1.default); // File uploads
app.use("/api/admin", admin_1.default); // Admin dashboard
app.use("/api/pdf", pdf_1.default); // PDF contract generation
// ─────────────────────────────────────────────────────────────────────────────
// Health Check Endpoint
// ─────────────────────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
    res.json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.env.npm_package_version || "1.0.0",
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// Error Handling Middleware (must be after routes)
// ─────────────────────────────────────────────────────────────────────────────
app.use(middleware_1.notFoundHandler);
app.use(middleware_1.errorHandler);
// ─────────────────────────────────────────────────────────────────────────────
// Server Initialization
// ─────────────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
    logger_1.logger.info(`
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
const gracefulShutdown = (signal) => {
    logger_1.logger.info(`${signal} received. Starting graceful shutdown...`);
    server.close((err) => {
        if (err) {
            logger_1.logger.error('Error during server shutdown:', { error: err });
            process.exit(1);
        }
        logger_1.logger.info('Server closed successfully');
        process.exit(0);
    });
    // Force shutdown after 30 seconds if graceful shutdown fails
    setTimeout(() => {
        logger_1.logger.error('Forced shutdown due to timeout');
        process.exit(1);
    }, 30000);
};
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
    logger_1.logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    logger_1.logger.error('Unhandled Rejection:', { reason, promise });
});
exports.default = app;
