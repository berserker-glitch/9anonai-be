"use strict";
/**
 * @fileoverview HTTP request logging middleware using Winston.
 * Provides structured logging for all incoming requests with timing information.
 * @module middleware/request-logger
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.correlationIdMiddleware = exports.requestLogger = void 0;
const logger_1 = require("../services/logger");
/**
 * Sanitizes request body to avoid logging sensitive information.
 * Masks passwords and tokens in the logged output.
 *
 * @param {any} body - The request body to sanitize
 * @returns {any} Sanitized body safe for logging
 */
const sanitizeBody = (body) => {
    if (!body || typeof body !== 'object') {
        return body;
    }
    const sanitized = { ...body };
    const sensitiveFields = ['password', 'currentPassword', 'newPassword', 'token', 'secret', 'apiKey'];
    for (const field of sensitiveFields) {
        if (field in sanitized) {
            sanitized[field] = '[REDACTED]';
        }
    }
    return sanitized;
};
/**
 * HTTP request logging middleware.
 * Logs incoming requests and their responses with timing information.
 *
 * Features:
 * - Logs request method, URL, and relevant headers
 * - Sanitizes sensitive data from request bodies
 * - Measures and logs response time
 * - Uses appropriate log levels based on response status
 *
 * @example
 * // Add early in Express middleware chain
 * app.use(requestLogger);
 */
const requestLogger = (req, res, next) => {
    const startTime = Date.now();
    // Log incoming request
    logger_1.logger.http(`--> ${req.method} ${req.url}`, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
        contentType: req.get('content-type'),
    });
    // Log request body for mutation methods (sanitized)
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
        const sanitizedBody = sanitizeBody(req.body);
        const bodyPreview = JSON.stringify(sanitizedBody).substring(0, 300);
        logger_1.logger.debug(`Request body: ${bodyPreview}${bodyPreview.length >= 300 ? '...' : ''}`);
    }
    // Capture response completion
    res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        (0, logger_1.logHttpRequest)(req.method, req.url, res.statusCode, responseTime);
    });
    next();
};
exports.requestLogger = requestLogger;
/**
 * Correlation ID middleware.
 * Adds a unique correlation ID to each request for tracing.
 * The ID is available in req headers and is added to response headers.
 *
 * @example
 * app.use(correlationIdMiddleware);
 */
const correlationIdMiddleware = (req, res, next) => {
    const correlationId = req.get('X-Correlation-ID') || generateCorrelationId();
    // Set on request for use in route handlers
    req.correlationId = correlationId;
    // Set on response headers
    res.setHeader('X-Correlation-ID', correlationId);
    next();
};
exports.correlationIdMiddleware = correlationIdMiddleware;
/**
 * Generates a unique correlation ID.
 *
 * @returns {string} Unique identifier for request tracing
 */
const generateCorrelationId = () => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return `${timestamp}-${random}`;
};
exports.default = exports.requestLogger;
