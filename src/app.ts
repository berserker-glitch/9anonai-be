import express from "express";
import cors from "cors";
import path from "path";
import chatRouter from "./routes/chat";
import authRouter from "./routes/auth";
import chatsRouter from "./routes/chats";
import uploadRouter from "./routes/upload";
import adminRouter from "./routes/admin";
import { config } from "./config";

const app = express();
const PORT = process.env.PORT || 4000;

// Parse CORS origins from environment variable (comma-separated) or use defaults for development
const corsOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map(s => s.trim())
    : ["http://localhost:3000", "http://127.0.0.1:3000"];

// Middleware
app.use(cors({
    origin: corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Static file serving for uploads
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// Routes
app.use("/api/chat", chatRouter);      // SSE streaming chat
app.use("/api/auth", authRouter);      // Auth (register, login)
app.use("/api/chats", chatsRouter);    // Chat persistence (CRUD)
app.use("/api/upload", uploadRouter);  // File uploads
app.use("/api/admin", adminRouter);    // Admin dashboard

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

export default app;
