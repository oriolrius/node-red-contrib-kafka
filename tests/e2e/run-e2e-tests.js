#!/usr/bin/env node

/**
 * End-to-End Tests for Kafka Nodes
 *
 * This script:
 * 1. Starts Kafka in Docker
 * 2. Starts Node-RED runtime
 * 3. Tests producer/consumer functionality
 * 4. Tests compression
 * 5. Cleans up everything
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const RED = require('node-red');
const http = require('http');

const execAsync = promisify(exec);
const KAFKA_BROKER = 'localhost:58092';
const TEST_TOPIC = 'e2e-test-topic';
const COMPRESSION_TOPIC = 'e2e-compression-topic';

let server;
let redRuntime;
let receivedMessages = [];

console.log('🚀 Starting End-to-End Tests');
console.log('==================================================\n');

// Helper to execute docker compose commands
async function dockerCompose(command) {
    const cwd = path.join(__dirname);
    return execAsync(`docker compose ${command}`, { cwd });
}

// Start Kafka
async function startKafka() {
    console.log('📦 Starting Kafka container...');
    try {
        await dockerCompose('down -v'); // Clean up any previous containers
        await dockerCompose('up -d');

        console.log('⏳ Waiting for Kafka to be ready...');
        let ready = false;
        let attempts = 0;
        const maxAttempts = 30;

        while (!ready && attempts < maxAttempts) {
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
            throw new Error('Kafka failed to start within timeout');
        }
    } catch (error) {
        console.error('❌ Failed to start Kafka:', error.message);
        throw error;
    }
}

// Stop Kafka
async function stopKafka() {
    console.log('\n🛑 Stopping Kafka container...');
    try {
        await dockerCompose('down -v');
        console.log('✅ Kafka stopped and cleaned up\n');
    } catch (error) {
        console.error('❌ Failed to stop Kafka:', error.message);
    }
}

// Start Node-RED
async function startNodeRED() {
    console.log('🔴 Starting Node-RED runtime...');

    return new Promise((resolve, reject) => {
        // Create HTTP server
        server = http.createServer();

        const settings = {
            httpAdminRoot: false,
            httpNodeRoot: false,
            userDir: path.join(__dirname, '.nodered'),
            nodesDir: path.join(__dirname, '../../js'),
            functionGlobalContext: {},
            logging: {
                console: {
                    level: 'error',
                    metrics: false,
                    audit: false
                }
            }
        };

        RED.init(server, settings);

        server.listen(0, () => {
            RED.start().then(() => {
                console.log('✅ Node-RED runtime started\n');
                redRuntime = RED;
                resolve();
            }).catch(reject);
        });
    });
}

// Stop Node-RED
async function stopNodeRED() {
    console.log('🛑 Stopping Node-RED runtime...');
    if (redRuntime) {
        await RED.stop();
    }
    if (server) {
        server.close();
    }
    console.log('✅ Node-RED stopped\n');
}

// Deploy a flow
async function deployFlow(flow) {
    await RED.nodes.loadFlows(flow);
    return new Promise((resolve) => {
        setTimeout(resolve, 2000); // Wait for nodes to initialize
    });
}

// Test 1: Basic Producer and Consumer
async function testBasicProducerConsumer() {
    console.log('📝 Test 1: Basic Producer and Consumer');
    console.log('--------------------------------------------------');

    receivedMessages = [];
    const testMessage = {
        id: 'test-' + Date.now(),
        message: 'Hello from E2E test!',
        timestamp: Date.now()
    };

    const flow = [
        {
            id: 'broker-1',
            type: 'oriolrius-kafka-broker',
            name: 'Test Broker',
            hosts: KAFKA_BROKER
        },
        {
            id: 'producer-1',
            type: 'oriolrius-kafka-producer',
            broker: 'broker-1',
            topic: TEST_TOPIC,
            requireAcks: 1,
            ackTimeoutMs: 5000,
            attributes: 0,
            useSchemaValidation: false,
            useiot: false
        },
        {
            id: 'consumer-1',
            type: 'oriolrius-kafka-consumer',
            broker: 'broker-1',
            topic: TEST_TOPIC,
            groupid: 'e2e-test-group',
            fromOffset: 'latest',
            encoding: 'utf8',
            useSchemaValidation: false,
            wires: [['output-1']]
        },
        {
            id: 'output-1',
            type: 'function',
            func: `
                global.set('e2e_received_' + msg.payload.id, msg.payload);
                return msg;
            `,
            wires: []
        }
    ];

    await deployFlow(flow);

    // Wait for consumer to be ready
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Send message
    const producerNode = RED.nodes.getNode('producer-1');
    if (!producerNode) {
        throw new Error('Producer node not found');
    }

    console.log('  📤 Sending test message...');
    producerNode.receive({ payload: testMessage });

    // Wait for message to be received
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check if message was received
    const received = RED.util.getMessageProperty({}, 'global.e2e_received_' + testMessage.id);

    if (received && received.message === testMessage.message) {
        console.log('  ✅ Message sent and received successfully!');
        console.log(`  ✅ Message ID: ${testMessage.id}`);
        return true;
    } else {
        console.log('  ❌ Message was not received or content mismatch');
        return false;
    }
}

// Test 2: Compression
async function testCompression() {
    console.log('\n📝 Test 2: Compression (GZIP, Snappy, LZ4)');
    console.log('--------------------------------------------------');

    const compressionTypes = [
        { name: 'None', value: 0 },
        { name: 'GZIP', value: 1 },
        { name: 'Snappy', value: 2 },
        { name: 'LZ4', value: 3 }
    ];

    let allPassed = true;

    for (const compression of compressionTypes) {
        const testMessage = {
            compression: compression.name,
            data: 'Test data for compression. '.repeat(10),
            timestamp: Date.now()
        };

        const flow = [
            {
                id: 'broker-comp',
                type: 'oriolrius-kafka-broker',
                name: 'Test Broker',
                hosts: KAFKA_BROKER
            },
            {
                id: 'producer-comp',
                type: 'oriolrius-kafka-producer',
                broker: 'broker-comp',
                topic: COMPRESSION_TOPIC,
                requireAcks: 1,
                ackTimeoutMs: 5000,
                attributes: compression.value,
                useSchemaValidation: false,
                useiot: false
            },
            {
                id: 'consumer-comp',
                type: 'oriolrius-kafka-consumer',
                broker: 'broker-comp',
                topic: COMPRESSION_TOPIC,
                groupid: 'e2e-compression-group-' + compression.value,
                fromOffset: 'earliest',
                encoding: 'utf8',
                useSchemaValidation: false,
                wires: [['output-comp']]
            },
            {
                id: 'output-comp',
                type: 'function',
                func: `
                    global.set('e2e_comp_received_' + msg.payload.compression, msg.payload);
                    return msg;
                `,
                wires: []
            }
        ];

        await deployFlow(flow);
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Send message
        const producerNode = RED.nodes.getNode('producer-comp');
        console.log(`  📤 Testing ${compression.name} compression...`);
        producerNode.receive({ payload: testMessage });

        await new Promise(resolve => setTimeout(resolve, 5000));

        // Check if message was received
        const received = RED.util.getMessageProperty({}, 'global.e2e_comp_received_' + compression.name);

        if (received && received.data === testMessage.data) {
            console.log(`  ✅ ${compression.name}: Message compressed, sent, and decompressed successfully!`);
        } else {
            console.log(`  ❌ ${compression.name}: Failed`);
            allPassed = false;
        }
    }

    return allPassed;
}

// Test 3: Multiple Messages
async function testMultipleMessages() {
    console.log('\n📝 Test 3: Multiple Messages (Batch)');
    console.log('--------------------------------------------------');

    const messageCount = 10;
    const flow = [
        {
            id: 'broker-batch',
            type: 'oriolrius-kafka-broker',
            name: 'Test Broker',
            hosts: KAFKA_BROKER
        },
        {
            id: 'producer-batch',
            type: 'oriolrius-kafka-producer',
            broker: 'broker-batch',
            topic: TEST_TOPIC + '-batch',
            requireAcks: 1,
            ackTimeoutMs: 5000,
            attributes: 0,
            useSchemaValidation: false,
            useiot: false
        },
        {
            id: 'consumer-batch',
            type: 'oriolrius-kafka-consumer',
            broker: 'broker-batch',
            topic: TEST_TOPIC + '-batch',
            groupid: 'e2e-batch-group',
            fromOffset: 'earliest',
            encoding: 'utf8',
            useSchemaValidation: false,
            wires: [['output-batch']]
        },
        {
            id: 'output-batch',
            type: 'function',
            func: `
                const count = global.get('e2e_batch_count') || 0;
                global.set('e2e_batch_count', count + 1);
                return msg;
            `,
            wires: []
        }
    ];

    await deployFlow(flow);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Send multiple messages
    const producerNode = RED.nodes.getNode('producer-batch');
    console.log(`  📤 Sending ${messageCount} messages...`);

    for (let i = 0; i < messageCount; i++) {
        producerNode.receive({
            payload: {
                id: i,
                message: `Batch message ${i}`,
                timestamp: Date.now()
            }
        });
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Wait for all messages
    await new Promise(resolve => setTimeout(resolve, 8000));

    const received = RED.util.getMessageProperty({}, 'global.e2e_batch_count') || 0;

    console.log(`  📨 Sent: ${messageCount}, Received: ${received}`);

    if (received >= messageCount) {
        console.log('  ✅ All messages received successfully!');
        return true;
    } else {
        console.log(`  ❌ Only received ${received}/${messageCount} messages`);
        return false;
    }
}

// Main test runner
async function runTests() {
    let testsPassed = 0;
    let totalTests = 0;

    try {
        await startKafka();
        await startNodeRED();

        // Run tests
        totalTests++;
        if (await testBasicProducerConsumer()) testsPassed++;

        totalTests++;
        if (await testCompression()) testsPassed++;

        totalTests++;
        if (await testMultipleMessages()) testsPassed++;

    } catch (error) {
        console.error('\n❌ Test execution failed:', error);
        console.error(error.stack);
    } finally {
        await stopNodeRED();
        await stopKafka();
    }

    // Summary
    console.log('\n📊 Test Summary');
    console.log('==================================================');
    console.log(`Tests passed: ${testsPassed}/${totalTests}`);

    if (testsPassed === totalTests) {
        console.log('🎉 All E2E tests passed!');
        process.exit(0);
    } else {
        console.log('❌ Some E2E tests failed');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
