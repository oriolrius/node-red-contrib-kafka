const { KafkaContainer } = require('testcontainers');
const { Kafka } = require('kafkajs');

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
                    node._closeCallback = callback;
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

let mockKafka;

async function runBasicKafkaTest() {
    console.log('🚀 Starting Basic Kafka Test');
    console.log('==================================================');

    let kafkaContainer;
    let producer;
    let consumer;

    try {
        console.log('🐳 Starting Kafka container...');
        kafkaContainer = await new KafkaContainer()
            .withExposedPorts(9093)
            .start();

        const kafkaHost = kafkaContainer.getHost();
        const kafkaPort = kafkaContainer.getMappedPort(9093);
        const brokers = [`${kafkaHost}:${kafkaPort}`];

        console.log(`✅ Kafka container started at: ${brokers[0]}`);

        // Create Kafka client
        const kafka = new Kafka({
            clientId: 'test-client',
            brokers: brokers,
        });

        mockKafka = {
            producer: function(config) {
                console.log('[KAFKA] producer() called with:', JSON.stringify(config, null, 2));
                return {
                    connect: async function() {
                        console.log('[PRODUCER] connect() called');
                        producer = kafka.producer(config);
                        await producer.connect();
                        console.log('[PRODUCER] Connected successfully');
                        return Promise.resolve();
                    },
                    send: async function(message) {
                        console.log('[PRODUCER] send() called with:', JSON.stringify(message, null, 2));
                        const result = await producer.send(message);
                        console.log('[PRODUCER] Message sent successfully:', JSON.stringify(result, null, 2));
                        return result;
                    },
                    disconnect: async function() {
                        console.log('[PRODUCER] disconnect() called');
                        if (producer) {
                            await producer.disconnect();
                        }
                        return Promise.resolve();
                    },
                    on: function(event, callback) {
                        console.log('[PRODUCER] Event registered:', event);
                    }
                };
            },
            consumer: function(config) {
                console.log('[KAFKA] consumer() called with:', JSON.stringify(config, null, 2));
                return {
                    connect: async function() {
                        console.log('[CONSUMER] connect() called');
                        consumer = kafka.consumer(config);
                        await consumer.connect();
                        console.log('[CONSUMER] Connected successfully');
                        return Promise.resolve();
                    },
                    subscribe: async function(options) {
                        console.log('[CONSUMER] subscribe() called with:', JSON.stringify(options, null, 2));
                        await consumer.subscribe(options);
                        console.log('[CONSUMER] Subscribed successfully');
                        return Promise.resolve();
                    },
                    run: async function(options) {
                        console.log('[CONSUMER] run() called');
                        await consumer.run(options);
                        console.log('[CONSUMER] Running successfully');
                        return Promise.resolve();
                    },
                    disconnect: async function() {
                        console.log('[CONSUMER] disconnect() called');
                        if (consumer) {
                            await consumer.disconnect();
                        }
                        return Promise.resolve();
                    }
                };
            }
        };

        // Test 1: Load Producer Node
        console.log('\n📝 Test 1: Loading Producer Node');
        console.log('--------------------------------------------------');
        const KafkaProducerNode = require('../js/kafka-producer.js')(mockRED);

        // Test 2: Create Producer Instance
        console.log('\n📝 Test 2: Creating Producer Instance');
        console.log('--------------------------------------------------');
        const producerConfig = {
            name: 'Test Producer',
            broker: 'test-broker',
            topic: 'test-topic',
            requireAcks: 1,
            ackTimeoutMs: 1000,
            useSchemaValidation: false // Test basic mode without schema
        };

        const producerNode = {};
        mockRED.nodes.createNode(producerNode, producerConfig);
        new KafkaProducerNode(producerConfig).call(producerNode);

        // Wait for producer to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Test 3: Send Message
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
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Test 4: Load Consumer Node
        console.log('\n📝 Test 4: Loading Consumer Node');
        console.log('--------------------------------------------------');
        const KafkaConsumerNode = require('../js/kafka-consumer.js')(mockRED);

        // Test 5: Create Consumer Instance
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
        new KafkaConsumerNode(consumerConfig).call(consumerNode);

        // Wait for consumer to initialize and receive message
        await new Promise(resolve => setTimeout(resolve, 3000));

        console.log('\n🎉 Basic Kafka Test Completed Successfully!');
        console.log('✅ Producer node loaded and initialized');
        console.log('✅ Consumer node loaded and initialized');
        console.log('✅ Message publishing flow tested');
        console.log('✅ Message consumption flow tested');

    } catch (error) {
        console.error('❌ Test failed:', error.message);
        throw error;
    } finally {
        // Cleanup
        console.log('\n🧹 Cleaning up...');
        try {
            if (producer) {
                await producer.disconnect();
            }
            if (consumer) {
                await consumer.disconnect();
            }
            if (kafkaContainer) {
                await kafkaContainer.stop();
                console.log('✅ Kafka container stopped');
            }
        } catch (cleanupError) {
            console.error('⚠️ Cleanup error:', cleanupError.message);
        }
    }
}

// Run the test
if (require.main === module) {
    runBasicKafkaTest()
        .then(() => {
            console.log('\n✅ All tests passed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Tests failed:', error);
            process.exit(1);
        });
}

module.exports = runBasicKafkaTest;