import Redis from 'ioredis';
import { BaseMonitor } from '../core/BaseMonitor';
import { RedisConfig, HealthCheckResult, MonitorStatus } from '../types';
import { Logger, ContextLogger } from '../core/Logger';
import { TelegramNotifier } from '../core/TelegramNotifier';

export class RedisMonitor extends BaseMonitor {
  private client: Redis | null = null;
  private lastHealthCheckTime: number = Date.now();
  private displayRedisUrl: string;
  private contextLogger: ContextLogger;
  private consecutiveFailures: number = 0;

  constructor(
    config: RedisConfig,
    logger: Logger,
    notifier: TelegramNotifier
  ) {
    super(config, logger, notifier);
    this.displayRedisUrl = this.getDisplayRedisUrl(config);
    this.contextLogger = logger.createChildLogger('RedisMonitor');
  }

  private getDisplayRedisUrl(config: RedisConfig): string {
    let host = config.host;

    // Check if host is localhost or 127.0.0.1
    if (host === 'localhost' || host === '127.0.0.1') {
      const localIp = this.getLocalIpv4();
      if (localIp) {
        host = localIp;
      }
    }

    return `${host}:${config.port}`;
  }

  protected async connect(): Promise<void> {
    const config = this.config as RedisConfig;

    try {
      this.contextLogger.info(`Connecting to Redis: ${config.host}:${config.port}`);

      this.client = new Redis({
        host: config.host,
        port: config.port,
        password: config.password,
        db: config.db,
        connectTimeout: config.timeoutMs,
        commandTimeout: config.timeoutMs,
        retryStrategy: () => null, // We handle reconnection manually
        lazyConnect: true,
        maxRetriesPerRequest: 1
      });

      // Set up error handlers
      this.client.on('error', (error) => this.handleRedisError(error));
      this.client.on('close', async () => await this.handleRedisClose());
      this.client.on('ready', () => this.handleRedisReady());

      // Connect to Redis
      await this.client.connect();

      // Test connection with PING
      await this.client.ping();

      this.status = MonitorStatus.CONNECTED;
      this.lastHealthCheckTime = Date.now();
      this.consecutiveFailures = 0;
      this.contextLogger.info('Successfully connected to Redis');

    } catch (error) {
      this.contextLogger.error('Failed to connect to Redis:', error);

      // Trigger connection failure handling which will attempt reconnection
      // and send alert if all retries fail
      this.status = MonitorStatus.DISCONNECTED;
      await this.handleConnectionFailure();

      throw error;
    }
  }

  private handleRedisError(error: Error): void {
    this.contextLogger.error('Redis error:', error);

    // Don't trigger reconnection if we're already shutting down
    if (this.isShuttingDown) return;

    // Don't trigger if we're already reconnecting
    if (this.status === MonitorStatus.RECONNECTING) return;

    // Only set status here, let close event handle the reconnection
    // This prevents duplicate calls to handleConnectionFailure
    this.status = MonitorStatus.DISCONNECTED;
  }

  private async handleRedisClose(): Promise<void> {
    if (this.isShuttingDown) return;

    this.contextLogger.warn('Redis connection closed');

    // Handle connection failure (will check status internally)
    await this.handleConnectionFailure();
  }

  private handleRedisReady(): void {
    this.contextLogger.info('Redis connection ready');
    this.status = MonitorStatus.CONNECTED;
    this.consecutiveFailures = 0;
  }

