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

- **Kafka Broker** (hm-kafka-broker) - Connection configuration
- **Kafka Send** (hm-kafka-producer) - Send messages to Kafka topics  
- **Kafka Receive** (hm-kafka-consumer) - Receive messages from Kafka topics
- **Kafka Schema Send** (hm-kafka-schema-producer) - Send messages with Avro schema validation
- **Kafka History Reader** (hm-kafka-history-reader) - Retrieve historical messages by type

### Schema Registry Support

**NEW**: The `hm-kafka-schema-producer` node adds Avro schema validation support using Confluent Schema Registry. This node:

- Validates message payloads against registered Avro schemas
- Supports both latest and specific schema versions for production stability
- Supports automatic schema registration if schema doesn't exist
- Provides schema-only validation mode for testing
- Integrates with Confluent Schema Registry authentication
- Ensures data consistency and compatibility across your Kafka ecosystem
- **Version-aware caching**: Automatically fetches new schemas when version changes

### Kafka History Reader

**NEW**: The `hm-kafka-history-reader` node allows you to retrieve historical messages of specific types from Kafka topics. This is particularly useful for:

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

## Installation
```
npm install @oriolrius/node-red-contrib-kafka
```

## Documentation

This project includes comprehensive documentation to help you get started and understand all features:

### Getting Started

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
