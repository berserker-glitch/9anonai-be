/**
 * @fileoverview Centralized authentication middleware for the 9anon Legal AI backend.
 * Provides reusable JWT authentication and authorization utilities.
 * @module middleware/auth
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../services/prisma';
import { logger, logAuthEvent } from '../services/logger';

/**
 * Extended Request interface with authenticated user data.
 */
export interface AuthenticatedRequest extends Request {
    userId?: string;
    userEmail?: string;
    userRole?: string;
}

/**
 * JWT payload structure.
 */
interface JwtPayload {
    userId: string;
    email: string;
    role?: string;
}

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
const extractToken = (authHeader: string | undefined): { token: string } | { error: string } => {
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
export const authenticate = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const result = extractToken(req.headers.authorization);

    if ('error' in result) {
        logAuthEvent('authenticate', null, false, result.error);
        res.status(401).json({ error: result.error });
        return;
    }

    try {
        const decoded = jwt.verify(result.token, JWT_SECRET!) as JwtPayload;

        (req as AuthenticatedRequest).userId = decoded.userId;
        (req as AuthenticatedRequest).userEmail = decoded.email;
        (req as AuthenticatedRequest).userRole = decoded.role;

        logger.debug(`User authenticated: ${decoded.userId}`);
        next();
    } catch (error) {
        const message = error instanceof jwt.TokenExpiredError
            ? 'Token expired'
            : 'Invalid token';

        logAuthEvent('authenticate', null, false, message);
        res.status(401).json({ error: message });
    }
};

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
export const optionalAuth = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const result = extractToken(req.headers.authorization);

    if ('error' in result) {
        // No token provided - continue without authentication
        next();
        return;
    }

    try {
        const decoded = jwt.verify(result.token, JWT_SECRET!) as JwtPayload;

        (req as AuthenticatedRequest).userId = decoded.userId;
        (req as AuthenticatedRequest).userEmail = decoded.email;
        (req as AuthenticatedRequest).userRole = decoded.role;

        logger.debug(`Optional auth: User ${decoded.userId} authenticated`);
    } catch (error) {
        // Invalid token - continue without authentication
        logger.debug('Optional auth: Invalid token, continuing without auth');
    }

    next();
};

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
export const requireSuperAdmin = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!userId) {
        logAuthEvent('requireSuperAdmin', null, false, 'No userId in request');
        res.status(401).json({ error: 'Authentication required' });
        return;
    }

    try {
        // Fetch current user role from database (in case it changed since token was issued)
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true }
        });

        if (!user) {
            logAuthEvent('requireSuperAdmin', userId, false, 'User not found');
            res.status(401).json({ error: 'User not found' });
            return;
        }

        if (user.role !== 'superadmin') {
            logAuthEvent('requireSuperAdmin', userId, false, `Role: ${user.role}`);
            res.status(403).json({ error: 'Access denied. Superadmin role required.' });
            return;
        }

        logAuthEvent('requireSuperAdmin', userId, true);
        next();
    } catch (error) {
        logger.error('Error checking superadmin role', { error, userId });
        res.status(500).json({ error: 'Internal server error' });
    }
};

/**
 * Generates a JWT token for a user.
 * 
 * @param {string} userId - The user's ID
 * @param {string} email - The user's email
 * @param {string} [role] - The user's role
 * @param {string} [expiresIn='7d'] - Token expiration time
 * @returns {string} The generated JWT token
 */
export const generateToken = (
    userId: string,
    email: string,
    role?: string,
    expiresIn: string = '7d'
): string => {
    const payload: JwtPayload = { userId, email, role };
    return jwt.sign(payload, JWT_SECRET!, { expiresIn });
};

/**
 * Verifies a JWT token and returns the decoded payload.
 * 
 * @param {string} token - The JWT token to verify
 * @returns {JwtPayload | null} The decoded payload or null if invalid
 */
export const verifyToken = (token: string): JwtPayload | null => {
    try {
        return jwt.verify(token, JWT_SECRET!) as JwtPayload;
    } catch {
        return null;
    }
};
