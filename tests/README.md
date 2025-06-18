# Tests

This directory contains simplified tests for the Kafka Node-RED nodes.

## Available Tests

- **`basic-kafka-test.js`** - Complete integration test using testcontainers to simulate a Kafka server, tests both producer and consumer functionality
- **`test-node-loading.js`** - Simple test to verify node modules load correctly
- **`comprehensive-test.js`** - Tests node instantiation and basic configuration
- **`test-node-structure.js`** - Validates the node structure and exports

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Individual Tests
```bash
# Basic Kafka integration test with embedded server
npm run test:basic

# Node loading test
npm run test:loading

# Comprehensive node test
npm run test:comprehensive
```

## Test Features

The tests focus on basic Kafka functionality without schema validation:

- **Producer Node**: Tests message publishing with and without IoT formatting
- **Consumer Node**: Tests message consumption with different encoding options
- **Broker Node**: Tests connection configuration and Kafka client creation

## Dependencies

Tests use:
- `testcontainers` for embedded Kafka server simulation
- `kafkajs` for actual Kafka operations
- Mock Node-RED environment for node testing

## Notes

- Schema validation tests have been removed to focus on core functionality
- Tests use an embedded Kafka container for realistic integration testing
- All tests run without requiring external Kafka infrastructure
