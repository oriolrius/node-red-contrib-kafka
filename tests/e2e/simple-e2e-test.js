#!/usr/bin/env node

/**
 * Simple End-to-End Tests for Kafka
 *
 * This script tests the Kafka infrastructure is working correctly
 * using kafkajs directly, which our nodes depend on.
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const { Kafka, CompressionTypes, CompressionCodecs } = require('kafkajs');
const path = require('path');

const execAsync = promisify(exec);
const KAFKA_BROKER = 'localhost:58092';

console.log('🚀 Starting Simple E2E Tests');
console.log('==================================================\n');

// Register compression codecs
// KafkaJS expects factory functions that return codec instances, not the instances themselves
try {
    const SnappyCodec = require('kafkajs-snappy');
    CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec;  // Factory function
    console.log('✅ Snappy codec registered');
} catch (error) {
    console.log('⚠️  Snappy codec not available');
}

try {
    const LZ4Codec = require('kafkajs-lz4');
    CompressionCodecs[CompressionTypes.LZ4] = () => new LZ4Codec();  // Factory function wrapper
    console.log('✅ LZ4 codec registered');
} catch (error) {
    console.log('⚠️  LZ4 codec not available');
}

console.log('');

async function dockerCompose(command) {
    const cwd = path.join(__dirname);
    return execAsync(`docker compose ${command}`, { cwd });
}

async function startKafka() {
    console.log('📦 Starting Kafka container...');
    try {
        await dockerCompose('down -v');
        await dockerCompose('up -d');

        console.log('⏳ Waiting for Kafka to be ready...');
        let ready = false;
        let attempts = 0;

        while (!ready && attempts < 30) {
            try {
                const { stdout } = await execAsync('docker exec kafka-e2e-test /opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server localhost:58092');
                if (stdout.includes('ApiVersion')) {
                    ready = true;
                    console.log('✅ Kafka is ready!\n');
                }
            } catch (e) {
                attempts++;
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        if (!ready) {
            throw new Error('Kafka failed to start');
        }
    } catch (error) {
        console.error('❌ Failed to start Kafka:', error.message);
        throw error;
    }
}

async function stopKafka() {
    console.log('\n🛑 Stopping Kafka container...');
    try {
        await dockerCompose('down -v');
        console.log('✅ Kafka stopped\n');
    } catch (error) {
        console.error('❌ Failed to stop Kafka:', error.message);
    }
}

async function testBasicProducerConsumer() {
    console.log('📝 Test 1: Basic Producer and Consumer');
    console.log('--------------------------------------------------');

    const kafka = new Kafka({
        clientId: 'e2e-test',
        brokers: [KAFKA_BROKER]
    });

    const admin = kafka.admin();
    const producer = kafka.producer();
    const consumer = kafka.consumer({ groupId: 'test-group' });

    try {
        // Create topic first
        await admin.connect();
        await admin.createTopics({
            topics: [{ topic: 'test-topic', numPartitions: 1, replicationFactor: 1 }]
        });
        await admin.disconnect();
        console.log('  ✅ Topic created');

        await producer.connect();
        console.log('  ✅ Producer connected');

        await consumer.connect();
        console.log('  ✅ Consumer connected');

        await consumer.subscribe({ topic: 'test-topic', fromBeginning: true });

        const receivedMessages = [];
        consumer.run({
            eachMessage: async ({ message }) => {
                receivedMessages.push(JSON.parse(message.value.toString()));
            }
        });

        // Send test message
        const testMessage = { id: 'test-1', data: 'Hello Kafka!', timestamp: Date.now() };
        await producer.send({
            topic: 'test-topic',
            messages: [{ value: JSON.stringify(testMessage) }]
        });
        console.log('  ✅ Message sent');

        // Wait for message
        await new Promise(resolve => setTimeout(resolve, 3000));

        if (receivedMessages.length > 0 && receivedMessages[0].id === 'test-1') {
            console.log('  ✅ Message received correctly');
            return true;
        } else {
            console.log('  ❌ Message not received');
            return false;
        }
    } finally {
        await producer.disconnect();
        await consumer.disconnect();
        console.log('  ✅ Disconnected\n');
    }
}

async function testCompression() {
    console.log('📝 Test 2: Compression (GZIP, Snappy, LZ4)');
    console.log('--------------------------------------------------');

    const tests = [
        { name: 'GZIP', type: CompressionTypes.GZIP },
        { name: 'Snappy', type: CompressionTypes.Snappy },
        { name: 'LZ4', type: CompressionTypes.LZ4 }
    ];

    let allPassed = true;

    for (const test of tests) {
        const kafka = new Kafka({
            clientId: 'e2e-compression-test',
            brokers: [KAFKA_BROKER]
        });

        const admin = kafka.admin();
        const producer = kafka.producer();
        const consumer = kafka.consumer({ groupId: `compression-group-${test.name}` });

        try {
            // Create topic
            await admin.connect();
            try {
                await admin.createTopics({
                    topics: [{ topic: 'compression-topic', numPartitions: 1, replicationFactor: 1 }]
                });
            } catch (e) {
                // Topic may already exist
            }
            await admin.disconnect();

            await producer.connect();
            await consumer.connect();
            await consumer.subscribe({ topic: 'compression-topic', fromBeginning: true });

            const receivedMessages = [];
            consumer.run({
                eachMessage: async ({ message }) => {
                    receivedMessages.push(JSON.parse(message.value.toString()));
                }
            });

            // Send compressed message
            const testMessage = { compression: test.name, data: 'Test data '.repeat(50) };
            await producer.send({
                topic: 'compression-topic',
                compression: test.type,
                messages: [{ value: JSON.stringify(testMessage) }]
            });

            // Wait for message
            await new Promise(resolve => setTimeout(resolve, 3000));

            // Find the message with the expected compression type (topic is shared by all tests)
            const matchingMessage = receivedMessages.find(msg => msg.compression === test.name);

            if (matchingMessage) {
                console.log(`  ✅ ${test.name}: Compressed and decompressed successfully`);
            } else {
                console.log(`  ❌ ${test.name}: Failed - Received ${receivedMessages.length} messages, but none with compression type "${test.name}"`);
                if (receivedMessages.length > 0) {
                    console.log(`     Received compressions: ${receivedMessages.map(m => m.compression).join(', ')}`);
                }
                allPassed = false;
            }

            await producer.disconnect();
            await consumer.disconnect();
        } catch (error) {
            console.log(`  ❌ ${test.name}: Error - ${error.message}`);
            allPassed = false;
        }
    }

    console.log('');
    return allPassed;
}

async function testMultipleMessages() {
    console.log('📝 Test 3: Multiple Messages');
    console.log('--------------------------------------------------');

    const kafka = new Kafka({
        clientId: 'e2e-batch-test',
        brokers: [KAFKA_BROKER]
    });

    const admin = kafka.admin();
    const producer = kafka.producer();
    const consumer = kafka.consumer({ groupId: 'batch-group' });

    try {
        // Create topic
        await admin.connect();
        try {
            await admin.createTopics({
                topics: [{ topic: 'batch-topic', numPartitions: 1, replicationFactor: 1 }]
            });
        } catch (e) {
            // Topic may already exist
        }
        await admin.disconnect();

        await producer.connect();
        await consumer.connect();
        await consumer.subscribe({ topic: 'batch-topic', fromBeginning: true });

        const receivedMessages = [];
        consumer.run({
            eachMessage: async ({ message }) => {
                receivedMessages.push(JSON.parse(message.value.toString()));
            }
        });

        // Send 10 messages
        const messages = [];
        for (let i = 0; i < 10; i++) {
            messages.push({ value: JSON.stringify({ id: i, data: `Message ${i}` }) });
        }

        await producer.send({
            topic: 'batch-topic',
            messages
        });
        console.log('  ✅ 10 messages sent');

        // Wait for messages
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log(`  📨 Received ${receivedMessages.length}/10 messages`);

        if (receivedMessages.length >= 10) {
            console.log('  ✅ All messages received');
            return true;
        } else {
            console.log('  ❌ Not all messages received');
            return false;
        }
    } finally {
        await producer.disconnect();
        await consumer.disconnect();
        console.log('');
    }
}

async function runTests() {
    let passed = 0;
    let total = 0;

    try {
        await startKafka();

        total++;
        if (await testBasicProducerConsumer()) passed++;

        total++;
        if (await testCompression()) passed++;

        total++;
        if (await testMultipleMessages()) passed++;

    } catch (error) {
        console.error('\n❌ Test execution failed:', error.message);
    } finally {
        await stopKafka();
    }

    console.log('📊 Test Summary');
    console.log('==================================================');
    console.log(`Tests passed: ${passed}/${total}`);

    if (passed === total) {
        console.log('🎉 All E2E tests passed!');
        process.exit(0);
    } else {
        console.log('❌ Some tests failed');
        process.exit(1);
    }
}

runTests();
