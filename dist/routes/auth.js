"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../services/prisma");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error("JWT_SECRET environment variable is required");
}
// Validation Schemas
const RegisterSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string().min(6),
    name: zod_1.z.string().optional(),
});
const LoginSchema = zod_1.z.object({
    email: zod_1.z.string().email(),
    password: zod_1.z.string(),
});
// POST /api/auth/register
router.post("/register", async (req, res) => {
    try {
        const { email, password, name } = RegisterSchema.parse(req.body);
        // Check if user exists
        const existingUser = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ error: "User already exists" });
        }
        // Hash password
        const hashedPassword = await bcryptjs_1.default.hash(password, 10);
        // Create user
        const user = await prisma_1.prisma.user.create({
            data: { email, password: hashedPassword, name },
        });
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
        res.status(201).json({
            message: "User created successfully",
            token,
            user: { id: user.id, email: user.email, name: user.name, role: user.role, isOnboarded: user.isOnboarded }
        });
    }
    catch (error) {
        console.error("Register error:", error);
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        res.status(500).json({ error: "Internal server error" });
    }
});
// POST /api/auth/login
router.post("/login", async (req, res) => {
    try {
        const { email, password } = LoginSchema.parse(req.body);
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        const passwordMatch = await bcryptjs_1.default.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        // Generate JWT
        const token = jsonwebtoken_1.default.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
        res.json({
            token,
            user: { id: user.id, email: user.email, name: user.name, role: user.role, isOnboarded: user.isOnboarded }
        });
    }
    catch (error) {
        console.error("Login error:", error);
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        res.status(500).json({ error: "Internal server error" });
    }
});
// GET /api/auth/me - Get current user from token
router.get("/me", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, email: true, name: true, image: true, role: true, personalization: true, isOnboarded: true, marketingSource: true }
        });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        res.json({ user });
    }
    catch (error) {
        res.status(401).json({ error: "Invalid token" });
    }
});
// PATCH /api/auth/profile
router.patch("/profile", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        const { name, personalization, isOnboarded, marketingSource } = req.body;
        console.log("DEBUG /profile UPDATE for user", decoded.userId, "Body:", req.body);
        const data = {};
        if (name !== undefined)
            data.name = name;
        if (personalization !== undefined)
            data.personalization = personalization;
        if (isOnboarded !== undefined)
            data.isOnboarded = isOnboarded;
        if (marketingSource !== undefined)
            data.marketingSource = marketingSource;
        console.log("DEBUG /profile DATA TO SAVE:", data);
        const updatedUser = await prisma_1.prisma.user.update({
            where: { id: decoded.userId },
            data,
            select: { id: true, email: true, name: true, role: true, personalization: true, isOnboarded: true }
        });
        console.log("DEBUG /profile UPDATED USER:", updatedUser);
        res.json({
            message: "Profile updated successfully",
            user: updatedUser
        });
    }
    catch (error) {
        console.error("Profile update error:", error);
        res.status(401).json({ error: "Invalid token or update failed" });
    }
});
// POST /api/auth/update-profile (fallback for proxies that don't support PATCH)
router.post("/update-profile", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        const { name, personalization, isOnboarded, marketingSource } = req.body;
        console.log("DEBUG /update-profile for user", decoded.userId, "Body:", req.body);
        const data = {};
        if (name !== undefined)
            data.name = name;
        if (personalization !== undefined)
            data.personalization = personalization;
        if (isOnboarded !== undefined)
            data.isOnboarded = isOnboarded;
        if (marketingSource !== undefined)
            data.marketingSource = marketingSource;
        const updatedUser = await prisma_1.prisma.user.update({
            where: { id: decoded.userId },
            data,
            select: { id: true, email: true, name: true, role: true, personalization: true, isOnboarded: true }
        });
        res.json({
            message: "Profile updated successfully",
            user: updatedUser
        });
    }
    catch (error) {
        console.error("Profile update error:", error);
        res.status(401).json({ error: "Invalid token or update failed" });
    }
});
// POST /api/auth/change-password
router.post("/change-password", async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        const { currentPassword, newPassword } = req.body;
        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ error: "New password must be at least 6 characters" });
        }
        const user = await prisma_1.prisma.user.findUnique({ where: { id: decoded.userId } });
        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }
        const passwordMatch = await bcryptjs_1.default.compare(currentPassword, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Incorrect current password" });
        }
        const hashedPassword = await bcryptjs_1.default.hash(newPassword, 10);
        await prisma_1.prisma.user.update({
            where: { id: user.id },
            data: { password: hashedPassword }
        });
        res.json({ message: "Password changed successfully" });
    }
    catch (error) {
        console.error("Change password error:", error);
        res.status(401).json({ error: "Invalid token or request failed" });
    }
});
exports.default = router;
