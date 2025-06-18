module.exports = function(RED) {
    const { SchemaRegistry } = require('@kafkajs/confluent-schema-registry');

    function KafkaConsumerNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        node.ready = false;
        node.schemaRegistry = null;
        node.cachedSchemas = new Map(); // Cache schemas by ID for performance
        node.lastMessageTime = null;
        node.messageCount = 0;
        node.errorCount = 0;

        function generateUUID() {
            var u='',i=0;
            while(i++<36) {
                var c='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'[i-1],r=Math.random()*16|0,v=c=='x'?r:(r&0x3|0x8);
                u+=(c=='-'||c=='4')?c:v.toString(16)
            }
            return u;
        }
            
        node.init = async function(){
            const nodeType = config.useSchemaValidation ? 'Schema Consumer' : 'Consumer';
            node.debug(`[Kafka ${nodeType}] Initializing ${nodeType.toLowerCase()} for topic: ${config.topic}`);
            node.status({fill:"yellow",shape:"ring",text:"Initializing..."});

            var broker = RED.nodes.getNode(config.broker);
            if (!broker) {
                node.error(`[Kafka ${nodeType}] No broker configuration found`);
                node.status({fill:"red",shape:"ring",text:"No broker config"});
                return;
            }

            // Initialize Schema Registry only if schema validation is enabled
            if (config.useSchemaValidation) {
                node.status({fill:"yellow",shape:"ring",text:"Connecting to Schema Registry..."});
                try {
                    const registryConfig = {
                        host: config.registryUrl,
                        clientId: 'node-red-schema-consumer',
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
                        node.debug(`[Kafka Schema Consumer] Schema Registry auth configured for user: ${config.registryUsername}`);
                    }

                    node.schemaRegistry = new SchemaRegistry(registryConfig);
                    node.debug(`[Kafka Schema Consumer] Schema Registry client created for: ${config.registryUrl}`);
                } catch (error) {
                    node.error(`[Kafka Schema Consumer] Failed to create Schema Registry client: ${error.message}`);
                    node.status({fill:"red",shape:"ring",text:`Registry failed: ${error.message.substring(0, 15)}...`});
                    return;
                }

                // Get or register schema if needed
                try {
                    await node.getOrRegisterSchema();
                    node.status({fill:"yellow",shape:"ring",text:"Schema validated"});
                } catch (error) {
                    node.error(`[Kafka Schema Consumer] Schema validation failed: ${error.message}`);
                    node.status({fill:"red",shape:"ring",text:`Schema failed: ${error.message.substring(0, 15)}...`});
                    return;
                }
            } else {
                node.debug(`[Kafka Consumer] Schema validation disabled, skipping Schema Registry setup`);
            }

            const kafka = broker.getKafka();
            const topic = config.topic;
    
            const groupId = 'nodered_hm_kafka_client_' + (!config.groupid || config.groupid === '' ? generateUUID() : config.groupid);
            
            node.debug(`[Kafka ${nodeType}] Consumer group ID: ${groupId}`);
            node.debug(`[Kafka ${nodeType}] From offset: ${config.fromOffset}`);
            node.debug(`[Kafka ${nodeType}] Out of range offset: ${config.outOfRangeOffset}`);
            node.debug(`[Kafka ${nodeType}] Fetch min bytes: ${config.minbytes || 1}`);
            node.debug(`[Kafka ${nodeType}] Fetch max bytes: ${config.maxbytes || 1048576}`);
            node.debug(`[Kafka ${nodeType}] Encoding: ${config.encoding || 'utf8'}`);

            node.lastMessageTime = null;

            try {
                node.consumer = kafka.consumer({ 
                    groupId: groupId,
                    minBytes: config.minbytes || 1,
                    maxBytes: config.maxbytes || 1048576
                });
                node.debug(`[Kafka ${nodeType}] Consumer created successfully`);
            } catch (err) {
                node.error(`[Kafka ${nodeType}] Failed to create Consumer: ${err.message}`);
                node.status({fill:"red",shape:"ring",text:"Failed to create consumer"});
                return;
            }
    
            node.status({fill:"yellow",shape:"ring",text:"Connecting to Kafka..."});

            node.onConnect = function(){
                node.lastMessageTime = new Date().getTime();
                node.debug(`[Kafka ${nodeType}] Successfully connected to Kafka broker`);
                node.status({fill:"green",shape:"ring",text:"Ready"});
                node.ready = true;
            }
 
            node.onError = function(err){
                node.lastMessageTime = null;
                node.ready = false;
                node.error(`[Kafka ${nodeType}] Connection error: ${err.message}`);
                node.debug(`[Kafka ${nodeType}] Full error details: ${JSON.stringify(err, null, 2)}`);
                node.status({fill:"red",shape:"ring",text:"Error"});
                node.error(err);
            } 
            
            node.onMessage = async function({ topic, partition, message }){
                const messageStartTime = Date.now();
                node.lastMessageTime = messageStartTime;
                const nodeType = config.useSchemaValidation ? 'Schema Consumer' : 'Consumer';
                node.debug(`[Kafka ${nodeType}] Received message from topic ${topic}, partition ${partition}, offset ${message.offset}`);
                
                try {
                    let decodedValue;
                    
                    if (config.useSchemaValidation) {
                        // Decode the Avro message
                        decodedValue = await node.schemaRegistry.decode(message.value);
                        node.debug(`[Kafka Schema Consumer] Message decoded successfully`);
                    } else {
                        // Parse as regular JSON or use raw value
                        if (message.value) {
                            try {
                                const valueStr = message.value.toString(config.encoding || 'utf8');
                                decodedValue = JSON.parse(valueStr);
                            } catch (parseError) {
                                // If JSON parsing fails, use raw string
                                decodedValue = message.value.toString(config.encoding || 'utf8');
                            }
                        } else {
                            decodedValue = null;
                        }
                        node.debug(`[Kafka Consumer] Message processed`);
                    }
                    
                    const processingTime = Date.now() - messageStartTime;
                    node.debug(`[Kafka ${nodeType}] Decoded value: ${JSON.stringify(decodedValue)}`);
                    
                    // Create message object
                    let messageObj = {
                        payload: decodedValue,
                        topic: topic,
                        offset: message.offset,
                        partition: partition,
                        highWaterOffset: message.highWaterOffset,
                        key: message.key ? message.key.toString() : null,
                        timestamp: message.timestamp
                    };
                    
                    node.send(messageObj);
                    node.messageCount++;
                    node.status({fill:"blue",shape:"ring",text:`Reading (${node.messageCount})`});

                } catch (decodeError) {
                    node.errorCount++;
                    const nodeType = config.useSchemaValidation ? 'Schema Consumer' : 'Consumer';
                    node.error(`[Kafka ${nodeType}] Failed to decode message: ${decodeError.message}`);
                    node.debug(`[Kafka ${nodeType}] Decode error details: ${JSON.stringify(decodeError, null, 2)}`);
                    
                    // Create error message
                    const errorMsg = {
                        payload: null,
                        error: {
                            message: decodeError.message,
                            type: config.useSchemaValidation ? 'SCHEMA_DECODE_ERROR' : 'MESSAGE_DECODE_ERROR',
                            kafkaMessage: {
                                topic: topic,
                                partition: partition,
                                offset: message.offset,
                                key: message.key ? message.key.toString() : null,
                                timestamp: message.timestamp,
                                rawValue: message.value
                            }
                        }
                    };
                    
                    node.send(errorMsg);
                    node.status({fill:"yellow",shape:"ring",text:`Reading (${node.messageCount}, ${node.errorCount} errors)`});
                }
            }

            function checkLastMessageTime() {
                if(node.lastMessageTime != null && node.ready){
                    timeDiff = new Date().getTime() - node.lastMessageTime;
                    if(timeDiff > 5000){
                        node.debug(`[Kafka ${nodeType}] Consumer idle for ${timeDiff}ms`);
                        let statusText = "Idle";
                        if (node.messageCount > 0) {
                            statusText = `Idle (${node.messageCount} msgs)`;
                        }
                        if (node.errorCount > 0) {
                            statusText = `Idle (${node.messageCount} msgs, ${node.errorCount} errors)`;
                        }
                        node.status({fill:"yellow",shape:"ring",text:statusText});
                    }
                }   
            }
              
            node.interval = setInterval(checkLastMessageTime, 1000);

            try {
                node.debug(`[Kafka ${nodeType}] Connecting to Kafka`);
                await node.consumer.connect();
                node.onConnect();

                // Subscribe to topic
                await node.consumer.subscribe({ 
                    topic: topic, 
                    fromBeginning: config.fromOffset === 'earliest' 
                });
                node.debug(`[Kafka ${nodeType}] Subscribed to topic: ${topic}`);

                // Run consumer
                await node.consumer.run({
                    eachMessage: node.onMessage
                });
                node.debug(`[Kafka ${nodeType}] Consumer started successfully`);

            } catch (err) {
                node.onError(err);
            }
        }

        node.getOrRegisterSchema = async function() {
            if (!config.useSchemaValidation) {
                return; // Skip schema operations when validation is disabled
            }
            
            try {
                node.debug(`[Kafka Schema Consumer] Getting schema for subject: ${config.schemaSubject}`);
                
                // Try to get existing schema
                try {
                    const schemaId = await node.schemaRegistry.getLatestSchemaId(config.schemaSubject);
                    node.debug(`[Kafka Schema Consumer] Found existing schema ID: ${schemaId}`);
                    
                    // Cache the schema for faster lookups
                    const schema = await node.schemaRegistry.getSchema(schemaId);
                    node.cachedSchemas.set(schemaId, schema);
                    node.debug(`[Kafka Schema Consumer] Schema cached successfully`);
                    
                    return schemaId;
                } catch (error) {
                    if (error.message.includes('Subject') && error.message.includes('not found')) {
                        node.debug(`[Kafka Schema Consumer] Schema subject not found: ${config.schemaSubject}`);
                        throw new Error(`Schema subject '${config.schemaSubject}' not found`);
                    } else {
                        throw error;
                    }
                }
            } catch (error) {
                node.error(`[Kafka Schema Consumer] Schema operation failed: ${error.message}`);
                throw error;
            }
        };
        
        node.on('close', async function() {
            const nodeType = config.useSchemaValidation ? 'Schema Consumer' : 'Consumer';
            node.debug(`[Kafka ${nodeType}] Closing consumer for topic: ${config.topic}`);
            node.status({});
            node.ready = false;
            node.lastMessageTime = null;
            node.messageCount = 0;
            node.errorCount = 0;
            clearInterval(node.interval);
            
            // Clear schema cache
            if (node.cachedSchemas) {
                node.cachedSchemas.clear();
            }
            
            if (node.consumer) {
                try {
                    node.debug(`[Kafka ${nodeType}] Disconnecting consumer`);
                    await node.consumer.disconnect();
                    node.debug(`[Kafka ${nodeType}] Consumer disconnected successfully`);
                    node.consumer = null;
                } catch (err) {
                    node.error(`[Kafka ${nodeType}] Error disconnecting consumer: ${err.message}`);
                }
            }
        });

        node.init();
    }
    
    RED.nodes.registerType("hm-kafka-consumer", KafkaConsumerNode);
}