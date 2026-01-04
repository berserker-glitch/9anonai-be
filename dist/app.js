"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const chat_1 = __importDefault(require("./routes/chat"));
const auth_1 = __importDefault(require("./routes/auth"));
const chats_1 = __importDefault(require("./routes/chats"));
const upload_1 = __importDefault(require("./routes/upload"));
const admin_1 = __importDefault(require("./routes/admin"));
const pdf_1 = __importDefault(require("./routes/pdf"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 4000;
// Parse CORS origins from environment variable (comma-separated) or use defaults for development
const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map(s => s.trim())
    : ["http://localhost:3000", "http://127.0.0.1:3000"];
// Middleware
app.use((0, cors_1.default)({
    origin: corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express_1.default.json({ limit: "50mb" }));
app.use(express_1.default.urlencoded({ limit: "50mb", extended: true }));
// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.method === 'PATCH' || req.method === 'POST' || req.method === 'PUT') {
        console.log('  Body:', JSON.stringify(req.body).substring(0, 200));
    }
    next();
});
// Static file serving for uploads
app.use("/uploads", express_1.default.static(path_1.default.join(__dirname, "../uploads")));
// Routes
app.use("/api/chat", chat_1.default); // SSE streaming chat
app.use("/api/auth", auth_1.default); // Auth (register, login)
app.use("/api/chats", chats_1.default); // Chat persistence (CRUD)
app.use("/api/upload", upload_1.default); // File uploads
app.use("/api/admin", admin_1.default); // Admin dashboard
app.use("/api/pdf", pdf_1.default); // PDF contract generation
// Health Check
app.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
});
// Start Server
app.listen(PORT, () => {
    console.log(`
    🚀 Moroccan Legal AI Backend is running!
    📡 Server: http://localhost:${PORT}
    📚 API:    http://localhost:${PORT}/api/chat
    🔐 Auth:   http://localhost:${PORT}/api/auth
    💾 Chats:  http://localhost:${PORT}/api/chats
    📎 Upload: http://localhost:${PORT}/api/upload
    `);
});
exports.default = app;
