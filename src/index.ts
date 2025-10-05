import { loadConfig } from './config';
import { Logger } from './core/Logger';
import { TelegramNotifier } from './core/TelegramNotifier';
import { EthereumMonitor } from './monitors/EthereumMonitor';
import { RedisMonitor } from './monitors/RedisMonitor';
import { BaseMonitor } from './core/BaseMonitor';

class MonitorCoordinator {
  private monitors: BaseMonitor[] = [];
  private logger: Logger;
  private isShuttingDown = false;

  constructor() {
    this.logger = Logger.getInstance();
  }

  async start(): Promise<void> {
    try {
      // Load configuration
      const config = loadConfig();
      this.logger.info('Configuration loaded successfully');

      // Initialize shared services
      const notifier = TelegramNotifier.getInstance(config.telegram);
      this.logger.info('Telegram notifier initialized');

      // Initialize monitors based on configuration
      if (config.ethereum.enabled) {
        const ethereumMonitor = new EthereumMonitor(
          config.ethereum,
          this.logger,
          notifier
        );
        this.monitors.push(ethereumMonitor);
        this.logger.info('Ethereum monitor initialized');
      }

      if (config.redis.enabled) {
        const redisMonitor = new RedisMonitor(
          config.redis,
          this.logger,
          notifier
        );
        this.monitors.push(redisMonitor);
        this.logger.info('Redis monitor initialized');
      }

      if (this.monitors.length === 0) {
        throw new Error('No monitors are enabled. Please enable at least one monitor.');
      }

      // Setup global shutdown handlers
      this.setupShutdownHandlers();

      // Start all monitors
      this.logger.info(`Starting ${this.monitors.length} monitor(s)...`);
      const startPromises = this.monitors.map(monitor =>
        monitor.start().catch(error => {
          this.logger.error(`Failed to start monitor:`, error);
          throw error;
        })
      );

      await Promise.all(startPromises);
      this.logger.info('All monitors started successfully');

      // Keep the process running
      await this.keepAlive();

    } catch (error) {
      this.logger.error('Failed to start monitor coordinator:', error);
      await this.shutdown('STARTUP_FAILURE');
      process.exit(1);
    }
  }

  private setupShutdownHandlers(): void {
    const shutdownHandler = async (signal: string) => {
      if (!this.isShuttingDown) {
        await this.shutdown(signal);
      }
    };

    process.once('SIGINT', () => shutdownHandler('SIGINT'));
    process.once('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.once('uncaughtException', (error) => {
      this.logger.error('Uncaught exception:', error);
      shutdownHandler('UNCAUGHT_EXCEPTION');
    });
    process.once('unhandledRejection', (reason) => {
      this.logger.error('Unhandled rejection:', reason);
      shutdownHandler('UNHANDLED_REJECTION');
    });
  }

  private async keepAlive(): Promise<void> {
    // Keep the process alive by checking monitor status periodically
    return new Promise((resolve) => {
      const statusCheckInterval = setInterval(async () => {
        if (this.isShuttingDown) {
          clearInterval(statusCheckInterval);
          resolve();
          return;
        }

        // Check if any monitors have shut down
        const activeMonitors = this.monitors.filter(monitor =>
          monitor.getStatus() !== 'shutting_down'
        );

        if (activeMonitors.length === 0) {
          this.logger.warn('All monitors have shut down');
          clearInterval(statusCheckInterval);
          await this.shutdown('ALL_MONITORS_DOWN');
          resolve();
        }
      }, 5000); // Check every 5 seconds
    });
  }

  private async shutdown(reason: string): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    this.logger.info(`Shutting down monitor coordinator (reason: ${reason})...`);

    // Shutdown all monitors in parallel
    const shutdownPromises = this.monitors.map(monitor =>
      monitor.shutdown(reason).catch(error => {
        this.logger.error('Error shutting down monitor:', error);
      })
    );

    await Promise.all(shutdownPromises);

    // Wait a bit for any pending operations
    await new Promise(resolve => setTimeout(resolve, 1000));

    this.logger.info('Monitor coordinator shutdown complete');

    // Exit with appropriate code
    const exitCode = reason === 'SIGINT' || reason === 'SIGTERM' ? 0 : 1;
    process.exit(exitCode);
  }
}

// Main execution
async function main() {
  const coordinator = new MonitorCoordinator();
  await coordinator.start();
}

// Start the application
main().catch((error) => {
  console.error('Fatal error starting application:', error);
  process.exit(1);
});