module.exports = function (RED) {
    const { SchemaRegistry } = require('@kafkajs/confluent-schema-registry');
    const { getNameTypes, getMsgValues } = require('./utils');

    function getIotOptions(config) {
        var options = new Object();

        if (config.useiot) {
            options = new Object();
            options.model = config.model;
            options.device = config.device;
            options.iotType = config.iotType;
            options.fields = config.fields;
        }

        return options;
    }

    function KafkaProducerNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        node.ready = false;
        node.schemaRegistry = null;
        node.cachedSchemaId = null;
        node.cachedSchemaVersion = null;
        node.lastMessageTime = null;
        node.messageCount = 0;

        let iotOptions = {};

        node.init = function () {
            const nodeType = config.useSchemaValidation ? 'Schema Producer' : 'Producer';
            const versionInfo = config.useSchemaValidation && config.schemaVersion && config.schemaVersion.trim() !== '' 
                ? ` (schema version: ${config.schemaVersion.trim()})` : '';
            node.debug(`[Kafka ${nodeType}] Initializing ${nodeType.toLowerCase()} for topic: ${config.topic}${versionInfo}`);
            node.status({ fill: "yellow", shape: "ring", text: "Initializing..." });
            
            let broker = RED.nodes.getNode(config.broker);
            if (!broker) {
                node.error(`[Kafka Schema Producer] No broker configuration found`);
                node.status({ fill: "red", shape: "ring", text: "No broker config" });
                return;
            }

            // Get IoT configuration from broker if available, otherwise use producer config
            if (broker && broker.getIotConfig) {
                const brokerIotConfig = broker.getIotConfig();
                if (brokerIotConfig.useiot) {
                    iotOptions = brokerIotConfig;
                    node.debug(`[Kafka Producer] Using IoT configuration from broker`);
                } else {
                    iotOptions = getIotOptions(config);
                    node.debug(`[Kafka Producer] Using IoT configuration from producer`);
                }
            } else {
                iotOptions = getIotOptions(config);
                node.debug(`[Kafka Producer] Using producer IoT configuration`);
            }
            
            // Initialize Schema Registry only if schema validation is enabled
            if (config.useSchemaValidation) {
                node.status({ fill: "yellow", shape: "ring", text: "Connecting to Schema Registry..." });
            try {
                const registryConfig = {
                    host: config.registryUrl,
                    clientId: 'node-red-schema-producer',
                    retry: {
                        retries: 3,
                        factor: 2,
                        multiplier: 1000,
                        maxRetryTimeInSecs: 60
                    }
                };

                // Add authentication if configured
                if (config.useRegistryAuth && config.registryUsername && config.registryPassword) {
                    registryConfig.auth = {
                        username: config.registryUsername,
                        password: config.registryPassword,
                    };
                    node.debug(`[Kafka Schema Producer] Schema Registry auth configured for user: ${config.registryUsername}`);
                }

                node.schemaRegistry = new SchemaRegistry(registryConfig);
                node.debug(`[Kafka Schema Producer] Schema Registry client created for: ${config.registryUrl}`);
                node.status({ fill: "yellow", shape: "ring", text: "Registry connected" });
                } catch (error) {
                    node.error(`[Kafka Schema Producer] Failed to create Schema Registry client: ${error.message}`);
                    node.status({ fill: "red", shape: "ring", text: `Registry failed: ${error.message.substring(0, 10)}...` });
                    return;
                }
            } else {
                node.debug(`[Kafka Producer] Schema validation disabled, skipping Schema Registry setup`);
            }

            // Get Kafka client from broker
            node.status({ fill: "yellow", shape: "ring", text: "Connecting to Kafka..." });
            try {
                const kafka = broker.getKafka();
                node.debug(`[Kafka Schema Producer] Kafka instance obtained successfully`);
                
                const producer = kafka.producer({
                    maxInFlightRequests: 1,
                    idempotent: config.requireAcks === 1,
                    requestTimeout: config.ackTimeoutMs || 100
                });

                producer.connect().then(() => {
                    node.debug(`[Kafka Schema Producer] Producer ready and connected to Kafka broker`);
                    node.ready = true;
                    node.lastMessageTime = new Date().getTime();
                    node.messageCount = 0;
                    node.status({ fill: "green", shape: "ring", text: "Ready" });
                    
                    // Set up producer event handlers
                    producer.on('producer.connect', () => {
                        node.debug(`[Kafka Schema Producer] Producer connected to Kafka`);
                        node.status({ fill: "green", shape: "ring", text: "Connected" });
                    });

                    producer.on('producer.disconnect', () => {
                        node.debug(`[Kafka Schema Producer] Producer disconnected from Kafka`);
                        node.status({ fill: "red", shape: "ring", text: "Disconnected" });
                        node.ready = false;
                        node.lastMessageTime = null;
                        node.messageCount = 0;
                    });

                    // Store producer reference
                    node.producer = producer;

                }).catch(error => {
                    node.error(`[Kafka Schema Producer] Failed to connect producer: ${error.message}`, error);
                    node.status({ fill: "red", shape: "ring", text: `Connect failed: ${error.message.substring(0, 15)}...` });
                    node.ready = false;
                    node.lastMessageTime = null;
                });

            } catch (error) {
                node.error(`[Kafka Schema Producer] Failed to get Kafka instance: ${error.message}`, error);
                node.status({ fill: "red", shape: "ring", text: `Kafka failed: ${error.message.substring(0, 10)}...` });
                node.ready = false;
                node.lastMessageTime = null;
            }
        };

        node.getOrRegisterSchema = async function() {
            try {
                const version = config.schemaVersion && config.schemaVersion.trim() !== '' ? config.schemaVersion.trim() : 'latest';
                
                // Check if we have a cached schema for the current version
                if (node.cachedSchemaId && node.cachedSchemaVersion === version) {
                    node.debug(`[Kafka Schema Producer] Using cached schema ID: ${node.cachedSchemaId} for version: ${version}`);
                    node.status({ fill: "blue", shape: "ring", text: `Using cached schema v${version}` });
                    return node.cachedSchemaId;
                }

                // Cache miss or version changed - fetch schema
                node.debug(`[Kafka Schema Producer] Cache miss or version changed. Fetching schema for version: ${version}`);
                node.status({ fill: "blue", shape: "ring", text: "Getting schema..." });
                try {
                    let schemaId;
                    
                    if (version === 'latest') {
                        schemaId = await node.schemaRegistry.getLatestSchemaId(config.schemaSubject);
                        node.debug(`[Kafka Schema Producer] Retrieved latest schema ID: ${schemaId} for subject: ${config.schemaSubject}`);
                    } else {
                        // Get specific version
                        const versionNumber = parseInt(version);
                        if (isNaN(versionNumber) || versionNumber <= 0) {
                            throw new Error(`Invalid schema version: ${version}. Must be 'latest' or a positive integer.`);
                        }
                        
                        schemaId = await node.schemaRegistry.getRegistryId(config.schemaSubject, versionNumber);
                        node.debug(`[Kafka Schema Producer] Retrieved schema ID: ${schemaId} for subject: ${config.schemaSubject}, version: ${versionNumber}`);
                    }
                    
                    // Cache the schema ID and version
                    node.cachedSchemaId = schemaId;
                    node.cachedSchemaVersion = version;
                    node.status({ fill: "blue", shape: "ring", text: `Schema v${version} retrieved` });
                    return schemaId;
                } catch (error) {
                    node.debug(`[Kafka Schema Producer] Schema not found: ${error.message}`);
                    
                    // If auto-register is enabled, register the schema
                    if (config.autoRegister && config.autoSchema) {
                        // Only allow auto-registration for 'latest' version
                        if (version !== 'latest') {
                            throw new Error(`Cannot auto-register schema for specific version ${version}. Auto-registration only works with 'latest' version.`);
                        }
                        
                        node.debug(`[Kafka Schema Producer] Auto-registering schema for subject: ${config.schemaSubject}`);
                        node.status({ fill: "blue", shape: "ring", text: "Registering schema..." });
                        
                        let schemaObject;
                        try {
                            schemaObject = JSON.parse(config.autoSchema);
                        } catch (parseError) {
                            throw new Error(`Invalid schema JSON: ${parseError.message}`);
                        }

                        const registeredSchema = await node.schemaRegistry.register({
                            type: 'AVRO',
                            schema: JSON.stringify(schemaObject)
                        }, {
                            subject: config.schemaSubject
                        });
                        
                        // Cache the registered schema
                        node.cachedSchemaId = registeredSchema.id;
                        node.cachedSchemaVersion = version;
                        node.debug(`[Kafka Schema Producer] Registered new schema with ID: ${registeredSchema.id}`);
                        node.status({ fill: "blue", shape: "ring", text: "Schema registered" });
                        return registeredSchema.id;
                    } else {
                        throw new Error(`Schema not found for subject ${config.schemaSubject}, version ${version}, and auto-register is disabled`);
                    }
                }
            } catch (error) {
                node.error(`[Kafka Schema Producer] Schema operation failed: ${error.message}`);
                throw error;
            }
        };

        node.on('input', async function (msg) {
            const nodeType = config.useSchemaValidation ? 'Schema Producer' : 'Producer';
            node.debug(`[Kafka ${nodeType}] Received input message`);
            
            if (!node.ready) {
                node.warn(`[Kafka ${nodeType}] Producer not ready, discarding message`);
                node.status({ fill: "yellow", shape: "ring", text: "Not ready" });
                return;
            }

            try {
                let messageData = msg.payload;
                let encodedMessage;
                let schemaId = null;

                // Handle schema validation if enabled
                if (config.useSchemaValidation) {
                    node.status({ fill: "blue", shape: "dot", text: "Validating schema" });
                    
                    // Get or register schema
                    schemaId = await node.getOrRegisterSchema();
                    
                    // Prepare message data for schema validation
                    if (typeof messageData === 'string') {
                        try {
                            messageData = JSON.parse(messageData);
                        } catch (parseError) {
                            node.error(`[Kafka Schema Producer] Failed to parse message payload as JSON: ${parseError.message}`);
                            node.status({ fill: "red", shape: "ring", text: "Parse error" });
                            return;
                        }
                    }

                    node.debug(`[Kafka Schema Producer] Message data to validate:`, messageData);

                    // Encode message with schema validation
                    node.status({ fill: "blue", shape: "dot", text: "Encoding message" });
                    try {
                        encodedMessage = await node.schemaRegistry.encode(schemaId, messageData);
                        node.debug(`[Kafka Schema Producer] Message validated and encoded successfully`);
                    } catch (encodeError) {
                        node.error(`[Kafka Schema Producer] Schema validation failed: ${encodeError.message}`);
                        node.status({ fill: "red", shape: "ring", text: "Validation failed" });
                        node.send([null, { payload: { error: encodeError.message, data: messageData } }]);
                        return;
                    }

                    // If validate-only mode, return the validated data without publishing
                    if (config.validateOnly) {
                        node.debug(`[Kafka Schema Producer] Validation-only mode, not publishing to Kafka`);
                        node.messageCount++;
                        node.status({ fill: "green", shape: "dot", text: `Validated ${node.messageCount} messages` });
                        msg.payload = { 
                            validated: true, 
                            schemaId: schemaId, 
                            originalData: messageData,
                            encodedSize: encodedMessage.length
                        };
                        node.send(msg);
                        return;
                    }
                } else {
                    // No schema validation - handle IoT formatting and prepare message
                    node.status({ fill: "blue", shape: "dot", text: "Preparing message" });
                    
                    if (iotOptions.useiot) {
                        if (msg.broker && msg.broker.model && msg.broker.device) {
                            iotOptions.model = msg.broker.model;
                            iotOptions.device = msg.broker.device;
                        }
                        
                        const nameTypes = getNameTypes(iotOptions.fields);
                        const msgValues = getMsgValues(messageData, iotOptions.fields);
                        
                        messageData = {
                            mc: iotOptions.model,
                            dc: iotOptions.device,
                            type: iotOptions.iotType,
                            nameTypes: nameTypes,
                            ts: [new Date().getTime()],
                            values: [msgValues]
                        };
                        
                        node.debug(`[Kafka Producer] IoT formatted message:`, messageData);
                    }
                    
                    // For non-schema mode, serialize message as JSON
                    if (typeof messageData === 'object') {
                        encodedMessage = JSON.stringify(messageData);
                    } else {
                        encodedMessage = messageData;
                    }
                }

                // Prepare Kafka message
                const kafkaMessage = {
                    topic: config.topic,
                    messages: [
                        {
                            key: msg.key || (messageData && messageData.id ? messageData.id.toString() : null),
                            value: encodedMessage,
                            timestamp: msg.timestamp || Date.now().toString(),
                            headers: msg.headers || {}
                        },
                    ],
                };

                // Send to Kafka
                node.status({ fill: "blue", shape: "dot", text: "Sending to Kafka" });
                node.debug(`[Kafka ${nodeType}] Publishing message to topic: ${config.topic}`);
                const result = await node.producer.send(kafkaMessage);
                
                node.debug(`[Kafka ${nodeType}] Message published successfully`);
                node.lastMessageTime = new Date().getTime();
                node.messageCount++;
                node.status({ fill: "green", shape: "dot", text: `Sent ${node.messageCount} messages` });
                
                // Send success response
                const responsePayload = {
                    success: true,
                    kafkaResult: result,
                    originalData: messageData,
                    topic: config.topic
                };
                
                if (config.useSchemaValidation) {
                    responsePayload.schemaId = schemaId;
                }
                
                msg.payload = responsePayload;
                node.send(msg);

            } catch (error) {
                const nodeType = config.useSchemaValidation ? 'Schema Producer' : 'Producer';
                node.error(`[Kafka ${nodeType}] Error processing message: ${error.message}`, error);
                node.status({ fill: "red", shape: "ring", text: `Error: ${error.message.substring(0, 15)}...` });
                node.lastMessageTime = null;
                node.send([null, { payload: { error: error.message, originalMessage: msg } }]);
            }
        });

        // Function to check for idle state and update status
        function checkLastMessageTime() {
            if (node.lastMessageTime != null && node.ready) {
                const timeDiff = new Date().getTime() - node.lastMessageTime;
                if (timeDiff > 5000) {
                    const idleSeconds = Math.floor(timeDiff/1000);
                    const countText = node.messageCount > 0 ? ` (${node.messageCount} sent)` : '';
                    node.debug(`[Kafka Schema Producer] Producer idle for ${timeDiff}ms`);
                    node.status({ fill: "yellow", shape: "ring", text: `Idle ${idleSeconds}s${countText}` });
                }
            }
        }

        // Start idle monitoring
        node.interval = setInterval(checkLastMessageTime, 1000);

        node.on('close', function (done) {
            node.debug(`[Kafka Schema Producer] Closing node`);
            node.ready = false;
            node.status({});
            node.lastMessageTime = null;
            node.messageCount = 0;
            node.cachedSchemaId = null;
            node.cachedSchemaVersion = null;
            clearInterval(node.interval);
            
            if (node.producer) {
                node.producer.disconnect().then(() => {
                    node.debug(`[Kafka Schema Producer] Producer disconnected`);
                    done();
                }).catch(error => {
                    node.error(`[Kafka Schema Producer] Error disconnecting producer: ${error.message}`);
                    done();
                });
            } else {
                done();
            }
        });

        // Initialize the node
        node.init();
    }

    RED.nodes.registerType("hm-kafka-producer", KafkaProducerNode);
};
