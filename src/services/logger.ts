/**
 * @fileoverview Winston logger configuration for the 9anon Legal AI backend.
 * Provides structured logging with different levels for development and production.
 * @module services/logger
 */

import winston from 'winston';
import path from 'path';

/**
 * Log levels configuration following RFC 5424 severity ordering.
 * error: 0, warn: 1, info: 2, http: 3, verbose: 4, debug: 5, silly: 6
 */
const levels = {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
};

/**
 * Determines the appropriate log level based on environment.
 * In development, show all logs. In production, show info and above.
 * @returns {string} The log level to use
 */
const level = (): string => {
    const env = process.env.NODE_ENV || 'development';
    const isDevelopment = env === 'development';
    return isDevelopment ? 'debug' : 'info';
};

/**
 * Color configuration for console output in development.
 */
const colors = {
    error: 'red',
    warn: 'yellow',
    info: 'green',
    http: 'magenta',
    debug: 'blue',
};

winston.addColors(colors);

/**
 * Custom format for log messages.
 * Includes timestamp, log level, and message.
 * In development, also includes colorization.
 */
const devFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
    winston.format.colorize({ all: true }),
    winston.format.printf((info) => {
        const { timestamp, level, message, stack } = info as {
            timestamp?: string;
            level: string;
            message: string;
            stack?: string
        };
        return `${timestamp} [${level}] ${message}${stack ? '\n' + stack : ''}`;
    })
);

/**
 * Production format - structured JSON for log aggregation systems.
 */
const prodFormat = winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

/**
 * Define log transports based on environment.
 * Development: Console only with colors
 * Production: Console (JSON) + File transports
 */
const transports: winston.transport[] = [
    new winston.transports.Console({
        format: process.env.NODE_ENV === 'production' ? prodFormat : devFormat,
    }),
];

// In production, also log to files
if (process.env.NODE_ENV === 'production') {
    const logsDir = path.join(__dirname, '../../logs');

    transports.push(
        // Error logs
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            format: prodFormat,
        }),
        // Combined logs
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            format: prodFormat,
        })
    );
}

/**
 * Winston logger instance configured for the 9anon Legal AI backend.
 * 
 * @example
 * // Import the logger
 * import { logger } from './services/logger';
 * 
 * // Log at different levels
 * logger.info('Server started successfully');
 * logger.error('Database connection failed', { error: err });
 * logger.debug('Processing request', { userId, action });
 * logger.http('Incoming request', { method: 'POST', path: '/api/chat' });
 */
const logger = winston.createLogger({
    level: level(),
    levels,
    transports,
    // Don't exit on uncaught exceptions
    exitOnError: false,
});

/**
 * Helper function to log HTTP requests.
 * Used by the request logging middleware.
 * 
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} url - Request URL
 * @param {number} statusCode - Response status code
 * @param {number} responseTime - Response time in milliseconds
 */
export const logHttpRequest = (
    method: string,
    url: string,
    statusCode: number,
    responseTime: number
): void => {
    const message = `${method} ${url} ${statusCode} - ${responseTime}ms`;

    if (statusCode >= 500) {
        logger.error(message);
    } else if (statusCode >= 400) {
        logger.warn(message);
    } else {
        logger.http(message);
    }
};

/**
 * Helper function to log authentication events.
 * 
 * @param {string} event - Auth event type (login, register, logout, etc.)
 * @param {string} userId - User ID (if available)
 * @param {boolean} success - Whether the auth event was successful
 * @param {string} [details] - Additional details
 */
export const logAuthEvent = (
    event: string,
    userId: string | null,
    success: boolean,
    details?: string
): void => {
    const level = success ? 'info' : 'warn';
    const message = `[AUTH] ${event} - User: ${userId || 'unknown'} - Success: ${success}${details ? ` - ${details}` : ''}`;
    logger.log(level, message);
};

/**
 * Helper function to log chat/AI interactions.
 * 
 * @param {string} action - Action being performed (query, response, etc.)
 * @param {string} userId - User ID
 * @param {object} [metadata] - Additional metadata
 */
export const logChatEvent = (
    action: string,
    userId: string | null,
    metadata?: Record<string, unknown>
): void => {
    logger.info(`[CHAT] ${action}`, { userId, ...metadata });
};

/**
 * Helper function to log database operations.
 * 
 * @param {string} operation - Database operation (query, insert, update, delete)
 * @param {string} entity - Entity being operated on
 * @param {boolean} success - Whether the operation was successful
 * @param {string} [details] - Additional details
 */
export const logDbOperation = (
    operation: string,
    entity: string,
    success: boolean,
    details?: string
): void => {
    const level = success ? 'debug' : 'error';
    logger.log(level, `[DB] ${operation} ${entity} - Success: ${success}${details ? ` - ${details}` : ''}`);
};

export { logger };
export default logger;
