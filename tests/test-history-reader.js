// Test for Kafka History Reader Node
const path = require('path');

// Mock Node-RED environment
const RED = {
    nodes: {
        createNode: function(node, config) {
            node.config = config;
            node.status = function(status) {
                console.log(`[${config.type || 'Node'}] Status:`, status);
            };
            node.error = function(msg) {
                console.error(`[${config.type || 'Node'}] Error:`, msg);
            };
            node.warn = function(msg) {
                console.warn(`[${config.type || 'Node'}] Warning:`, msg);
            };
            node.debug = function(msg) {
                console.log(`[${config.type || 'Node'}] Debug:`, msg);
            };
            node.send = function(msg) {
                console.log(`[${config.type || 'Node'}] Sending:`, JSON.stringify(msg, null, 2));
            };
            node.on = function(event, callback) {
                node['_' + event] = callback;
            };
        },
        getNode: function(id) {
            // Mock broker node
            return {
                getKafka: function() {
                    return {
                        consumer: function(config) {
                            return {
                                connect: async function() {
                                    console.log('Mock consumer connected');
                                },
                                subscribe: async function(options) {
                                    console.log('Mock consumer subscribed to:', options);
                                },
                                run: async function(handlers) {
                                    console.log('Mock consumer running...');
                                    // Simulate some test messages
                                    const testMessages = [
                                        {
                                            topic: 'test-topic',
                                            partition: 0,
                                            message: {
                                                value: Buffer.from(JSON.stringify({
                                                    type: 'sensor-data',
                                                    temperature: 23.5,
                                                    timestamp: Date.now()
                                                })),
                                                offset: '1',
                                                timestamp: Date.now().toString(),
                                                key: Buffer.from('sensor-001')
                                            }
                                        },
                                        {
                                            topic: 'test-topic',
                                            partition: 0,
                                            message: {
                                                value: Buffer.from(JSON.stringify({
                                                    type: 'alert',
                                                    level: 'warning',
                                                    message: 'High temperature detected',
                                                    timestamp: Date.now()
                                                })),
                                                offset: '2',
                                                timestamp: Date.now().toString(),
                                                key: Buffer.from('alert-001')
                                            }
                                        }
                                    ];
                                    
                                    // Simulate message processing with delay
                                    setTimeout(async () => {
                                        for (const msg of testMessages) {
                                            await handlers.eachMessage(msg);
                                        }
                                    }, 100);
                                },
                                disconnect: async function() {
                                    console.log('Mock consumer disconnected');
                                }
                            };
                        }
                    };
                }
            };
        },
        registerType: function(type, constructor) {
            console.log(`Registered node type: ${type}`);
            
            // Test the node
            console.log('\n=== Testing Kafka History Reader ===');
            
            const config = {
                name: 'Test History Reader',
                broker: 'test-broker',
                topic: 'test-topic',
                messageTypes: 'sensor-data,alert',
                maxMessages: 5,
                fromOffset: 'earliest',
                encoding: 'utf8',
                useSchemaValidation: false,
                type: 'oriolrius-kafka-history-reader'
            };
            
            const node = {};
            const instance = new constructor(config);
            
            // Simulate input message after initialization
            setTimeout(() => {
                console.log('\n--- Sending test input ---');
                if (instance._input) {
                    instance._input({
                        payload: 'trigger',
                        messageTypes: 'sensor-data,alert',
                        maxMessages: 3
                    });
                }
            }, 200);
        }
    }
};

// Load and test the node
try {
    console.log('Loading Kafka History Reader node...');
    const nodeModule = require('../js/kafka-history-reader.js');
    nodeModule(RED);
    
    console.log('\nNode loaded successfully!');
    
    // Keep the test running for a bit to see async results
    setTimeout(() => {
        console.log('\n=== Test completed ===');
        process.exit(0);
    }, 2000);
    
} catch (error) {
    console.error('Error loading node:', error);
    process.exit(1);
}
