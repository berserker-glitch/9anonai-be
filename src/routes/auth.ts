/**
 * @fileoverview Authentication routes for user registration, login, and profile management.
 * Provides JWT-based authentication with secure password hashing.
 * @module routes/auth
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../services/prisma";
import { logger, logAuthEvent } from "../services/logger";
import {
    authenticate,
    generateToken,
    AuthenticatedRequest
} from "../middleware/auth";
import { asyncHandler, HttpErrors } from "../middleware/error-handler";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Validation Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schema for user registration request body.
 */
const RegisterSchema = z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(6, "Password must be at least 6 characters"),
    name: z.string().optional(),
});

/**
 * Schema for user login request body.
 */
const LoginSchema = z.object({
    email: z.string().email("Invalid email format"),
    password: z.string().min(1, "Password is required"),
});

/**
 * Schema for profile update request body.
 */
const UpdateProfileSchema = z.object({
    name: z.string().optional(),
    personalization: z.string().optional(),
    isOnboarded: z.boolean().optional(),
    marketingSource: z.string().optional(),
});

/**
 * Schema for password change request body.
 */
const ChangePasswordSchema = z.object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(6, "New password must be at least 6 characters"),
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
router.post("/register", asyncHandler(async (req: Request, res: Response) => {
    const { email, password, name } = RegisterSchema.parse(req.body);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
        logAuthEvent("register", null, false, `Email already exists: ${email}`);
        throw HttpErrors.conflict("User already exists");
    }

    // Hash password with bcrypt
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    // Create new user
    const user = await prisma.user.create({
        data: { email, password: hashedPassword, name },
    });

    // Generate JWT token
    const token = generateToken(user.id, user.email, user.role);

    logAuthEvent("register", user.id, true, `New user registered: ${email}`);
    logger.info(`[AUTH] New user registered: ${user.id}`);

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
router.post("/login", asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = LoginSchema.parse(req.body);

    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
        logAuthEvent("login", null, false, `User not found: ${email}`);
        throw HttpErrors.unauthorized("Invalid credentials");
    }

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password);
    if (!passwordMatch) {
        logAuthEvent("login", user.id, false, "Invalid password");
        throw HttpErrors.unauthorized("Invalid credentials");
    }

    // Generate JWT token
    const token = generateToken(user.id, user.email, user.role);

    logAuthEvent("login", user.id, true);
    logger.info(`[AUTH] User logged in: ${user.id}`);

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
router.get("/me", authenticate, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;

    const user = await prisma.user.findUnique({
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
        logger.warn(`[AUTH] User not found in /me: ${userId}`);
        throw HttpErrors.notFound("User");
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
router.patch("/profile", authenticate, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const updates = UpdateProfileSchema.parse(req.body);

    logger.debug(`[AUTH] Profile update for user ${userId}`, { updates });

    const updatedUser = await prisma.user.update({
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

    logger.info(`[AUTH] Profile updated for user ${userId}`);

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
router.post("/update-profile", authenticate, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const updates = UpdateProfileSchema.parse(req.body);

    logger.debug(`[AUTH] Profile update (POST fallback) for user ${userId}`, { updates });

    const updatedUser = await prisma.user.update({
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

    logger.info(`[AUTH] Profile updated (POST) for user ${userId}`);

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
router.post("/change-password", authenticate, asyncHandler(async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const { currentPassword, newPassword } = ChangePasswordSchema.parse(req.body);

    // Fetch user with password
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw HttpErrors.notFound("User");
    }

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatch) {
        logAuthEvent("change-password", userId, false, "Incorrect current password");
        throw HttpErrors.unauthorized("Incorrect current password");
    }

    // Hash and update new password
    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
    });

    logAuthEvent("change-password", userId, true);
    logger.info(`[AUTH] Password changed for user ${userId}`);

    res.json({ message: "Password changed successfully" });
}));

export default router;
