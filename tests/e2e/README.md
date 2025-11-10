# End-to-End Tests

This directory contains end-to-end tests that verify the Kafka nodes work correctly with a real Kafka broker.

## Prerequisites

- Docker with Docker Compose v2 installed
- Node.js 14.6+ installed

## What Gets Tested

1. **Basic Producer/Consumer**: Verifies messages can be sent and received
2. **Compression**: Tests all compression types (GZIP, Snappy, LZ4)
3. **Multiple Messages**: Tests batch message handling

## Test Scripts

### Simple E2E Test (Recommended)

The simplified test uses KafkaJS directly for faster, more reliable testing:

```bash
# From the project root
node tests/e2e/simple-e2e-test.js
```

**How it works:**
1. Starts Apache Kafka 4.1.0 in Docker (KRaft mode)
2. Registers compression codecs (Snappy, LZ4)
3. Tests basic producer/consumer with KafkaJS
4. Tests all compression types (GZIP, Snappy, LZ4)
5. Tests multiple message handling
6. Cleans up Docker containers

**Advantages:**
- Faster execution (~45 seconds vs 2+ minutes)
- More reliable (no Node-RED runtime complexity)
- Direct KafkaJS testing (same library our nodes use)
- Better error reporting

### Full Node-RED E2E Test

Tests with actual Node-RED runtime (more complex, experimental):

```bash
# From the project root
node tests/e2e/run-e2e-tests.js
```

**How it works:**
1. Starts Kafka in Docker
2. Starts Node-RED runtime programmatically
3. Deploys test flows with our Kafka nodes
4. Verifies message delivery
5. Tests compression with actual nodes
6. Cleans up everything

## Test Environment

- Kafka Broker: `localhost:58092`
- Test Topics:
  - `e2e-test-topic` - Basic tests
  - `e2e-compression-topic` - Compression tests
  - `e2e-test-topic-batch` - Batch tests

## Cleanup

The tests automatically clean up all Docker containers and volumes after completion.

If tests fail or are interrupted, manually clean up with:

```bash
cd tests/e2e
docker compose down -v
```

## Troubleshooting

**Kafka won't start:**
- Check port 58092 is available
- Ensure Docker has enough resources

**Tests timeout:**
- Kafka may take longer to start on slower systems
- Increase timeout values in the test script

**Messages not received:**
- Check Docker logs: `docker logs kafka-e2e-test`
- Verify network connectivity
