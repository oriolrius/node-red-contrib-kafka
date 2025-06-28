# Schema Guide for Kafka Schema Producer

This comprehensive guide covers using the Kafka Schema Producer node for Avro schema validation, including basic usage and advanced schema version management.

## Overview

The Kafka Schema Producer node provides:

- **Avro schema validation** using Confluent Schema Registry
- **Schema version management** for production stability and compatibility  
- **Automatic schema registration** for development workflows
- **Version-aware caching** for optimal performance
- **Comprehensive error handling** and debugging support

## Basic Configuration

### Required Settings

1. **Kafka Broker**: Configure your existing hm-kafka-broker node
2. **Schema Registry**: Set up Schema Registry connection (usually running on port 8081)
3. **Topic**: The Kafka topic where messages will be published
4. **Schema Subject**: The subject name in Schema Registry (e.g., "my-topic-value")
5. **Schema Version**: The schema version to use (defaults to "latest")

### Default Schema

The node comes with a default schema that includes these fields:

```json
{
  "type": "record",
  "name": "Message",
  "fields": [
    {"name": "id", "type": "string"},
    {"name": "message", "type": "string"},
    {"name": "timestamp", "type": "long"}
  ]
}
```

### Message Format

Input messages should match the schema structure:

```json
{
  "id": "unique-message-id",
  "message": "Your message content",
  "timestamp": 1640995200000
}
```

## Schema Version Management

The Schema Producer node supports both latest and specific schema versions, allowing you to:

- **Pin to specific versions** for production stability
- **Use latest version** for development and testing
- **Handle schema evolution** gracefully
- **Rollback to previous versions** when needed

### Version Configuration Options

The **Schema Version** field accepts:

- **"latest"** (default): Always uses the most recent schema version
- **Specific version numbers**: Use exact versions like "1", "2", "3", etc.

### Use Cases and Examples

#### Production Deployments

```json
{
  "schemaVersion": "3",
  "autoRegister": false
}
```

**Benefits:**
- Ensures all production instances use the same schema
- Prevents unexpected schema changes from breaking your application
- Allows controlled schema upgrades

#### Development and Testing

```json
{
  "schemaVersion": "latest",
  "autoRegister": true
}
```

**Benefits:**
- Automatically uses new schema versions as they're registered
- Simplifies development workflow
- Enables rapid prototyping

#### Rollback Scenarios

```json
{
  "schemaVersion": "2"
}
```

**Benefits:**
- Quick recovery from problematic schema changes
- Temporary fix while investigating issues
- Gradual migration support

### Version Caching Behavior

The node implements intelligent version-aware caching:

#### Cache Logic

1. **Cache Key**: Combination of schema subject + version
2. **Cache Hit**: When requesting the same subject + version combination
3. **Cache Miss**: When version changes or cache is empty
4. **Automatic Refresh**: Cache invalidated when version changes

#### Example Cache Behavior

```text
Request: subject="test-topic-value", version="latest"
→ Cache miss, fetch schema ID 5, cache it

Request: subject="test-topic-value", version="latest" 
→ Cache hit, use cached schema ID 5

Change config to version="3", deploy
→ Cache miss, fetch schema ID 3, cache it

Request: subject="test-topic-value", version="3"
→ Cache hit, use cached schema ID 3
```

## Development Workflow

### Typical Development Process

1. **Development Phase**
   - Use `"schemaVersion": "latest"`
   - Enable `autoRegister: true`
   - Rapidly iterate on schema changes

2. **Testing Phase**
   - Pin to specific version for consistent testing
   - Use `"schemaVersion": "4"`
   - Disable auto-registration

3. **Production Deployment**
   - Use pinned version in production
   - Monitor and validate before upgrading
   - Coordinate schema version across all services

### Schema Evolution Example

```javascript
// Version 1: Initial schema
{
  "type": "record",
  "name": "UserEvent",
  "fields": [
    {"name": "userId", "type": "string"},
    {"name": "action", "type": "string"}
  ]
}

// Version 2: Add optional field (backward compatible)
{
  "type": "record",
  "name": "UserEvent", 
  "fields": [
    {"name": "userId", "type": "string"},
    {"name": "action", "type": "string"},
    {"name": "timestamp", "type": ["null", "long"], "default": null}
  ]
}

// Version 3: Add required field (forward compatible only)
{
  "type": "record",
  "name": "UserEvent",
  "fields": [
    {"name": "userId", "type": "string"},
    {"name": "action", "type": "string"},
    {"name": "timestamp", "type": "long"},
    {"name": "sessionId", "type": "string"}
  ]
}
```

