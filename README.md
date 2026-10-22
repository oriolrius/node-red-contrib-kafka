# @oriolrius/node-red-contrib-kafka

Kafka Consumer and Producer

## About This Project

This Node-RED Kafka client is based on the original `node-red-contrib-kafka` implementations but has been completely modernized and enhanced. **We have migrated from the legacy `kafka-node` library to the modern `kafkajs` library** for better performance, reliability, and active maintenance support.

### Key Improvements Over Original Projects

- **Modern Library**: Uses `kafkajs` instead of the deprecated `kafka-node`
- **Enhanced SASL Support**: Better SASL authentication with support for PLAIN, SCRAM-SHA-256, and SCRAM-SHA-512 mechanisms
- **Improved SSL/TLS**: Enhanced certificate handling and SSL configuration options
- **Better Error Handling**: More detailed error reporting and debugging capabilities
- **Active Maintenance**: Built on actively maintained libraries for long-term reliability

This node can be used to produce and consume messages to/from Kafka. It consists of five nodes:

- **Kafka Broker** (oriolrius-kafka-broker) - Connection configuration
- **Kafka Send** (oriolrius-kafka-producer) - Send messages to Kafka topics  
- **Kafka Receive** (oriolrius-kafka-consumer) - Receive messages from Kafka topics
- **Kafka Schema Send** (oriolrius-kafka-producer) - Send messages with Avro or Protobuf schema validation
- **Kafka History Reader** (oriolrius-kafka-history-reader) - Retrieve historical messages by type

### Schema Registry Support

**NEW**: The `oriolrius-kafka-producer` node adds Avro schema validation support using Confluent Schema Registry. This node:

- Validates message payloads against registered Avro schemas
- Supports both latest and specific schema versions for production stability
- Supports automatic schema registration if schema doesn't exist
- Provides schema-only validation mode for testing
- Integrates with Confluent Schema Registry authentication
- Ensures data consistency and compatibility across your Kafka ecosystem
- **Version-aware caching**: Automatically fetches new schemas when version changes

### Protobuf Support

Since v6.2.0 the producer can also serialize with **Protobuf** (first contribution by [@YRoshcha](https://github.com/YRoshcha) in [#4](https://github.com/oriolrius/node-red-contrib-kafka/pull/4)):

- **Schema Registry mode**: Confluent wire format with the real message indexes, so any message of the `.proto` (including nested ones) is readable by Confluent consumers; auto-registration of the `.proto`, or the schema read from the registry
- **Raw mode**: plain Protobuf bytes, no Schema Registry
- Strict payload validation (types, enum values, unknown fields) using the Protobuf JSON mapping
- Kafka Receive and Kafka History Reader decode Protobuf messages from any Confluent-compatible producer

See the [Protobuf Guide](docs/PROTOBUF_PRODUCER_GUIDE.md).

### Kafka History Reader

**NEW**: The `oriolrius-kafka-history-reader` node allows you to retrieve historical messages of specific types from Kafka topics. This is particularly useful for:

- Getting the last known values of specific message types before starting real-time consumption
- Initializing your application state with historical data
- Implementing catch-up mechanisms for offline periods
- Debugging and analyzing message patterns

Key features:

- **Type-specific filtering**: Search for messages by type (checks `type`, `messageType`, `eventType`, `kind`, `msgType` fields)
- **Configurable limits**: Set maximum number of messages to retrieve per type
- **Offset control**: Start reading from earliest or latest available messages
- **Schema Registry support**: Works with both plain JSON and Avro-encoded messages
- **Non-destructive**: Uses temporary consumer groups to avoid affecting your main consumers

### SASL Authentication Support

This library provides comprehensive SASL authentication support based on the `kafkajs` project. It now supports:
- **PLAIN** - Basic username/password authentication
- **SCRAM-SHA-256** - Secure password authentication with SHA-256
- **SCRAM-SHA-512** - Secure password authentication with SHA-512

These enhanced authentication mechanisms provide better security compared to the original `kafka-node` implementations.

### Connection Timeouts

The Kafka Broker config node exposes the KafkaJS client timeouts, in milliseconds. Leave a field empty to keep the KafkaJS default:

| Field | KafkaJS option | Default |
|-------|----------------|---------|
| Connect timeout | `connectionTimeout` | 1000 |
| Auth timeout | `authenticationTimeout` | 10000 |
| Request timeout | `requestTimeout` | 30000 |

Raise the connect timeout for high-latency links or slow TLS handshakes.

### Compromised eMudhra CAs

In October 2026 the private keys of eight eMudhra intermediate CAs were found to be recoverable ([details](https://emudhra.we-have-a-problem.com/)). Node.js releases before 22.23.4 / 24.22.1 / 26.12.1, and unpatched system CA bundles, still trust them. With TLS enabled, the broker node refuses any certificate chain that goes through one of them, whatever trust store is in use. Updating Node.js is still recommended.

## Installation
```
npm install @oriolrius/node-red-contrib-kafka
```

## Documentation

This project includes comprehensive documentation to help you get started and understand all features:

### Getting Started

- **[Protobuf Guide](docs/PROTOBUF_PRODUCER_GUIDE.md)** - Protobuf serialization with or without Schema Registry
- **[Schema Guide](docs/SCHEMA_GUIDE.md)** - Complete guide to using Avro schema validation and version management with the Schema Producer node
- **[Kafka History Reader Guide](docs/KAFKA_HISTORY_READER_GUIDE.md)** - Complete guide to using the Kafka History Reader for retrieving historical messages
- **[Migration Guide](docs/MIGRATION_GUIDE.md)** - Guide for migrating from legacy kafka-node based implementations
- **[IoT Integration Guide](docs/IOT_INTEGRATION.md)** - Complete guide to IoT cloud configuration features

### Development & Implementation

- **[Implementation Summary](docs/IMPLEMENTATION_SUMMARY.md)** - Technical overview of the project's architecture and components
- **[Debug Guide](docs/DEBUG_GUIDE.md)** - Troubleshooting and debugging information for common issues

### Improvements & Features

- **[Schema Producer Status Improvements](docs/SCHEMA_PRODUCER_STATUS_IMPROVEMENTS.md)** - Details about status reporting enhancements in the Schema Producer
- **[Node Names Improvement](docs/NODE_NAMES_IMPROVEMENT.md)** - Information about node naming conventions and improvements

## License

This project is licensed under the MIT License - the same license as the original Node-RED Kafka projects that served as its foundation.

## Acknowledgments

This project is based on the excellent work by **emrebekar** and the original [node-red-contrib-kafka-client](https://github.com/emrebekar/node-red-contrib-kafka-client) project. We extend our sincere gratitude to emrebekar for creating the foundational Node-RED Kafka integration that served as the basis for this modernized implementation.

The original project provided the core architecture and functionality for Kafka producer and consumer nodes in Node-RED, which we have enhanced and migrated from the legacy `kafka-node` library to the modern `kafkajs` library for improved performance and reliability.
