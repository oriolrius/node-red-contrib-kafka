# Kafka History Reader Guide

## Overview

The `hm-kafka-history-reader` node allows you to retrieve historical messages of specific types from a Kafka topic. This is particularly useful when you need to get the last known values of certain message types before starting real-time consumption.

## Key Features

- **Type-specific filtering**: Search for specific message types within a topic
- **Configurable message limits**: Control how many messages to retrieve per type
- **Non-intrusive reading**: Uses temporary consumer groups that don't affect your main consumers
- **Schema Registry support**: Works with Confluent Schema Registry for Avro messages
- **Flexible message type detection**: Automatically detects message types from various fields
- **Timeout protection**: Prevents indefinite reading with configurable timeouts

## Configuration

### Basic Settings

- **Name**: Optional display name for the node
- **Broker**: Reference to your Kafka broker configuration node
- **Topic**: The Kafka topic to read historical messages from
- **Message Types**: Comma-separated list of message types to search for (e.g., `sensor-data,status-update,alert`)
- **Max Messages per Type**: Maximum number of recent messages to retrieve for each type (1-1000)
- **From Offset**: Start reading from `earliest` (beginning of topic) or `latest` (recent messages only)
- **Encoding**: Message encoding format (UTF-8, ASCII, Base64, Hex)

### Schema Validation (Optional)

- **Enable Schema Validation**: Check this to use Confluent Schema Registry
- **Schema Registry URL**: URL of your Schema Registry (e.g., `http://localhost:8081`)
- **Use Authentication**: Enable if your Schema Registry requires authentication
- **Username/Password**: Credentials for Schema Registry access

## Message Type Detection

The node automatically detects message types by looking for these fields in the message payload (in order of priority):

1. `type`
2. `messageType`
3. `eventType`
4. `kind`
5. `msgType`

If none of these fields are found, the message type is set to `"unknown"`.

## Input Message

You can trigger the history reader by sending a message with optional parameters:

```javascript
{
    "messageTypes": "sensor-data,alert",  // Override config
    "maxMessages": 5,                     // Override config  
    "fromOffset": "earliest",             // Override config
    "timeoutMs": 15000                    // Reading timeout in ms
}
```

## Output Message

The node outputs a message with the following structure:

```javascript
{
    "payload": {
        "historicalMessages": {
            "sensor-data": [
                {
                    "payload": { /* actual message content */ },
                    "topic": "my-topic",
                    "offset": "12345",
                    "partition": 0,
                    "key": "sensor-001",
                    "timestamp": "1640995200000",
                    "messageType": "sensor-data",
                    "isHistorical": true,
                    "headers": { /* message headers */ }
                }
                // ... more messages
            ],
            "alert": [
                // ... alert messages
            ]
        },
        "summary": {
            "totalTypes": 2,
            "totalMessages": 8,
            "typeDetails": {
                "sensor-data": {
                    "count": 5,
                    "latestTimestamp": 1640995200000
                },
                "alert": {
                    "count": 3,
                    "latestTimestamp": 1640995100000
                }
            }
        },
        "request": {
            "messageTypes": ["sensor-data", "alert"],
            "maxMessages": 5,
            "topic": "my-topic",
            "fromOffset": "earliest",
            "totalProcessed": 1250,
            "duration": 2341
        }
    }
}
```

## Usage Examples

### Example 1: Basic Historical Read

1. **Configure the node**:
   - Topic: `iot-messages`
   - Message Types: `temperature,humidity,motion`
   - Max Messages per Type: `10`

2. **Connect an inject node** to trigger the historical read

3. **Process the results** before starting your real-time consumer

### Example 2: Integration with Real-time Consumer

```
[Inject] → [History Reader] → [Function] → [Real-time Consumer]
                                ↓
                          [Process Historical] → [Dashboard]
```

The function node can separate historical and real-time messages:

```javascript
if (msg.payload.historicalMessages) {
    // Process historical messages
    for (const [type, messages] of Object.entries(msg.payload.historicalMessages)) {
        for (const message of messages) {
            // Send historical message with special flag
            node.send([{
                payload: message.payload,
                isHistorical: true,
                messageType: type
            }, null]);
        }
    }
    // Trigger real-time consumer
    node.send([null, { start: true }]);
} else {
    // Forward real-time messages
    node.send([msg, null]);
}
```

### Example 3: Dynamic Message Type Search

Send different message types dynamically:

```javascript
// Search for device status messages
msg.messageTypes = "device-online,device-offline";
msg.maxMessages = 1; // Just the latest status
return msg;
```

## Best Practices

### 1. Consumer Group Management
- The node creates temporary consumer groups with unique IDs
- These don't interfere with your main application consumers
- Consumer groups are automatically cleaned up after use

### 2. Performance Considerations
- Use reasonable message limits to avoid long reading times
- Set appropriate timeouts for large topics
- Consider using `fromOffset: "latest"` for recent messages only

### 3. Error Handling
- The node includes timeout protection (default 30 seconds)
- Failed message parsing doesn't stop the entire process
- Comprehensive error logging for debugging

### 4. Memory Usage
- Messages are kept in memory during processing
- Limit `maxMessages` for topics with large messages
- The node automatically releases resources after completion

## Troubleshooting

### No Messages Found
- Check that message types match exactly (case-sensitive)
- Verify the topic contains messages with the expected type fields
- Try `fromOffset: "earliest"` to search from the beginning

### Timeout Issues
- Increase `timeoutMs` for large topics
- Reduce `maxMessages` to speed up processing
- Check Kafka broker connectivity

### Schema Registry Errors
- Verify Schema Registry URL is accessible
- Check authentication credentials if enabled
- Ensure messages in the topic are Avro-encoded

### Memory Issues
- Reduce `maxMessages` per type
- Process results immediately rather than storing
- Use pagination for very large result sets

## Integration Notes

This node is designed to work seamlessly with the existing Kafka nodes:

- **hm-kafka-broker**: Shared broker configuration
- **hm-kafka-consumer**: For real-time message consumption
- **hm-kafka-producer**: For sending responses based on historical data

The history reader complements rather than replaces the standard consumer, providing a complete solution for both historical and real-time Kafka message processing.
