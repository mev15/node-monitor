import { createPublicClient, webSocket, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import * as os from 'os';
import { BaseMonitor } from '../core/BaseMonitor';
import { EthereumConfig, HealthCheckResult, MonitorStatus } from '../types';
import { Logger, ContextLogger } from '../core/Logger';
import { TelegramNotifier } from '../core/TelegramNotifier';

export class EthereumMonitor extends BaseMonitor {
  private client: PublicClient | null = null;
  private lastBlockTime: number = Date.now();
  private unsubscribe: (() => void) | null = null;
  private blockCheckInterval: NodeJS.Timeout | null = null;
  private displayNodeUrl: string;
  private contextLogger: ContextLogger;

  constructor(
    config: EthereumConfig,
    logger: Logger,
    notifier: TelegramNotifier
  ) {
    super(config, logger, notifier);
    this.displayNodeUrl = this.getDisplayNodeUrl((config as EthereumConfig).wsUrl);
    this.contextLogger = logger.createChildLogger('EthereumMonitor');
  }

  private getDisplayNodeUrl(url: string): string {
    // Check if URL contains localhost or 127.0.0.1
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      const localIp = this.getLocalIpv4();
      if (localIp) {
        return url.replace(/localhost|127\.0\.0\.1/, localIp);
      }
    }
    return url;
  }

  private getLocalIpv4(): string | null {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (iface) {
        for (const addr of iface) {
          if (addr.family === 'IPv4' && !addr.internal) {
            return addr.address;
          }
        }
      }
    }
    return null;
  }

  protected async connect(): Promise<void> {
    const config = this.config as EthereumConfig;

    try {
      this.contextLogger.info(`Connecting to Ethereum node: ${config.wsUrl}`);

      const transport = webSocket(config.wsUrl, {
        reconnect: false, // We handle reconnection manually
      });

      this.client = createPublicClient({
        chain: mainnet,
        transport,
      });

      // Subscribe to new blocks
      this.unsubscribe = await this.client.watchBlocks({
        onBlock: (block) => this.handleNewBlock(block),
        onError: (error) => this.handleSubscriptionError(error),
      });

      this.status = MonitorStatus.CONNECTED;
      this.contextLogger.info('Successfully connected and subscribed to new blocks');
      this.reconnectAttempts = 0;
    } catch (error) {
      this.contextLogger.error('Failed to connect to Ethereum node:', error);
      throw error;
    }
  }

  private handleNewBlock(block: any): void {
    const blockNumber = block.number;
    const timestamp = new Date().toISOString();

    this.contextLogger.info(`New block received: ${blockNumber} at ${timestamp}`);
    this.lastBlockTime = Date.now();
  }

  private async handleSubscriptionError(error: Error): Promise<void> {
    this.contextLogger.error('Block subscription error:', error);

    // Clean up existing connection
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    await this.handleConnectionFailure();
  }

  protected async performHealthCheck(): Promise<HealthCheckResult> {
    const ethConfig = this.config as EthereumConfig;
    const timeSinceLastBlock = Date.now() - this.lastBlockTime;
    const timeoutMs = ethConfig.blockTimeoutSeconds * 1000;

    if (timeSinceLastBlock > timeoutMs) {
      return {
        healthy: false,
        message: `No new blocks received for ${ethConfig.blockTimeoutSeconds} seconds`,
        details: {
          lastBlockTime: new Date(this.lastBlockTime).toISOString(),
          timeSinceLastBlock: Math.floor(timeSinceLastBlock / 1000),
          threshold: ethConfig.blockTimeoutSeconds
        }
      };
    }

    return {
      healthy: true,
      message: 'Ethereum node is healthy',
      details: {
        lastBlockTime: new Date(this.lastBlockTime).toISOString(),
        timeSinceLastBlock: Math.floor(timeSinceLastBlock / 1000)
      }
    };
  }

  protected startHealthCheck(): void {
    this.blockCheckInterval = setInterval(async () => {
      if (this.isShuttingDown) return;

      const healthResult = await this.performHealthCheck();

      if (!healthResult.healthy && healthResult.message) {
        this.contextLogger.error(healthResult.message);
        await this.sendAlert('Block Timeout', healthResult.message, healthResult.details);
        await this.shutdown('BLOCK_TIMEOUT');
      }
    }, 5000); // Check every 5 seconds
  }

  protected async disconnect(): Promise<void> {
    if (this.blockCheckInterval) {
      clearInterval(this.blockCheckInterval);
      this.blockCheckInterval = null;
    }

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.client = null;
  }

  protected getStartupMessage(): string {
    const config = this.config as EthereumConfig;
    return `Monitoring node: ${this.displayNodeUrl}\n` +
           `Block timeout: ${config.blockTimeoutSeconds} seconds\n` +
           `Max reconnect attempts: ${config.maxReconnectAttempts}\n` +
           `Time: ${new Date().toISOString()}`;
  }
}