## Auto-Registration and Versioning

### Important Limitations

**Auto-registration only works with "latest" version**. You cannot auto-register to a specific historical version.

### Valid Auto-Registration

```json
{
  "schemaVersion": "latest",
  "autoRegister": true,
  "autoSchema": "..."
}
```

### Invalid Auto-Registration

```json
{
  "schemaVersion": "3",      // ❌ Cannot auto-register to specific version
  "autoRegister": true,
  "autoSchema": "..."
}
```

## Node Configuration Examples

### Basic Configuration

```json
{
  "id": "schema-producer-basic",
  "type": "hm-kafka-schema-producer",
  "name": "Basic Schema Producer",
  "broker": "broker1",
  "topic": "test-topic",
  "registryUrl": "http://localhost:8081",
  "schemaSubject": "test-topic-value",
  "schemaVersion": "latest",
  "autoRegister": true
}
```

### Production Configuration

```json
{
  "id": "schema-producer-prod",
  "type": "hm-kafka-schema-producer",
  "name": "Producer (Schema v3)",
  "broker": "broker1",
  "topic": "test-topic",
  "registryUrl": "http://localhost:8081",
  "schemaSubject": "test-topic-value",
  "schemaVersion": "3",
  "autoRegister": false
}
```

## Error Handling

### Common Version-Related Errors

#### Invalid Version Format

```text
Error: Invalid schema version: "abc". Must be 'latest' or a positive integer.
```

**Solution**: Use "latest" or positive integers like "1", "2", "3"

#### Version Not Found

```text
Error: Schema not found for subject test-topic-value, version 7
```

**Solution**: Check available versions in Schema Registry or use a valid version

#### Auto-Register with Specific Version

```text
Error: Cannot auto-register schema for specific version 3. Auto-registration only works with 'latest' version.
```

**Solution**: Change version to "latest" or disable auto-registration

### Schema Validation Errors

The node provides detailed error information for:

- **Schema validation failures**: When message doesn't match schema
- **Registry connection issues**: When Schema Registry is unreachable
- **Authentication failures**: When registry credentials are invalid
- **Schema not found**: When subject doesn't exist and auto-register is disabled

Error output example:

```json
{
  "error": "Schema validation failed: Field 'timestamp' is required but missing",
  "originalMessage": {...}
}
```

## Example Flows

### Basic Example Flow

```json
[
    {
        "id": "inject1",
        "type": "inject",
        "name": "Test Message",
        "props": [
            {
                "p": "payload",
                "v": "{\"id\":\"msg-001\",\"message\":\"Hello Avro!\",\"timestamp\":1640995200000}",
                "vt": "json"
            }
        ],
        "wires": [["schema-producer1"]]
    },
    {
        "id": "schema-producer1",
        "type": "hm-kafka-schema-producer",
        "name": "Publish with Schema",
        "broker": "broker1",
        "topic": "test-topic",
        "registryUrl": "http://localhost:8081",
        "schemaSubject": "test-topic-value",
        "autoRegister": true,
        "autoSchema": "{\"type\":\"record\",\"name\":\"TestMessage\",\"fields\":[{\"name\":\"id\",\"type\":\"string\"},{\"name\":\"message\",\"type\":\"string\"},{\"name\":\"timestamp\",\"type\":\"long\"}]}",
        "wires": [["debug1"]]
    },
    {
        "id": "debug1",
        "type": "debug",
        "name": "Output",
        "wires": []
    }
]
```

## Advanced Usage Examples

### Schema Validation Only

Configure the node with `validateOnly: true` to test schema validation without publishing:

```json
{
  "validateOnly": true
}
```

Output will include validation results:

```json
{
  "validated": true,
  "schemaId": 1,
  "originalData": {...},
  "encodedSize": 42
}
```

### Custom Schema with Complex Types

Example schema with optional fields and nested structures:

