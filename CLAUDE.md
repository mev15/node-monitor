# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Ethereum Node Monitor - A TypeScript-based monitoring service that tracks Ethereum node health via WebSocket connections and sends Telegram alerts when issues are detected.

## Key Commands

### Development
```bash
npm run dev              # Run with ts-node in development mode
npm test                 # Run Jest unit tests
npm run test:watch       # Run tests in watch mode
npm run build           # Compile TypeScript to dist/
```

### Production Deployment
```bash
npm run build           # Build before deployment
pm2 start ecosystem.config.js    # Start with PM2
pm2 logs eth-node-monitor        # View PM2 logs
pm2 restart eth-node-monitor     # Restart service
pm2 stop eth-node-monitor        # Stop service
```

### Environment Setup
```bash
cp .env.example .env    # Create environment config
# Edit .env with actual values for:
# - ETHEREUM_WS_URL (WebSocket endpoint)
# - TELEGRAM_BOT_TOKEN 
# - TELEGRAM_CHAT_ID
```

## Architecture

### Core Components

1. **EthereumNodeMonitor** (`src/index.ts`)
   - Main monitoring class that manages WebSocket connection to Ethereum node
   - Implements automatic reconnection logic with configurable attempts
   - Tracks last block time and triggers alerts on timeout
   - Handles graceful shutdown on SIGINT/SIGTERM
   - Automatically converts localhost URLs to actual IPv4 for remote accessibility

2. **Configuration** (`src/config.ts`)
   - Loads and validates environment variables
   - Provides typed configuration interface
   - Defaults: 60s block timeout, 3 reconnect attempts, 5s reconnect delay

3. **Monitoring Flow**
   - Connects to Ethereum node via WebSocket using `viem` library
   - Subscribes to new blocks with `watchBlocks`
   - Checks every 5 seconds if block timeout exceeded
   - On failure: attempts reconnection → sends Telegram alert → exits process

### Key Features

- **Startup Notification**: Sends Telegram message when monitoring begins with configuration details
- **Local IP Resolution**: Replaces localhost/127.0.0.1 with actual network IP in notifications
- **Automatic Recovery**: Attempts reconnection before declaring node failure
- **Clean Shutdown**: Properly unsubscribes and cleans up resources on exit

### PM2 Configuration

The `ecosystem.config.js` configures:
- Memory limit: 500MB with auto-restart
- Log rotation with timestamps
- Exponential backoff for restart delays
- Separate log files for stdout/stderr

### Testing

Tests use Jest with TypeScript support. Mock implementations for:
- viem WebSocket connections
- Telegram Bot API calls
- Environment variable loading

## Dependencies

### Core Libraries
- `viem`: Ethereum client library for WebSocket connections
- `node-telegram-bot-api`: Telegram bot integration
- `winston`: Structured logging
- `dotenv`: Environment variable management

### Development
- TypeScript with strict mode enabled
- Jest for testing with ts-jest preset
- ts-node for development execution