  protected async performHealthCheck(): Promise<HealthCheckResult> {
    const config = this.config as RedisConfig;

    if (!this.client || this.status !== MonitorStatus.CONNECTED) {
      return {
        healthy: false,
        message: 'Redis client is not connected',
        details: {
          status: this.status
        }
      };
    }

    try {
      // 1. PING check with timeout
      const pingStart = Date.now();
      const pong = await Promise.race([
        this.client.ping(),
        new Promise<null>((_, reject) =>
          setTimeout(() => reject(new Error('Ping timeout')), config.timeoutMs)
        )
      ]);

      const pingTime = Date.now() - pingStart;

      if (pong !== 'PONG') {
        throw new Error(`Unexpected ping response: ${pong}`);
      }

      // 2. Get memory usage
      const infoMemory = await this.client.info('memory');
      const memoryUsed = this.parseMemoryUsage(infoMemory);

      // 3. Get connected clients count
      const infoClients = await this.client.info('clients');
      const connectedClients = this.parseConnectedClients(infoClients);

      // 4. Check memory threshold if configured
      let memoryAlert = false;
      if (config.memoryAlertThresholdMb && memoryUsed) {
        const memoryUsedMb = memoryUsed / (1024 * 1024);
        if (memoryUsedMb > config.memoryAlertThresholdMb) {
          memoryAlert = true;
        }
      }

      // 5. Check response time
      const responseTimeAlert = pingTime > config.timeoutMs * 0.8; // Alert if > 80% of timeout

      this.lastHealthCheckTime = Date.now();
      this.consecutiveFailures = 0;

      // Determine overall health
      if (memoryAlert || responseTimeAlert) {
        const issues = [];
        if (memoryAlert) {
          issues.push(`Memory usage exceeds threshold (${Math.round(memoryUsed! / (1024 * 1024))} MB > ${config.memoryAlertThresholdMb} MB)`);
        }
        if (responseTimeAlert) {
          issues.push(`Response time is high (${pingTime}ms)`);
        }

        return {
          healthy: false,
          message: `Redis health issues detected: ${issues.join(', ')}`,
          details: {
            responseTime: `${pingTime}ms`,
            memoryUsedBytes: memoryUsed,
            memoryUsedMb: memoryUsed ? Math.round(memoryUsed / (1024 * 1024)) : null,
            connectedClients,
            issues
          }
        };
      }

      return {
        healthy: true,
        message: 'Redis is healthy',
        details: {
          responseTime: `${pingTime}ms`,
          memoryUsedBytes: memoryUsed,
          memoryUsedMb: memoryUsed ? Math.round(memoryUsed / (1024 * 1024)) : null,
          connectedClients
        }
      };

    } catch (error) {
      this.consecutiveFailures++;

      return {
        healthy: false,
        message: `Redis health check failed: ${error}`,
        details: {
          error: error instanceof Error ? error.message : String(error),
          consecutiveFailures: this.consecutiveFailures
        }
      };
    }
  }

  private parseMemoryUsage(infoMemory: string): number | null {
    const match = infoMemory.match(/used_memory:(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  private parseConnectedClients(infoClients: string): number | null {
    const match = infoClients.match(/connected_clients:(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  protected startHealthCheck(): void {
    const config = this.config as RedisConfig;

    this.healthCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      const healthResult = await this.performHealthCheck();

      if (!healthResult.healthy && healthResult.message) {
        this.contextLogger.error(healthResult.message);

        // Check if we should trigger an alert
        if (this.consecutiveFailures >= 3) {
          await this.sendAlert('Health Check Failed', healthResult.message, healthResult.details);

          // If memory threshold exceeded, don't shutdown, just alert
          const memoryIssue = healthResult.details?.issues?.some(
            (issue: string) => issue.includes('Memory usage exceeds')
          );

          if (!memoryIssue) {
            await this.shutdown('HEALTH_CHECK_FAILED');
          }
        }
      } else {
        // Log health status periodically
        if (Date.now() - this.lastHealthCheckTime > 60000) {
          this.contextLogger.info('Redis health check passed', healthResult.details);
        }
      }
    }, config.healthCheckIntervalMs);
  }

  protected async disconnect(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    if (this.client) {
      try {
        await this.client.quit();
      } catch (error) {
        this.contextLogger.error('Error disconnecting from Redis:', error);
      }
      this.client = null;
    }
  }

  protected getStartupMessage(): string {
    const config = this.config as RedisConfig;
    return `Monitoring Redis: ${this.displayRedisUrl}\n` +
           `Database: ${config.db}\n` +
           `Health check interval: ${config.healthCheckIntervalMs / 1000} seconds\n` +
           `Timeout: ${config.timeoutMs}ms\n` +
           `Memory alert threshold: ${config.memoryAlertThresholdMb ? `${config.memoryAlertThresholdMb} MB` : 'Not configured'}\n` +
           `Max reconnect attempts: ${config.maxReconnectAttempts}\n` +
           `Time: ${new Date().toISOString()}`;
  }

  /**
   * Test Redis connection
   */
  async testConnection(): Promise<boolean> {
    try {
      if (this.client && this.status === MonitorStatus.CONNECTED) {
        const result = await this.client.ping();
        return result === 'PONG';
      }
      return false;
    } catch {
      return false;
    }
  }
}