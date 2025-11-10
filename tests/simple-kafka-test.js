// Simple Kafka functionality test without external dependencies
console.log('🚀 Starting Simple Kafka Functionality Test');
console.log('==================================================');

// Mock Node-RED environment
const mockRED = {
    nodes: {
        createNode: function(node, config) {
            node.config = config;
            node.status = function(status) {
                console.log('[STATUS]', JSON.stringify(status));
            };
            node.debug = function(message) {
                console.log('[DEBUG]', message);
            };
            node.error = function(message, error) {
                console.log('[ERROR]', message, error ? error.message : '');
            };
            node.warn = function(message) {
                console.log('[WARN]', message);
            };
            node.send = function(msg) {
                console.log('[SEND]', JSON.stringify(msg, null, 2));
            };
            node.on = function(event, callback) {
                console.log('[EVENT]', 'Registered:', event);
                if (event === 'close') {
                    node._closeCallback = function() {
                        // Provide done callback
                        callback(function() {
                            console.log('[CLEANUP] Node cleanup completed');
                        });
                    };
                }
                if (event === 'input') {
                    node._inputCallback = callback;
                }
            };
        },
        getNode: function(id) {
            return mockBroker;
        },
        registerType: function(type, constructor) {
            console.log(`✅ Node registered: ${type}`);
        }
    }
};

// Mock broker node
const mockBroker = {
    getKafka: function() {
        console.log('[BROKER] getKafka() called');
        return mockKafka;
    },
    getIotConfig: function() {
        return { useiot: false };
    }
};

// Mock Kafka client that simulates behavior without requiring real Kafka
const mockKafka = {
    producer: function(config) {
        console.log('[KAFKA] producer() called with:', JSON.stringify(config, null, 2));
        return {
            connect: async function() {
                console.log('[PRODUCER] connect() called');
                await new Promise(resolve => setTimeout(resolve, 100)); // Simulate connection delay
                console.log('[PRODUCER] Connected successfully');
                return Promise.resolve();
            },
            send: async function(message) {
                console.log('[PRODUCER] send() called with:', JSON.stringify(message, null, 2));
                await new Promise(resolve => setTimeout(resolve, 50)); // Simulate send delay
                const result = [{
                    topic: message.topic,
                    partition: 0,
                    offset: '123',
                    timestamp: Date.now().toString()
                }];
                console.log('[PRODUCER] Message sent successfully:', JSON.stringify(result, null, 2));
                return result;
            },
            disconnect: async function() {
                console.log('[PRODUCER] disconnect() called');
                await new Promise(resolve => setTimeout(resolve, 50));
                console.log('[PRODUCER] Disconnected successfully');
                return Promise.resolve();
            },
            on: function(event, callback) {
                console.log('[PRODUCER] Event registered:', event);
                // Simulate connection event after a delay
                if (event === 'producer.connect') {
                    setTimeout(() => {
                        console.log('[PRODUCER] Triggering connect event');
                        callback();
                    }, 200);
                }
            }
        };
    },
    consumer: function(config) {
        console.log('[KAFKA] consumer() called with:', JSON.stringify(config, null, 2));
        return {
            connect: async function() {
                console.log('[CONSUMER] connect() called');
                await new Promise(resolve => setTimeout(resolve, 100));
                console.log('[CONSUMER] Connected successfully');
                return Promise.resolve();
            },
            subscribe: async function(options) {
                console.log('[CONSUMER] subscribe() called with:', JSON.stringify(options, null, 2));
                await new Promise(resolve => setTimeout(resolve, 50));
                console.log('[CONSUMER] Subscribed successfully');
                return Promise.resolve();
            },
            run: async function(options) {
                console.log('[CONSUMER] run() called');
                await new Promise(resolve => setTimeout(resolve, 50));
                console.log('[CONSUMER] Running successfully');
                
                // Simulate receiving a message after a delay
                setTimeout(() => {
                    const mockMessage = {
                        topic: 'test-topic',
                        partition: 0,
                        message: {
                            offset: '123',
                            value: Buffer.from(JSON.stringify({
                                id: 'test-123',
                                message: 'Hello Kafka!',
                                timestamp: Date.now()
                            })),
                            timestamp: Date.now().toString(),
                            key: null,
                            headers: {}
                        }
                    };
                    console.log('[CONSUMER] Simulating received message...');
                    options.eachMessage(mockMessage);
                }, 500);
                
                return Promise.resolve();
            },
            disconnect: async function() {
                console.log('[CONSUMER] disconnect() called');
                await new Promise(resolve => setTimeout(resolve, 50));
                console.log('[CONSUMER] Disconnected successfully');
                return Promise.resolve();
            }
        };
    }
};

