import { createPublicClient, webSocket, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';
import TelegramBot from 'node-telegram-bot-api';
import winston from 'winston';
import * as os from 'os';
import { loadConfig, type Config } from './config';

// Logger setup
const logger = winston.createLogger({
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
      filename: 'logs/error.log', 
      level: 'error' 
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    }),
  ],
});

class EthereumNodeMonitor {
  private config: Config;
  private client: PublicClient | null = null;
  private telegramBot: TelegramBot;
  private lastBlockTime: number = Date.now();
  private blockCheckInterval: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private isShuttingDown = false;
  private reconnectAttempts = 0;
  private displayNodeUrl: string;

  constructor(config: Config) {
    this.config = config;
    this.telegramBot = new TelegramBot(config.telegram.botToken, { polling: false });
    this.displayNodeUrl = this.getDisplayNodeUrl(config.ethereum.wsUrl);
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

  async start(): Promise<void> {
    logger.info('Starting Ethereum node monitor...');
    
    // Setup graceful shutdown
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));

    // Send startup notification
    await this.sendStartupNotification();

    await this.connect();
    this.startBlockTimeoutCheck();
  }

  private async sendStartupNotification(): Promise<void> {
    const message = `✅ *Ethereum Node Monitor Started*\n\n` +
      `Monitoring node: ${this.displayNodeUrl}\n` +
      `Block timeout: ${this.config.monitoring.blockTimeoutSeconds} seconds\n` +
      `Max reconnect attempts: ${this.config.monitoring.maxReconnectAttempts}\n` +
      `Time: ${new Date().toISOString()}`;
    
    try {
      await this.telegramBot.sendMessage(this.config.telegram.chatId, message, {
        parse_mode: 'Markdown',
      });
      logger.info('Startup notification sent to Telegram');
    } catch (error) {
      logger.error('Failed to send startup notification:', error);
    }
  }

  private async connect(): Promise<void> {
    try {
      logger.info(`Connecting to Ethereum node: ${this.config.ethereum.wsUrl}`);
      
      const transport = webSocket(this.config.ethereum.wsUrl, {
        reconnect: false, // We'll handle reconnection manually
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

      logger.info('Successfully connected and subscribed to new blocks');
      this.reconnectAttempts = 0;
    } catch (error) {
      logger.error('Failed to connect to Ethereum node:', error);
      await this.handleConnectionFailure();
    }
  }

  private handleNewBlock(block: any): void {
    const blockNumber = block.number;
    const timestamp = new Date().toISOString();
    
    logger.info(`New block received: ${blockNumber} at ${timestamp}`);
    this.lastBlockTime = Date.now();
  }

  private startBlockTimeoutCheck(): void {
    const timeoutMs = this.config.monitoring.blockTimeoutSeconds * 1000;
    
    this.blockCheckInterval = setInterval(async () => {
      const timeSinceLastBlock = Date.now() - this.lastBlockTime;
      
      if (timeSinceLastBlock > timeoutMs) {
        logger.error(`No new blocks received for ${this.config.monitoring.blockTimeoutSeconds} seconds`);
        await this.sendAlert('Block Timeout', `No new blocks received for more than ${this.config.monitoring.blockTimeoutSeconds} seconds`);
        await this.shutdown('BLOCK_TIMEOUT');
      }
    }, 5000); // Check every 5 seconds
  }


  private async handleSubscriptionError(error: Error): Promise<void> {
    logger.error('Block subscription error:', error);
    await this.handleConnectionFailure();
  }

  private async handleConnectionFailure(): Promise<void> {
    if (this.isShuttingDown) return;

    this.reconnectAttempts++;
    
    if (this.reconnectAttempts <= this.config.monitoring.maxReconnectAttempts) {
      logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.config.monitoring.maxReconnectAttempts})...`);
      
      // Clean up existing connection
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
      
      // Wait before reconnecting
      await new Promise(resolve => setTimeout(resolve, this.config.monitoring.reconnectDelayMs));
      
      // Try to reconnect
      await this.connect();
    } else {
      logger.error('Max reconnection attempts reached');
      await this.sendAlert('Connection Lost', `Failed to connect to Ethereum node after ${this.config.monitoring.maxReconnectAttempts} attempts`);
      await this.shutdown('CONNECTION_LOST');
    }
  }

  private async sendAlert(title: string, message: string): Promise<void> {
    const fullMessage = `🚨 *${title}*\n\n${message}\n\nTime: ${new Date().toISOString()}\nNode: ${this.displayNodeUrl}`;
    
    try {
      await this.telegramBot.sendMessage(this.config.telegram.chatId, fullMessage, {
        parse_mode: 'Markdown',
      });
      logger.info('Alert sent to Telegram');
    } catch (error) {
      logger.error('Failed to send Telegram alert:', error);
    }
  }

  private async shutdown(reason: string): Promise<void> {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    logger.info(`Shutting down monitor (reason: ${reason})...`);

    // Clean up
    if (this.blockCheckInterval) {
      clearInterval(this.blockCheckInterval);
    }
    
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    // Wait a bit for any pending operations
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    process.exit(reason === 'SIGINT' || reason === 'SIGTERM' ? 0 : 1);
  }
}

// Main execution
async function main() {
  try {
    const config = loadConfig();
    const monitor = new EthereumNodeMonitor(config);
    await monitor.start();
  } catch (error) {
    logger.error('Failed to start monitor:', error);
    process.exit(1);
  }
}

// Start the monitor
main().catch((error) => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});