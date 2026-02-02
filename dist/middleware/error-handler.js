"use strict";
/**
 * @fileoverview Centralized error handling middleware for the 9anon Legal AI backend.
 * Provides consistent error responses and logging across all routes.
 * @module middleware/error-handler
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFoundHandler = exports.asyncHandler = exports.errorHandler = exports.HttpErrors = exports.AppError = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const logger_1 = require("../services/logger");
/**
 * Custom application error class with status code and optional details.
 */
class AppError extends Error {
    /**
     * Creates a new AppError instance.
     *
     * @param {string} message - Error message
     * @param {number} statusCode - HTTP status code (default: 500)
     * @param {boolean} isOperational - Whether this is an operational error (default: true)
     * @param {unknown} [details] - Additional error details
     */
    constructor(message, statusCode = 500, isOperational = true, details) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        this.details = details;
        // Maintains proper stack trace for where error was thrown
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AppError = AppError;
/**
 * Common HTTP error factory functions for cleaner code.
 */
exports.HttpErrors = {
    /** Returns a 400 Bad Request error */
    badRequest: (message = 'Bad request', details) => new AppError(message, 400, true, details),
    /** Returns a 401 Unauthorized error */
    unauthorized: (message = 'Unauthorized') => new AppError(message, 401),
    /** Returns a 403 Forbidden error */
    forbidden: (message = 'Access denied') => new AppError(message, 403),
    /** Returns a 404 Not Found error */
    notFound: (resource = 'Resource') => new AppError(`${resource} not found`, 404),
    /** Returns a 409 Conflict error */
    conflict: (message = 'Resource already exists') => new AppError(message, 409),
    /** Returns a 422 Unprocessable Entity error */
    unprocessable: (message = 'Unprocessable entity', details) => new AppError(message, 422, true, details),
    /** Returns a 429 Too Many Requests error */
    tooManyRequests: (message = 'Too many requests') => new AppError(message, 429),
    /** Returns a 500 Internal Server Error */
    internal: (message = 'Internal server error') => new AppError(message, 500, false),
};
/**
 * Formats Zod validation errors into a user-friendly structure.
 *
 * @param {ZodError} error - The Zod validation error
 * @returns {object[]} Array of formatted error objects
 */
const formatZodError = (error) => {
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
const formatPrismaError = (error) => {
    switch (error.code) {
        case 'P2002':
            // Unique constraint violation
            const target = error.meta?.target?.join(', ') || 'field';
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
const errorHandler = (err, req, res, next) => {
    // Log the error
    logger_1.logger.error(`[ERROR] ${req.method} ${req.path}`, {
        error: err.message,
        stack: err.stack,
        body: req.body,
        params: req.params,
        query: req.query,
    });
    // Handle Zod validation errors
    if (err instanceof zod_1.ZodError) {
        res.status(400).json({
            error: 'Validation failed',
            details: formatZodError(err),
        });
        return;
    }
    // Handle Prisma errors
    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError) {
        const { statusCode, message } = formatPrismaError(err);
        res.status(statusCode).json({ error: message });
        return;
    }
    // Handle custom AppError
    if (err instanceof AppError) {
        const response = { error: err.message };
        if (err.details) {
            response.details = err.details;
        }
        res.status(err.statusCode).json(response);
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
        const multerError = err;
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
exports.errorHandler = errorHandler;
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
const asyncHandler = (fn) => {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};
exports.asyncHandler = asyncHandler;
/**
 * 404 handler for unknown routes.
 * Should be added after all other routes.
 *
 * @example
 * app.use(notFoundHandler);
 */
const notFoundHandler = (req, res, next) => {
    logger_1.logger.warn(`[404] ${req.method} ${req.path} - Route not found`);
    res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
};
exports.notFoundHandler = notFoundHandler;