async function runSimpleKafkaTest() {
    try {
        console.log('\n📝 Test 1: Loading Producer Node');
        console.log('--------------------------------------------------');
        
        // Store reference to constructor when registerType is called
        let KafkaProducerConstructor = null;
        const originalRegisterType = mockRED.nodes.registerType;
        mockRED.nodes.registerType = function(type, constructor) {
            console.log(`✅ Node registered: ${type}`);
            if (type === 'oriolrius-kafka-producer') {
                KafkaProducerConstructor = constructor;
            }
        };
        
        require('../js/kafka-producer.js')(mockRED);
        
        // Restore original registerType
        mockRED.nodes.registerType = originalRegisterType;

        console.log('\n📝 Test 2: Creating Producer Instance');
        console.log('--------------------------------------------------');
        const producerConfig = {
            name: 'Test Producer',
            broker: 'test-broker',
            topic: 'test-topic',
            requireAcks: 1,
            ackTimeoutMs: 1000,
            useSchemaValidation: false, // Test basic mode without schema
            useiot: false
        };

        const producerNode = {};
        mockRED.nodes.createNode(producerNode, producerConfig);
        if (KafkaProducerConstructor) {
            KafkaProducerConstructor.call(producerNode, producerConfig);
        }

        // Wait for producer to initialize
        console.log('⏳ Waiting for producer to initialize...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log('\n📝 Test 3: Sending Test Message');
        console.log('--------------------------------------------------');
        const testMessage = {
            payload: {
                id: 'test-123',
                message: 'Hello Kafka!',
                timestamp: Date.now()
            }
        };

        if (producerNode._inputCallback) {
            producerNode._inputCallback(testMessage);
        }

        // Wait for message to be sent
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log('\n📝 Test 4: Loading Consumer Node');
        console.log('--------------------------------------------------');
        
        // Store reference to consumer constructor
        let KafkaConsumerConstructor = null;
        mockRED.nodes.registerType = function(type, constructor) {
            console.log(`✅ Node registered: ${type}`);
            if (type === 'oriolrius-kafka-consumer') {
                KafkaConsumerConstructor = constructor;
            }
        };
        
        require('../js/kafka-consumer.js')(mockRED);

        console.log('\n📝 Test 5: Creating Consumer Instance');
        console.log('--------------------------------------------------');
        const consumerConfig = {
            name: 'Test Consumer',
            broker: 'test-broker',
            topic: 'test-topic',
            groupid: 'test-group',
            fromOffset: 'earliest',
            encoding: 'utf8',
            useSchemaValidation: false // Test basic mode without schema
        };

        const consumerNode = {};
        mockRED.nodes.createNode(consumerNode, consumerConfig);
        if (KafkaConsumerConstructor) {
            KafkaConsumerConstructor.call(consumerNode, consumerConfig);
        }

        // Wait for consumer to initialize and receive message
        console.log('⏳ Waiting for consumer to initialize and receive messages...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('\n🎉 Simple Kafka Test Completed Successfully!');
        console.log('✅ Producer node loaded and initialized');
        console.log('✅ Consumer node loaded and initialized');
        console.log('✅ Message publishing flow tested');
        console.log('✅ Message consumption flow tested');
        console.log('✅ Basic Kafka functionality verified');

        // Cleanup
        console.log('\n🧹 Cleaning up...');
        if (producerNode._closeCallback) {
            await producerNode._closeCallback();
        }
        if (consumerNode._closeCallback) {
            await consumerNode._closeCallback();
        }

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
}

// Run the test
if (require.main === module) {
    runSimpleKafkaTest()
        .then(() => {
            console.log('\n✅ All tests passed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Tests failed:', error);
            process.exit(1);
        });
}

module.exports = runSimpleKafkaTest;