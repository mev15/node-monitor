import winston from 'winston';
import path from 'path';

export class Logger {
  private static instance: Logger | null = null;
  private winston: winston.Logger;

  private constructor() {
    this.winston = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          ),
        }),
        new winston.transports.File({
          filename: path.join('logs', 'error.log'),
          level: 'error'
        }),
        new winston.transports.File({
          filename: path.join('logs', 'combined.log')
        }),
      ],
    });
  }

  /**
   * Get singleton instance
   */
  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Create a child logger with context
   */
  createChildLogger(context: string): ContextLogger {
    return new ContextLogger(this.winston, context);
  }

  /**
   * Log info message
   */
  info(message: string, meta?: any): void {
    this.winston.info(message, meta);
  }

  /**
   * Log error message
   */
  error(message: string, error?: any): void {
    this.winston.error(message, error);
  }

  /**
   * Log warning message
   */
  warn(message: string, meta?: any): void {
    this.winston.warn(message, meta);
  }

  /**
   * Log debug message
   */
  debug(message: string, meta?: any): void {
    this.winston.debug(message, meta);
  }

  /**
   * Reset singleton instance (mainly for testing)
   */
  static resetInstance(): void {
    Logger.instance = null;
  }
}

/**
 * Context logger that prefixes all messages with context
 */
export class ContextLogger {
  constructor(
    private winston: winston.Logger,
    private context: string
  ) {}

  private formatMessage(message: string): string {
    return `[${this.context}] ${message}`;
  }

  info(message: string, meta?: any): void {
    this.winston.info(this.formatMessage(message), meta);
  }

  error(message: string, error?: any): void {
    this.winston.error(this.formatMessage(message), error);
  }

  warn(message: string, meta?: any): void {
    this.winston.warn(this.formatMessage(message), meta);
  }

  debug(message: string, meta?: any): void {
    this.winston.debug(this.formatMessage(message), meta);
  }
}