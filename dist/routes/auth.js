"use strict";
/**
 * @fileoverview Authentication routes for user registration, login, and profile management.
 * Provides JWT-based authentication with secure password hashing.
 * @module routes/auth
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = require("../services/prisma");
const logger_1 = require("../services/logger");
const auth_1 = require("../middleware/auth");
const error_handler_1 = require("../middleware/error-handler");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────────────────
// Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Schema for user registration request body.
 */
const RegisterSchema = zod_1.z.object({
    email: zod_1.z.string().email("Invalid email format"),
    password: zod_1.z.string().min(6, "Password must be at least 6 characters"),
    name: zod_1.z.string().optional(),
});
/**
 * Schema for user login request body.
 */
const LoginSchema = zod_1.z.object({
    email: zod_1.z.string().email("Invalid email format"),
    password: zod_1.z.string().min(1, "Password is required"),
});
/**
 * Schema for profile update request body.
 */
const UpdateProfileSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    personalization: zod_1.z.string().optional(),
    isOnboarded: zod_1.z.boolean().optional(),
    marketingSource: zod_1.z.string().optional(),
});
/**
 * Schema for password change request body.
 */
const ChangePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(1, "Current password is required"),
    newPassword: zod_1.z.string().min(6, "New password must be at least 6 characters"),
});
// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
/** Number of salt rounds for bcrypt password hashing */
const BCRYPT_SALT_ROUNDS = 10;
// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /api/auth/register
 * Registers a new user account with email and password.
 *
 * @route POST /api/auth/register
 * @param {string} req.body.email - User email (must be unique)
 * @param {string} req.body.password - User password (min 6 characters)
 * @param {string} [req.body.name] - Optional user display name
 * @returns {object} 201 - JWT token and user data
 * @returns {object} 400 - Validation error or user already exists
 */
router.post("/register", (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { email, password, name } = RegisterSchema.parse(req.body);
    // Check if user already exists
    const existingUser = await prisma_1.prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        (0, logger_1.logAuthEvent)("register", null, false, `Email already exists: ${email}`);
        throw error_handler_1.HttpErrors.conflict("User already exists");
    }
    // Hash password with bcrypt
    const hashedPassword = await bcryptjs_1.default.hash(password, BCRYPT_SALT_ROUNDS);
    // Create new user
    const user = await prisma_1.prisma.user.create({
        data: { email, password: hashedPassword, name },
    });
    // Generate JWT token
    const token = (0, auth_1.generateToken)(user.id, user.email, user.role);
    (0, logger_1.logAuthEvent)("register", user.id, true, `New user registered: ${email}`);
    logger_1.logger.info(`[AUTH] New user registered: ${user.id}`);
    res.status(201).json({
        message: "User created successfully",
        token,
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isOnboarded: user.isOnboarded
        }
    });
}));
/**
 * POST /api/auth/login
 * Authenticates a user with email and password.
 *
 * @route POST /api/auth/login
 * @param {string} req.body.email - User email
 * @param {string} req.body.password - User password
 * @returns {object} 200 - JWT token and user data
 * @returns {object} 401 - Invalid credentials
 */
router.post("/login", (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { email, password } = LoginSchema.parse(req.body);
    // Find user by email
    const user = await prisma_1.prisma.user.findUnique({ where: { email } });
    if (!user) {
        (0, logger_1.logAuthEvent)("login", null, false, `User not found: ${email}`);
        throw error_handler_1.HttpErrors.unauthorized("Invalid credentials");
    }
    // Verify password
    const passwordMatch = await bcryptjs_1.default.compare(password, user.password);
    if (!passwordMatch) {
        (0, logger_1.logAuthEvent)("login", user.id, false, "Invalid password");
        throw error_handler_1.HttpErrors.unauthorized("Invalid credentials");
    }
    // Generate JWT token
    const token = (0, auth_1.generateToken)(user.id, user.email, user.role);
    (0, logger_1.logAuthEvent)("login", user.id, true);
    logger_1.logger.info(`[AUTH] User logged in: ${user.id}`);
    res.json({
        token,
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isOnboarded: user.isOnboarded
        }
    });
}));
/**
 * GET /api/auth/me
 * Returns the currently authenticated user's data.
 *
 * @route GET /api/auth/me
 * @security Bearer
 * @returns {object} 200 - User data
 * @returns {object} 401 - Invalid or missing token
 * @returns {object} 404 - User not found
 */
