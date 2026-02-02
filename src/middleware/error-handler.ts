/**
 * @fileoverview Centralized error handling middleware for the 9anon Legal AI backend.
 * Provides consistent error responses and logging across all routes.
 * @module middleware/error-handler
 */

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { logger } from '../services/logger';

/**
 * Custom application error class with status code and optional details.
 */
export class AppError extends Error {
    public readonly statusCode: number;
    public readonly isOperational: boolean;
    public readonly details?: unknown;

    /**
     * Creates a new AppError instance.
     * 
     * @param {string} message - Error message
     * @param {number} statusCode - HTTP status code (default: 500)
     * @param {boolean} isOperational - Whether this is an operational error (default: true)
     * @param {unknown} [details] - Additional error details
     */
    constructor(
        message: string,
        statusCode: number = 500,
        isOperational: boolean = true,
        details?: unknown
    ) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.details = details;

        // Maintains proper stack trace for where error was thrown
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * Common HTTP error factory functions for cleaner code.
 */
export const HttpErrors = {
    /** Returns a 400 Bad Request error */
    badRequest: (message: string = 'Bad request', details?: unknown): AppError =>
        new AppError(message, 400, true, details),

    /** Returns a 401 Unauthorized error */
    unauthorized: (message: string = 'Unauthorized'): AppError =>
        new AppError(message, 401),

    /** Returns a 403 Forbidden error */
    forbidden: (message: string = 'Access denied'): AppError =>
        new AppError(message, 403),

    /** Returns a 404 Not Found error */
    notFound: (resource: string = 'Resource'): AppError =>
        new AppError(`${resource} not found`, 404),

    /** Returns a 409 Conflict error */
    conflict: (message: string = 'Resource already exists'): AppError =>
        new AppError(message, 409),

    /** Returns a 422 Unprocessable Entity error */
    unprocessable: (message: string = 'Unprocessable entity', details?: unknown): AppError =>
        new AppError(message, 422, true, details),

    /** Returns a 429 Too Many Requests error */
    tooManyRequests: (message: string = 'Too many requests'): AppError =>
        new AppError(message, 429),

    /** Returns a 500 Internal Server Error */
    internal: (message: string = 'Internal server error'): AppError =>
        new AppError(message, 500, false),
};

/**
 * Formats Zod validation errors into a user-friendly structure.
 * 
 * @param {ZodError} error - The Zod validation error
 * @returns {object[]} Array of formatted error objects
 */
const formatZodError = (error: ZodError): object[] => {
    return error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code,
    }));
};

/**
 * Formats Prisma errors into user-friendly messages.
 * 
 * @param {Prisma.PrismaClientKnownRequestError} error - The Prisma error
 * @returns {{ statusCode: number; message: string }} Formatted error info
 */
const formatPrismaError = (error: Prisma.PrismaClientKnownRequestError): { statusCode: number; message: string } => {
    switch (error.code) {
        case 'P2002':
            // Unique constraint violation
            const target = (error.meta?.target as string[])?.join(', ') || 'field';
            return { statusCode: 409, message: `A record with this ${target} already exists` };

        case 'P2025':
            // Record not found
            return { statusCode: 404, message: 'Record not found' };

        case 'P2003':
            // Foreign key constraint failed
            return { statusCode: 400, message: 'Invalid reference to related record' };

        default:
            return { statusCode: 500, message: 'Database error occurred' };
    }
};

/**
 * Global error handling middleware.
 * Catches all errors and returns consistent JSON responses.
 * 
 * @example
 * // Add at the end of Express app setup
 * app.use(errorHandler);
 */
export const errorHandler = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    // Log the error
    logger.error(`[ERROR] ${req.method} ${req.path}`, {
        error: err.message,
        stack: err.stack,
        body: req.body,
        params: req.params,
        query: req.query,
    });

    // Handle Zod validation errors
    if (err instanceof ZodError) {
        res.status(400).json({
            error: 'Validation failed',
            details: formatZodError(err),
        });
        return;
    }

    // Handle Prisma errors
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
        const { statusCode, message } = formatPrismaError(err);
        res.status(statusCode).json({ error: message });
        return;
    }

    // Handle custom AppError
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            error: err.message,
            ...(err.details && { details: err.details }),
        });
        return;
    }

    // Handle JWT errors
    if (err.name === 'JsonWebTokenError') {
        res.status(401).json({ error: 'Invalid token' });
        return;
    }

    if (err.name === 'TokenExpiredError') {
        res.status(401).json({ error: 'Token expired' });
        return;
    }

    // Handle multer errors (file upload)
    if (err.name === 'MulterError') {
        const multerError = err as any;

        if (multerError.code === 'LIMIT_FILE_SIZE') {
            res.status(400).json({ error: 'File too large. Maximum size is 10MB' });
            return;
        }

        if (multerError.code === 'LIMIT_FILE_COUNT') {
            res.status(400).json({ error: 'Too many files. Maximum is 5 files' });
            return;
        }

        res.status(400).json({ error: `File upload error: ${multerError.message}` });
        return;
    }

    // Default error response
    const statusCode = 500;
    const message = process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err.message;

    res.status(statusCode).json({ error: message });
};

/**
 * Async wrapper for route handlers.
 * Catches rejected promises and forwards them to error middleware.
 * 
 * @example
 * router.get('/users', asyncHandler(async (req, res) => {
 *     const users = await prisma.user.findMany();
 *     res.json(users);
 * }));
 */
export const asyncHandler = (
    fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
    return (req: Request, res: Response, next: NextFunction): void => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

/**
 * 404 handler for unknown routes.
 * Should be added after all other routes.
 * 
 * @example
 * app.use(notFoundHandler);
 */
export const notFoundHandler = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    logger.warn(`[404] ${req.method} ${req.path} - Route not found`);
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
};
