import { MonitorConfig, MonitorStatus, HealthCheckResult } from '../types';
import { Logger } from './Logger';
import { TelegramNotifier } from './TelegramNotifier';

export abstract class BaseMonitor {
  protected readonly config: MonitorConfig;
  protected readonly logger: Logger;
  protected readonly notifier: TelegramNotifier;
  protected status: MonitorStatus = MonitorStatus.IDLE;
  protected reconnectAttempts = 0;
  protected isShuttingDown = false;
  protected healthCheckInterval: NodeJS.Timeout | null = null;

  constructor(config: MonitorConfig, logger: Logger, notifier: TelegramNotifier) {
    this.config = config;
    this.logger = logger;
    this.notifier = notifier;
  }

  /**
   * Start the monitor
   */
  async start(): Promise<void> {
    if (!this.config.enabled) {
      this.logger.info(`${this.config.name} monitor is disabled`);
      return;
    }

    this.logger.info(`Starting ${this.config.name} monitor...`);
    this.status = MonitorStatus.CONNECTING;

    // Send startup notification
    await this.sendStartupNotification();

    // Setup graceful shutdown handlers
    this.setupShutdownHandlers();

    // Connect to the service
    await this.connect();

    // Start health check
    this.startHealthCheck();
  }

  /**
   * Abstract method to connect to the service
   */
  protected abstract connect(): Promise<void>;

  /**
   * Abstract method to perform health check
   */
  protected abstract performHealthCheck(): Promise<HealthCheckResult>;

  /**
   * Abstract method to disconnect from the service
   */
  protected abstract disconnect(): Promise<void>;

  /**
   * Abstract method to get service-specific startup message
   */
  protected abstract getStartupMessage(): string;

  /**
   * Send startup notification
   */
  protected async sendStartupNotification(): Promise<void> {
    const message = `✅ *${this.config.name} Monitor Started*\n\n${this.getStartupMessage()}`;

    try {
      await this.notifier.sendMessage(message, { parse_mode: 'Markdown' });
      this.logger.info(`Startup notification sent for ${this.config.name}`);
    } catch (error) {
      this.logger.error(`Failed to send startup notification for ${this.config.name}:`, error);
    }
  }

  /**
   * Start health check interval
   */
  protected abstract startHealthCheck(): void;

  /**
   * Handle connection failure with reconnection logic
   */
  protected async handleConnectionFailure(): Promise<void> {
    if (this.isShuttingDown) return;

    this.status = MonitorStatus.DISCONNECTED;
    this.reconnectAttempts++;

    if (this.reconnectAttempts <= this.config.maxReconnectAttempts) {
      this.logger.info(`Attempting to reconnect ${this.config.name} (${this.reconnectAttempts}/${this.config.maxReconnectAttempts})...`);
      this.status = MonitorStatus.RECONNECTING;

      // Wait before reconnecting
      await new Promise(resolve => setTimeout(resolve, this.config.reconnectDelayMs));

      // Try to reconnect
      try {
        await this.connect();
        this.reconnectAttempts = 0;
      } catch (error) {
        this.logger.error(`${this.config.name} reconnection attempt failed:`, error);
        await this.handleConnectionFailure();
      }
    } else {
      this.logger.error(`Max reconnection attempts reached for ${this.config.name}`);
      await this.sendAlert('Connection Lost', `Failed to connect to ${this.config.name} after ${this.config.maxReconnectAttempts} attempts`);
      await this.shutdown('CONNECTION_LOST');
    }
  }

  /**
   * Send alert notification
   */
  protected async sendAlert(title: string, message: string, details?: Record<string, any>): Promise<void> {
    let fullMessage = `🚨 *${this.config.name}: ${title}*\n\n${message}\n\nTime: ${new Date().toISOString()}`;

    if (details) {
      fullMessage += '\n\nDetails:\n' + Object.entries(details)
        .map(([key, value]) => `• ${key}: ${value}`)
        .join('\n');
    }

    try {
      await this.notifier.sendMessage(fullMessage, { parse_mode: 'Markdown' });
      this.logger.info(`Alert sent for ${this.config.name}: ${title}`);
    } catch (error) {
      this.logger.error(`Failed to send alert for ${this.config.name}:`, error);
    }
  }

  /**
   * Setup shutdown handlers
   */
  protected setupShutdownHandlers(): void {
    const shutdownHandler = (signal: string) => {
      if (!this.isShuttingDown) {
        this.shutdown(signal);
      }
    };

    process.once('SIGINT', () => shutdownHandler('SIGINT'));
    process.once('SIGTERM', () => shutdownHandler('SIGTERM'));
  }

  /**
   * Shutdown the monitor
   */
  async shutdown(reason: string): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    this.status = MonitorStatus.SHUTTING_DOWN;
    this.logger.info(`Shutting down ${this.config.name} monitor (reason: ${reason})...`);

    // Stop health check
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Disconnect from service
    try {
      await this.disconnect();
    } catch (error) {
      this.logger.error(`Error disconnecting ${this.config.name}:`, error);
    }

    this.logger.info(`${this.config.name} monitor shutdown complete`);

    // Exit process immediately for critical failures (restore original behavior)
    // Don't exit for normal shutdown signals or when coordinator is handling it
    if (reason !== 'SIGINT' && reason !== 'SIGTERM' && reason !== 'ALL_MONITORS_DOWN') {
      this.logger.info(`Exiting process due to critical failure: ${reason}`);
      process.exit(1);
    }
  }

  /**
   * Get current monitor status
   */
  getStatus(): MonitorStatus {
    return this.status;
  }

  /**
   * Check if monitor is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}