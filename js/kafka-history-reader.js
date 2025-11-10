module.exports = function(RED) {
    const { SchemaRegistry } = require('@kafkajs/confluent-schema-registry');
    const { CompressionTypes, CompressionCodecs } = require('kafkajs');

    // Register compression codecs
    // KafkaJS expects factory functions that return codec instances
    try {
        const SnappyCodec = require('kafkajs-snappy');
        CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec;  // Factory function
    } catch (error) {
        // Snappy codec not available
    }

    try {
        const LZ4Codec = require('kafkajs-lz4');
        CompressionCodecs[CompressionTypes.LZ4] = () => new LZ4Codec();  // Factory function wrapper
    } catch (error) {
        // LZ4 codec not available
    }

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

            // Parse configuration - simplified
            const maxMessages = parseInt(msg.maxMessages || config.maxMessages || 10);
            const offset = msg.offset !== undefined ? parseInt(msg.offset) : (config.offset !== undefined && config.offset !== '' ? parseInt(config.offset) : null);
            const direction = msg.direction || config.direction || 'forward';
            const timeoutMs = parseInt(msg.timeoutMs || 30000);
            const encoding = config.encoding || 'utf8';

            node.status({ fill: "blue", shape: "dot", text: "Reading history..." });
            
            if (offset === null) {
                node.error('[Kafka History Reader] Offset is required');
                node.status({ fill: "red", shape: "ring", text: "Offset required" });
                return;
            }
            
            node.debug(`[Kafka History Reader] Reading ${maxMessages} messages ${direction} from offset ${offset}`);

            try {
                const broker = RED.nodes.getNode(config.broker);
                const kafka = broker.getKafka();
                
                // Create temporary consumer with unique group
                const consumerGroupId = `history_reader_${Date.now()}_${generateUUID()}`;
                
                const tempConsumer = kafka.consumer({
                    groupId: consumerGroupId,
                    minBytes: 1,
                    maxBytes: 1048576,
                    maxWaitTimeInMs: 1000,
                    retry: {
                        initialRetryTime: 100,
                        retries: 8
                    }
                });

                await tempConsumer.connect();
                node.debug(`[Kafka History Reader] Connected with group: ${consumerGroupId}`);
                
                // Always start from beginning to have access to all messages
                await tempConsumer.subscribe({ 
                    topic: config.topic, 
                    fromBeginning: true
                });
                
                node.debug(`[Kafka History Reader] Subscribed to topic '${config.topic}', direction: ${direction}, target offset: ${offset}`);

                const foundMessages = [];
                let processedCount = 0;
                let offsetReached = false; // Para el modo backward
                const startTime = Date.now();
                let isReading = true;
                
                node.debug(`[Kafka History Reader] Starting to read ${direction} from offset ${offset} with timeout ${timeoutMs}ms`);
                
                // Set timeout
                const timeoutId = setTimeout(() => {
                    node.debug(`[Kafka History Reader] Timeout reached after ${timeoutMs}ms, processed ${processedCount} messages`);
                    isReading = false;
                }, timeoutMs);

                await tempConsumer.run({
                    eachMessage: async ({ topic, partition, message }) => {
                        if (!isReading) return;
                        
                        const messageOffset = parseInt(message.offset);
                        
                        if (direction === 'forward') {
                            // Forward: solo mensajes DESPUÉS del offset
                            if (messageOffset <= offset) return;
                        } else { // backward
                            // Backward: solo mensajes ANTES del offset
                            if (messageOffset >= offset) {
                                // Hemos llegado al offset, parar de leer
                                if (!offsetReached) {
                                    offsetReached = true;
                                    node.debug(`[Kafka History Reader] Reached target offset ${offset} in backward mode, stopping`);
                                    isReading = false;
                                }
                                return;
                            }
                        }
                        
                        try {
                            let decodedValue;
                            let rawValue = message.value ? message.value.toString(encoding) : '';
                            
                            // Debug: Log raw message for troubleshooting (first 200 chars)
                            node.debug(`[Kafka History Reader] Raw message value: ${rawValue.substring(0, 200)}...`);
                            
                            if (config.useSchemaValidation && node.schemaRegistry) {
                                decodedValue = await node.schemaRegistry.decode(message.value);
                            } else {
                                if (rawValue) {
                                    try {
                                        decodedValue = JSON.parse(rawValue);
                                    } catch (parseError) {
                                        node.debug(`[Kafka History Reader] JSON parse failed: ${parseError.message}, treating as plain text`);
                                        // If JSON parse fails, treat as plain text
                                        decodedValue = { content: rawValue };
                                    }
                                } else {
                                    decodedValue = {};
                                }
                            }
                            
                            const messageObj = {
                                payload: decodedValue,
                                topic: topic,
                                offset: message.offset,
                                partition: partition,
                                key: message.key ? message.key.toString() : null,
                                timestamp: message.timestamp,
                                isHistorical: true,
                                headers: message.headers || {}
                            };

                            foundMessages.push(messageObj);
                            
                            if (direction === 'forward') {
                                // Forward: parar cuando tengamos suficientes mensajes
                                if (foundMessages.length >= maxMessages) {
                                    node.debug(`[Kafka History Reader] Collected ${maxMessages} messages (forward), stopping`);
                                    isReading = false;
                                }
                            } else { // backward
                                // Backward: mantener solo los últimos N mensajes
                                if (foundMessages.length > maxMessages) {
                                    foundMessages.shift(); // Quitar el primer mensaje (más antiguo)
                                }
                            }
                            
                            processedCount++;
                            
                            // Log progress every 100 messages
                            if (processedCount % 100 === 0) {
                                node.debug(`[Kafka History Reader] Processed ${processedCount} messages so far, collected ${foundMessages.length} messages`);
                            }
                            
                        } catch (error) {
                            node.debug(`[Kafka History Reader] Error processing message: ${error.message}`);
                        }
                    }
                });

                // Wait for reading to complete or timeout
                let checkCount = 0;
                while (isReading && (Date.now() - startTime < timeoutMs)) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    checkCount++;
                    
                    // Log progress every 50 checks (5 seconds)
                    if (checkCount % 50 === 0) {
                        const elapsed = Date.now() - startTime;
                        node.debug(`[Kafka History Reader] Still reading... ${elapsed}ms elapsed, processed ${processedCount} messages, collected ${foundMessages.length} messages`);
                    }
                }
                
                clearTimeout(timeoutId);
                isReading = false;
                
                node.debug(`[Kafka History Reader] Finished reading. Processed ${processedCount} total messages, collected ${foundMessages.length} messages`);
                
                if (processedCount === 0) {
                    node.warn(`[Kafka History Reader] No messages were processed. Check if topic '${config.topic}' has messages and consumer has access.`);
                }
                
                // Disconnect the temporary consumer
                await tempConsumer.disconnect();
                node.debug(`[Kafka History Reader] Disconnected temporary consumer`);
                
                // Simple result - no complex filtering
                const summary = {
                    messageCount: foundMessages.length,
                    direction: direction,
                    fromOffset: offset,
                    processedTotal: processedCount
                };
                
                const outputMsg = {
                    ...msg,
                    payload: {
                        messages: foundMessages,
                        summary: summary,
                        request: {
                            maxMessages: maxMessages,
                            topic: config.topic,
                            direction: direction,
                            offset: offset,
                            totalProcessed: processedCount,
                            duration: Date.now() - startTime
                        }
                    }
                };
                
                const statusText = `${foundMessages.length} messages (${direction} from ${offset})`;
                node.status({ fill: "green", shape: "dot", text: statusText });
                node.debug(`[Kafka History Reader] Completed: ${statusText}, processed ${processedCount} total messages`);
                
                node.send(outputMsg);
                
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

    RED.nodes.registerType("oriolrius-kafka-history-reader", KafkaHistoryReaderNode);
};
