# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-Service Monitor - A TypeScript-based monitoring system that tracks service health (Ethereum nodes, Redis servers) and sends Telegram alerts when issues are detected. Built with a modular architecture allowing easy addition of new monitor types.

## Key Commands

### Development
```bash
npm run dev              # Run with ts-node in development mode
npm test                 # Run Jest unit tests
npm run test:watch       # Run tests in watch mode
npm run build           # Compile TypeScript to dist/
npm start               # Run compiled JavaScript from dist/
```

### Testing Specific Files
```bash
npm test -- tests/monitors/RedisMonitor.test.ts    # Test Redis monitor
npm test -- tests/integration/                      # Run integration tests
npm test -- --coverage                              # Run with coverage report
```

### Production Deployment
```bash
npm run build                    # Build before deployment
pm2 start ecosystem.config.js    # Start with PM2
pm2 logs eth-node-monitor        # View PM2 logs
pm2 restart eth-node-monitor     # Restart service
pm2 stop eth-node-monitor        # Stop service
```

### Environment Setup
```bash
cp .env.example .env    # Create environment config
# Edit .env to configure monitors and Telegram settings
```

## Architecture

### Core Design Pattern

The system uses an **Abstract Base Monitor Pattern** with a coordinator:

1. **MonitorCoordinator** (`src/index.ts`)
   - Orchestrates multiple monitor instances
   - Handles global lifecycle (startup, shutdown, error handling)
   - Monitors active monitor status and shuts down gracefully if all fail

2. **BaseMonitor** (`src/core/BaseMonitor.ts`)
   - Abstract class defining monitor lifecycle and common behaviors
   - Implements reconnection logic, health checks, and alert sending
   - Requires subclasses to implement: `connect()`, `performHealthCheck()`, `disconnect()`, `getStartupMessage()`
   - Manages monitor states: IDLE → CONNECTING → CONNECTED ↔ RECONNECTING → SHUTTING_DOWN

3. **Concrete Monitors** (in `src/monitors/`)
   - **EthereumMonitor**: WebSocket connection via `viem`, watches for new blocks
   - **RedisMonitor**: Uses `ioredis`, performs PING checks and memory monitoring
   - Each extends BaseMonitor and implements service-specific logic

### Shared Services

- **TelegramNotifier** (`src/core/TelegramNotifier.ts`): Singleton for sending alerts
- **Logger** (`src/core/Logger.ts`): Singleton Winston logger with child logger support
- **Config** (`src/config.ts`): Environment variable loader with validation

### Monitor Flow

```
1. Coordinator loads config → creates monitors based on enabled flags
2. Each monitor: sends startup notification → connects → starts health checks
3. On failure: attempts reconnection → sends alert if max attempts exceeded → shuts down
4. Coordinator monitors all instances → clean shutdown if all fail
```

### Adding New Monitors

To add a new service monitor (e.g., PostgreSQL):

1. Add config interface to `src/types/index.ts` extending `MonitorConfig`
2. Update `src/config.ts` to load new environment variables
3. Create `src/monitors/PostgresMonitor.ts` extending `BaseMonitor`
4. Update `src/index.ts` to instantiate the new monitor if enabled
5. Add corresponding tests in `tests/monitors/`

## Key Features

### Monitoring Capabilities
- **Connection Health**: Automatic reconnection with configurable attempts
- **Service-Specific Checks**: Block timeouts (Ethereum), memory thresholds (Redis)
- **Response Time Monitoring**: Alerts on slow responses
- **Graceful Shutdown**: Clean resource cleanup on SIGINT/SIGTERM

### Notification System
- **Startup Notifications**: Confirms monitor initialization with config details
- **Alert Notifications**: Immediate alerts for failures with contextual details
- **Smart IP Resolution**: Converts localhost to actual network IP in notifications

### Testing Infrastructure
- Jest with TypeScript support via ts-jest
- Mock implementations for external services (viem, ioredis, Telegram API)
- Integration tests for multi-monitor scenarios
- Unit tests for individual monitor behaviors

## Dependencies

### Core Libraries
- `viem`: Ethereum WebSocket client
- `ioredis`: Redis client with built-in reconnection
- `node-telegram-bot-api`: Telegram bot integration
- `winston`: Structured logging
- `dotenv`: Environment configuration

### Development
- TypeScript with strict mode
- Jest for testing
- ts-node for development execution
- PM2 for production process management