```json
{
  "type": "record",
  "name": "IoTSensorData",
  "fields": [
    {"name": "deviceId", "type": "string"},
    {"name": "timestamp", "type": "long"},
    {"name": "temperature", "type": "float"},
    {"name": "humidity", "type": ["null", "float"], "default": null},
    {
      "name": "location",
      "type": {
        "type": "record",
        "name": "Location",
        "fields": [
          {"name": "lat", "type": "double"},
          {"name": "lon", "type": "double"}
        ]
      }
    }
  ]
}
```

### Schema Registry Authentication

For secured Schema Registry instances:

```json
{
  "useRegistryAuth": true,
  "registryUsername": "your-username",
  "registryPassword": "your-password"
}
```

### Environment-Based Configuration

Use Node-RED context or environment variables for dynamic configuration:

```javascript
// In a function node before the schema producer
const environment = global.get("NODE_ENV") || "development";

if (environment === "production") {
    msg.schemaVersion = "3";  // Pin to stable version
} else {
    msg.schemaVersion = "latest";  // Use latest for dev
}

msg.registryUrl = global.get("SCHEMA_REGISTRY_URL");
msg.schemaSubject = global.get("SCHEMA_SUBJECT");
return msg;
```

## Best Practices

### Production Version Strategy

- **Pin versions in production**: Use specific version numbers
- **Test version compatibility**: Validate before upgrading
- **Coordinate upgrades**: Update all services together
- **Monitor compatibility**: Watch for schema evolution issues

### Development Version Strategy

- **Use "latest" for development**: Stay current with schema changes
- **Pin for integration tests**: Ensure consistent test results
- **Document version changes**: Track what changed between versions

### Schema Evolution Guidelines

- **Maintain backward compatibility**: Add optional fields with defaults
- **Plan forward compatibility**: Consider how consumers will handle new fields
- **Version your schemas semantically**: Major changes = new major version
- **Test compatibility thoroughly**: Validate producer/consumer combinations

### Performance Optimization

1. **Schema Caching**: The node caches schema IDs to avoid repeated registry calls
2. **Batch Processing**: Use with appropriate rate limiting for high-throughput scenarios
3. **Connection Pooling**: Reuse broker connections across multiple nodes

## Monitoring and Debugging

### Debug Information

Enable debug logging to see detailed operation information:

```text
[Kafka Schema Producer] Cache miss or version changed. Fetching schema for version: 3
[Kafka Schema Producer] Retrieved schema ID: 7 for subject: test-topic-value, version: 3
[Kafka Schema Producer] Using cached schema ID: 7 for version: 3
[Kafka Schema Producer] Message validated and encoded successfully
[Kafka Schema Producer] Message published successfully
```

### Status Messages

The node status shows which version is being used:

- `"Schema v3 retrieved"` - Successfully fetched specific version
- `"Schema latest retrieved"` - Successfully fetched latest version
- `"Using cached schema v3"` - Using cached version

## Troubleshooting

### Common Issues and Solutions

1. **"Schema not found"**: Ensure the subject exists in Schema Registry or enable auto-registration
2. **"Connection refused"**: Check Schema Registry URL and network connectivity
3. **"Validation failed"**: Verify message structure matches the registered schema
4. **"Authentication failed"**: Check registry credentials and permissions
5. **Performance issues**: Check if version caching is working correctly
6. **Compatibility issues**: Ensure all services use compatible versions

### Common Questions

**Q: Can I use version "0"?**  
A: No, versions must be positive integers starting from 1.

**Q: What happens if I change from "3" to "latest"?**  
A: The cache is invalidated and the latest schema is fetched on next message.

**Q: Can I use version ranges like ">=2"?**  
A: No, only exact versions or "latest" are supported.

**Q: How do I see what versions are available?**  
A: Check your Schema Registry web interface or use the REST API.

## Migration Guide

### From Version-Unaware Setup

If you're upgrading from a setup without version support:

1. **Current behavior**: Equivalent to `"schemaVersion": "latest"`
2. **No action needed**: Default behavior unchanged
3. **Optional**: Pin to specific versions for production stability

### Adding Version Control

1. **Identify current schema version** in Schema Registry
2. **Pin production nodes** to current version
3. **Test with specific versions** before upgrading
4. **Update gradually** across your infrastructure