router.get("/me", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            email: true,
            name: true,
            image: true,
            role: true,
            personalization: true,
            isOnboarded: true,
            marketingSource: true
        }
    });
    if (!user) {
        logger_1.logger.warn(`[AUTH] User not found in /me: ${userId}`);
        throw error_handler_1.HttpErrors.notFound("User");
    }
    res.json({ user });
}));
/**
 * PATCH /api/auth/profile
 * Updates the authenticated user's profile.
 *
 * @route PATCH /api/auth/profile
 * @security Bearer
 * @param {string} [req.body.name] - New display name
 * @param {string} [req.body.personalization] - Personalization settings (JSON)
 * @param {boolean} [req.body.isOnboarded] - Onboarding completion status
 * @param {string} [req.body.marketingSource] - Marketing attribution source
 * @returns {object} 200 - Updated user data
 */
router.patch("/profile", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const updates = UpdateProfileSchema.parse(req.body);
    logger_1.logger.debug(`[AUTH] Profile update for user ${userId}`, { updates });
    const updatedUser = await prisma_1.prisma.user.update({
        where: { id: userId },
        data: updates,
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            personalization: true,
            isOnboarded: true
        }
    });
    logger_1.logger.info(`[AUTH] Profile updated for user ${userId}`);
    res.json({
        message: "Profile updated successfully",
        user: updatedUser
    });
}));
/**
 * POST /api/auth/update-profile
 * Updates profile via POST (fallback for proxies that don't support PATCH).
 *
 * @route POST /api/auth/update-profile
 * @security Bearer
 * @deprecated Use PATCH /api/auth/profile instead
 */
router.post("/update-profile", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const updates = UpdateProfileSchema.parse(req.body);
    logger_1.logger.debug(`[AUTH] Profile update (POST fallback) for user ${userId}`, { updates });
    const updatedUser = await prisma_1.prisma.user.update({
        where: { id: userId },
        data: updates,
        select: {
            id: true,
            email: true,
            name: true,
            role: true,
            personalization: true,
            isOnboarded: true
        }
    });
    logger_1.logger.info(`[AUTH] Profile updated (POST) for user ${userId}`);
    res.json({
        message: "Profile updated successfully",
        user: updatedUser
    });
}));
/**
 * POST /api/auth/change-password
 * Changes the authenticated user's password.
 *
 * @route POST /api/auth/change-password
 * @security Bearer
 * @param {string} req.body.currentPassword - Current password for verification
 * @param {string} req.body.newPassword - New password (min 6 characters)
 * @returns {object} 200 - Success message
 * @returns {object} 401 - Incorrect current password
 */
router.post("/change-password", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { currentPassword, newPassword } = ChangePasswordSchema.parse(req.body);
    // Fetch user with password
    const user = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw error_handler_1.HttpErrors.notFound("User");
    }
    // Verify current password
    const passwordMatch = await bcryptjs_1.default.compare(currentPassword, user.password);
    if (!passwordMatch) {
        (0, logger_1.logAuthEvent)("change-password", userId, false, "Incorrect current password");
        throw error_handler_1.HttpErrors.unauthorized("Incorrect current password");
    }
    // Hash and update new password
    const hashedPassword = await bcryptjs_1.default.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await prisma_1.prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
    });
    (0, logger_1.logAuthEvent)("change-password", userId, true);
    logger_1.logger.info(`[AUTH] Password changed for user ${userId}`);
    res.json({ message: "Password changed successfully" });
}));
exports.default = router;
