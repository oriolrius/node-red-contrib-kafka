module.exports = function(RED) {
    const { SchemaRegistry } = require('@kafkajs/confluent-schema-registry');

    function KafkaHistoryReaderNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        node.ready = false;

        // Generate UUID for unique consumer groups
        function generateUUID() {
            return 'xxxx-xxxx-4xxx-yxxx-xxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
            });
        }

        node.init = function() {
            node.debug(`[Kafka History Reader] Initializing for topic: ${config.topic}`);
            node.status({ fill: "yellow", shape: "ring", text: "Initializing..." });
            
            var broker = RED.nodes.getNode(config.broker);
            if (!broker) {
                node.error(`[Kafka History Reader] No broker configuration found`);
                node.status({ fill: "red", shape: "ring", text: "No broker config" });
                return;
            }

            // Initialize Schema Registry if needed
            if (config.useSchemaValidation && config.registryUrl) {
                try {
                    const registryConfig = {
                        host: config.registryUrl,
                        clientId: 'node-red-history-reader'
                    };
                    
                    if (config.useRegistryAuth && config.registryUsername && config.registryPassword) {
                        registryConfig.auth = {
                            username: config.registryUsername,
                            password: config.registryPassword
                        };
                    }
                    
                    node.schemaRegistry = new SchemaRegistry(registryConfig);
                    node.debug(`[Kafka History Reader] Schema Registry initialized`);
                } catch (error) {
                    node.error(`[Kafka History Reader] Schema Registry initialization failed: ${error.message}`);
                    node.status({ fill: "red", shape: "ring", text: "Schema Registry error" });
                    return;
                }
            }

            node.ready = true;
            node.status({ fill: "green", shape: "ring", text: "Ready" });
        };

        node.on('input', async function(msg) {
            if (!node.ready) {
                node.warn(`[Kafka History Reader] Not ready, discarding message`);
                return;
            }

            // Parse message types from config or message
            const messageTypesStr = msg.messageTypes || config.messageTypes || '';
            const messageTypes = messageTypesStr.split(',').map(t => t.trim()).filter(t => t.length > 0);
            const maxMessages = parseInt(msg.maxMessages || config.maxMessages || 10);
            const fromOffset = msg.fromOffset || config.fromOffset || 'earliest';
            const encoding = config.encoding || 'utf8';
            
            if (messageTypes.length === 0) {
                node.error(`[Kafka History Reader] No message types specified`);
                return;
            }

            node.status({ fill: "blue", shape: "dot", text: "Reading history..." });
            node.debug(`[Kafka History Reader] Searching for message types: ${messageTypes.join(', ')}, max ${maxMessages} per type`);

            try {
                const broker = RED.nodes.getNode(config.broker);
                const kafka = broker.getKafka();
                
                // Create temporary consumer with unique group
                const consumerGroupId = `history_reader_${Date.now()}_${generateUUID()}`;
                const tempConsumer = kafka.consumer({ 
                    groupId: consumerGroupId,
                    minBytes: 1,
                    maxBytes: 1048576,
                    maxWaitTimeInMs: 1000
                });

                await tempConsumer.connect();
                node.debug(`[Kafka History Reader] Connected with group: ${consumerGroupId}`);
                
                await tempConsumer.subscribe({ 
                    topic: config.topic, 
                    fromBeginning: fromOffset === 'earliest'
                });

                const foundMessages = new Map();
                let processedCount = 0;
                const startTime = Date.now();
                const timeoutMs = parseInt(msg.timeoutMs || 30000); // 30 seconds default
                let isReading = true;
                
                // Set timeout
                const timeoutId = setTimeout(() => {
                    isReading = false;
                    node.debug(`[Kafka History Reader] Timeout reached after ${timeoutMs}ms`);
                }, timeoutMs);

                await tempConsumer.run({
                    eachMessage: async ({ topic, partition, message }) => {
                        if (!isReading) return;
                        
                        try {
                            let decodedValue;
                            
                            if (config.useSchemaValidation && node.schemaRegistry) {
                                decodedValue = await node.schemaRegistry.decode(message.value);
                            } else {
                                const valueStr = message.value ? message.value.toString(encoding) : '';
                                if (valueStr) {
                                    try {
                                        decodedValue = JSON.parse(valueStr);
                                    } catch (parseError) {
                                        // If JSON parse fails, treat as plain text
                                        decodedValue = { content: valueStr };
                                    }
                                } else {
                                    decodedValue = {};
                                }
                            }
                            
                            // Determine message type - check multiple possible fields
                            const messageType = decodedValue.type || 
                                              decodedValue.messageType || 
                                              decodedValue.eventType ||
                                              decodedValue.kind ||
                                              decodedValue.msgType ||
                                              'unknown';
                            
                            if (messageTypes.includes(messageType)) {
                                if (!foundMessages.has(messageType)) {
                                    foundMessages.set(messageType, []);
                                }
                                
                                const messageObj = {
                                    payload: decodedValue,
                                    topic: topic,
                                    offset: message.offset,
                                    partition: partition,
                                    key: message.key ? message.key.toString() : null,
                                    timestamp: message.timestamp,
                                    messageType: messageType,
                                    isHistorical: true,
                                    headers: message.headers || {}
                                };
                                
                                const messages = foundMessages.get(messageType);
                                messages.push(messageObj);
                                
                                // Keep only the last N messages per type (FIFO)
                                if (messages.length > maxMessages) {
                                    messages.shift();
                                }
                                
                                node.debug(`[Kafka History Reader] Found message of type '${messageType}', total for this type: ${messages.length}`);
                            }
                            
                            processedCount++;
                            
                            // Check if we have enough messages for all types
                            let allTypesSatisfied = true;
                            for (const type of messageTypes) {
                                if (!foundMessages.has(type) || foundMessages.get(type).length < maxMessages) {
                                    allTypesSatisfied = false;
                                    break;
                                }
                            }
                            
                            if (allTypesSatisfied) {
                                node.debug(`[Kafka History Reader] All message types satisfied, stopping early`);
                                isReading = false;
                            }
                            
                        } catch (error) {
                            node.debug(`[Kafka History Reader] Error processing message: ${error.message}`);
                        }
                    }
                });

                // Wait for reading to complete or timeout
                while (isReading && (Date.now() - startTime < timeoutMs)) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                
                clearTimeout(timeoutId);
                isReading = false;
                
                // Disconnect the temporary consumer
                await tempConsumer.disconnect();
                node.debug(`[Kafka History Reader] Disconnected temporary consumer`);
                
                // Prepare result
                const result = {};
                const summary = {
                    totalTypes: foundMessages.size,
                    totalMessages: 0,
                    typeDetails: {}
                };
                
                foundMessages.forEach((messages, type) => {
                    result[type] = messages;
                    summary.totalMessages += messages.length;
                    summary.typeDetails[type] = {
                        count: messages.length,
                        latestTimestamp: messages.length > 0 ? Math.max(...messages.map(m => parseInt(m.timestamp))) : null
                    };
                });
                
                // Add any missing types as empty arrays
                messageTypes.forEach(type => {
                    if (!result[type]) {
                        result[type] = [];
                        summary.typeDetails[type] = { count: 0, latestTimestamp: null };
                    }
                });
                
                // Prepare output message
                const outputMsg = {
                    ...msg,
                    payload: {
                        historicalMessages: result,
                        summary: summary,
                        request: {
                            messageTypes: messageTypes,
                            maxMessages: maxMessages,
                            topic: config.topic,
                            fromOffset: fromOffset,
                            totalProcessed: processedCount,
                            duration: Date.now() - startTime
                        }
                    }
                };
                
                node.send(outputMsg);
                
                const statusText = `Found ${summary.totalTypes}/${messageTypes.length} types (${summary.totalMessages} msgs)`;
                node.status({ fill: "green", shape: "dot", text: statusText });
                
                node.debug(`[Kafka History Reader] Completed: ${statusText}, processed ${processedCount} total messages`);
                
                // Return to ready state after a short delay
                setTimeout(() => {
                    node.status({ fill: "green", shape: "ring", text: "Ready" });
                }, 3000);

            } catch (error) {
                node.error(`[Kafka History Reader] Error: ${error.message}`);
                node.status({ fill: "red", shape: "ring", text: `Error: ${error.message.substring(0, 20)}...` });
                
                // Return to ready state after error
                setTimeout(() => {
                    if (node.ready) {
                        node.status({ fill: "green", shape: "ring", text: "Ready" });
                    }
                }, 5000);
            }
        });

        node.on('close', function(done) {
            node.ready = false;
            node.status({});
            if (node.schemaRegistry) {
                node.schemaRegistry = null;
            }
            done();
        });

        // Initialize the node
        node.init();
    }

    RED.nodes.registerType("hm-kafka-history-reader", KafkaHistoryReaderNode);
};
