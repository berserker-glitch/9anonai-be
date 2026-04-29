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
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const prisma_1 = require("../services/prisma");
const logger_1 = require("../services/logger");
const auth_1 = require("../middleware/auth");
const error_handler_1 = require("../middleware/error-handler");
const email_1 = require("../services/email");
const router = (0, express_1.Router)();
// ─────────────────────────────────────────────────────────────────────────────
// Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Schema for user registration request body.
 */
const RegisterSchema = zod_1.z.object({
    email: zod_1.z.string().email("Invalid email format"),
    password: zod_1.z.string()
        .min(8, "Password must be at least 8 characters")
        .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
        .regex(/[a-z]/, "Password must contain at least one lowercase letter")
        .regex(/[0-9]/, "Password must contain at least one number"),
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
    newPassword: zod_1.z.string()
        .min(8, "New password must be at least 8 characters")
        .regex(/[A-Z]/, "New password must contain at least one uppercase letter")
        .regex(/[a-z]/, "New password must contain at least one lowercase letter")
        .regex(/[0-9]/, "New password must contain at least one number"),
});
// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
/** Number of salt rounds for bcrypt password hashing */
const BCRYPT_SALT_ROUNDS = 10;
/**
 * Rate limiter for authentication endpoints.
 * Prevents brute-force attacks on login/register/change-password.
 */
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per window
    message: { error: 'Too many attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
    validate: { keyGeneratorIpFallback: false }, // suppress IPv6 keyGenerator warning
    keyGenerator: (req) => req.ip || 'unknown',
});
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
router.post("/register", authLimiter, (0, error_handler_1.asyncHandler)(async (req, res) => {
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
    // Send welcome email (fire-and-forget — don't block registration response)
    (0, email_1.sendWelcomeEmail)(email, name).catch((err) => logger_1.logger.error("[AUTH] Failed to send welcome email", { error: err?.message }));
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
router.post("/login", authLimiter, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { email, password } = LoginSchema.parse(req.body);
    // Find user by email
    const user = await prisma_1.prisma.user.findUnique({ where: { email } });
    if (!user) {
        (0, logger_1.logAuthEvent)("login", null, false, `User not found: ${email}`);
        throw error_handler_1.HttpErrors.unauthorized("Invalid credentials");
    }
    // Reject Google-only accounts trying to use password login
    if (!user.password) {
        (0, logger_1.logAuthEvent)("login", user.id, false, "Google-only account tried password login");
        throw error_handler_1.HttpErrors.badRequest("This account uses Google sign-in. Please sign in with Google.");
    }
    // Verify password
    const passwordMatch = await bcryptjs_1.default.compare(password, user.password);
    if (!passwordMatch) {
        (0, logger_1.logAuthEvent)("login", user.id, false, "Invalid password");
        throw error_handler_1.HttpErrors.unauthorized("Invalid credentials");
    }
    // Generate JWT token
    const token = (0, auth_1.generateToken)(user.id, user.email, user.role);
    // Track login timestamp (non-blocking)
    prisma_1.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => { });
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
    const [user, subscription] = await Promise.all([
        prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                name: true,
                image: true,
                role: true,
                personalization: true,
                isOnboarded: true,
                marketingSource: true,
                feedbackDismissed: true,
                country: true,
            }
        }),
        prisma_1.prisma.subscription.findUnique({
            where: { userId },
            select: {
                status: true,
                currentPeriodEnd: true,
                cancelledAt: true,
                plan: { select: { name: true, displayName: true, messagesPerConversation: true, contractsPerMonth: true } },
            }
        }),
    ]);
    if (!user) {
        logger_1.logger.warn(`[AUTH] User not found in /me: ${userId}`);
        throw error_handler_1.HttpErrors.notFound("User");
    }
    const planName = (subscription?.status === 'active' ? subscription.plan.name : 'free') ?? 'free';
    res.json({
        user: {
            ...user,
            plan: planName,
            subscription: subscription ? {
                status: subscription.status,
                planName: subscription.plan.name,
                planDisplayName: subscription.plan.displayName,
                currentPeriodEnd: subscription.currentPeriodEnd,
                cancelledAt: subscription.cancelledAt,
                messagesPerConversation: subscription.plan.messagesPerConversation,
                contractsPerMonth: subscription.plan.contractsPerMonth,
            } : null,
        }
    });
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
router.post("/change-password", auth_1.authenticate, authLimiter, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    const { currentPassword, newPassword } = ChangePasswordSchema.parse(req.body);
    // Fetch user with password
    const user = await prisma_1.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw error_handler_1.HttpErrors.notFound("User");
    }
    // Google-only accounts have no password to change
    if (!user.password) {
        throw error_handler_1.HttpErrors.badRequest("This account uses Google sign-in and has no password to change.");
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
/**
 * POST /api/auth/google
 * Authenticates (or registers) a user via Google OAuth2 access token.
 * Verifies the token by calling Google's userinfo endpoint.
 * If a matching email already exists, the accounts are linked automatically.
 *
 * @route POST /api/auth/google
 * @param {string} req.body.credential - Google OAuth2 access token from the frontend popup
 * @returns {object} 200 - JWT token and user data
 * @returns {object} 400 - Invalid or missing credential
 */
router.post("/google", authLimiter, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const { credential } = req.body;
    if (!credential) {
        throw error_handler_1.HttpErrors.badRequest("Google credential is required");
    }
    // Verify the access token by fetching user info from Google
    let payload;
    try {
        const googleRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${credential}` },
        });
        if (!googleRes.ok)
            throw new Error("Rejected by Google");
        const info = await googleRes.json();
        if (!info.sub || !info.email)
            throw new Error("Incomplete userinfo");
        payload = { sub: info.sub, email: info.email, name: info.name, picture: info.picture };
    }
    catch {
        (0, logger_1.logAuthEvent)("google-login", null, false, "Invalid Google token");
        throw error_handler_1.HttpErrors.unauthorized("Invalid Google token");
    }
    const { sub: googleId, email, name, picture } = payload;
    // Look up by googleId first, then fall back to email (link existing account)
    let user = await prisma_1.prisma.user.findUnique({ where: { googleId } });
    if (!user) {
        user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (user) {
            // Link existing email/password account to Google
            user = await prisma_1.prisma.user.update({
                where: { id: user.id },
                data: { googleId },
            });
        }
        else {
            // Create a new Google-only account
            user = await prisma_1.prisma.user.create({
                data: {
                    email: email,
                    password: null,
                    googleId,
                    name: name ?? null,
                    image: picture ?? null,
                },
            });
            // Send welcome email (fire-and-forget)
            (0, email_1.sendWelcomeEmail)(email, name).catch((err) => logger_1.logger.error("[AUTH] Failed to send welcome email", { error: err?.message }));
            (0, logger_1.logAuthEvent)("register", user.id, true, `New user via Google: ${email}`);
        }
    }
    // Update last login timestamp (non-blocking)
    prisma_1.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => { });
    const token = (0, auth_1.generateToken)(user.id, user.email, user.role);
    (0, logger_1.logAuthEvent)("google-login", user.id, true);
    logger_1.logger.info(`[AUTH] Google login: ${user.id}`);
    res.json({
        token,
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            isOnboarded: user.isOnboarded,
        },
    });
}));
/**
 * PATCH /api/auth/dismiss-feedback
 * Marks the feedback modal as dismissed for the authenticated user.
 * Persists the dismissal in the database so it won't show again.
 *
 * @route PATCH /api/auth/dismiss-feedback
 * @security Bearer
 * @returns {object} 200 - Success confirmation
 */
router.patch("/dismiss-feedback", auth_1.authenticate, (0, error_handler_1.asyncHandler)(async (req, res) => {
    const userId = req.userId;
    await prisma_1.prisma.user.update({
        where: { id: userId },
        data: { feedbackDismissed: true }
    });
    logger_1.logger.info(`[AUTH] Feedback dismissed for user ${userId}`);
    res.json({ success: true });
}));
exports.default = router;
