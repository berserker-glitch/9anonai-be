"use strict";
/**
 * @fileoverview Centralized authentication middleware for the 9anon Legal AI backend.
 * Provides reusable JWT authentication and authorization utilities.
 * @module middleware/auth
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyToken = exports.generateToken = exports.requireSuperAdmin = exports.optionalAuth = exports.authenticate = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../services/prisma");
const logger_1 = require("../services/logger");
// Validate JWT_SECRET at module load time
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}
/**
 * Extracts and validates JWT token from Authorization header.
 *
 * @param {string | undefined} authHeader - The Authorization header value
 * @returns {{ token: string } | { error: string }} The extracted token or error
 */
const extractToken = (authHeader) => {
    if (!authHeader) {
        return { error: 'No authorization header provided' };
    }
    if (!authHeader.startsWith('Bearer ')) {
        return { error: 'Invalid authorization header format. Expected: Bearer <token>' };
    }
    const token = authHeader.split(' ')[1];
    if (!token) {
        return { error: 'No token provided in authorization header' };
    }
    return { token };
};
/**
 * Middleware that requires valid JWT authentication.
 * Attaches userId, userEmail, and userRole to the request object.
 * Returns 401 if token is missing, invalid, or expired.
 *
 * @example
 * router.get('/protected', authenticate, (req, res) => {
 *     const userId = (req as AuthenticatedRequest).userId;
 *     // Handle protected route
 * });
 */
const authenticate = async (req, res, next) => {
    const result = extractToken(req.headers.authorization);
    if ('error' in result) {
        (0, logger_1.logAuthEvent)('authenticate', null, false, result.error);
        res.status(401).json({ error: result.error });
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(result.token, JWT_SECRET);
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
        req.userRole = decoded.role;
        logger_1.logger.debug(`User authenticated: ${decoded.userId}`);
        next();
    }
    catch (error) {
        const message = error instanceof jsonwebtoken_1.default.TokenExpiredError
            ? 'Token expired'
            : 'Invalid token';
        (0, logger_1.logAuthEvent)('authenticate', null, false, message);
        res.status(401).json({ error: message });
    }
};
exports.authenticate = authenticate;
/**
 * Middleware for optional authentication.
 * If a valid token is present, attaches user data to request.
 * If no token or invalid token, continues without authentication.
 *
 * @example
 * router.post('/chat', optionalAuth, (req, res) => {
 *     const userId = (req as AuthenticatedRequest).userId; // May be undefined
 *     // Handle route with optional user context
 * });
 */
const optionalAuth = async (req, res, next) => {
    const result = extractToken(req.headers.authorization);
    if ('error' in result) {
        // No token provided - continue without authentication
        next();
        return;
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(result.token, JWT_SECRET);
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
        req.userRole = decoded.role;
        logger_1.logger.debug(`Optional auth: User ${decoded.userId} authenticated`);
    }
    catch (error) {
        // Invalid token - continue without authentication
        logger_1.logger.debug('Optional auth: Invalid token, continuing without auth');
    }
    next();
};
exports.optionalAuth = optionalAuth;
/**
 * Middleware that requires superadmin role.
 * Must be used after authenticate middleware.
 * Fetches user from database to verify current role.
 *
 * @example
 * router.get('/admin/users', authenticate, requireSuperAdmin, (req, res) => {
 *     // Handle admin route
 * });
 */
const requireSuperAdmin = async (req, res, next) => {
    const userId = req.userId;
    if (!userId) {
        (0, logger_1.logAuthEvent)('requireSuperAdmin', null, false, 'No userId in request');
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    try {
        // Fetch current user role from database (in case it changed since token was issued)
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true }
        });
        if (!user) {
            (0, logger_1.logAuthEvent)('requireSuperAdmin', userId, false, 'User not found');
            res.status(401).json({ error: 'User not found' });
            return;
        }
        if (user.role !== 'superadmin') {
            (0, logger_1.logAuthEvent)('requireSuperAdmin', userId, false, `Role: ${user.role}`);
            res.status(403).json({ error: 'Access denied. Superadmin role required.' });
            return;
        }
        (0, logger_1.logAuthEvent)('requireSuperAdmin', userId, true);
        next();
    }
    catch (error) {
        logger_1.logger.error('Error checking superadmin role', { error, userId });
        res.status(500).json({ error: 'Internal server error' });
    }
};
exports.requireSuperAdmin = requireSuperAdmin;
/**
 * Generates a JWT token for a user.
 *
 * @param {string} userId - The user's ID
 * @param {string} email - The user's email
 * @param {string} [role] - The user's role
 * @param {string} [expiresIn='7d'] - Token expiration time
 * @returns {string} The generated JWT token
 */
const generateToken = (userId, email, role, expiresIn = '7d') => {
    const payload = { userId, email, role };
    return jsonwebtoken_1.default.sign(payload, JWT_SECRET, { expiresIn });
};
exports.generateToken = generateToken;
/**
 * Verifies a JWT token and returns the decoded payload.
 *
 * @param {string} token - The JWT token to verify
 * @returns {JwtPayload | null} The decoded payload or null if invalid
 */
const verifyToken = (token) => {
    try {
        return jsonwebtoken_1.default.verify(token, JWT_SECRET);
    }
    catch {
        return null;
    }
};
exports.verifyToken = verifyToken;
