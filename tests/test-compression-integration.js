#!/usr/bin/env node

// Integration test for Kafka compression with real Kafka broker
console.log('🧪 Kafka Compression Integration Test');
console.log('==================================================');
console.log('This test requires a running Kafka broker.');
console.log('Set KAFKA_BROKER environment variable to test against a specific broker.');
console.log('Default: localhost:9092\n');

const kafkajs = require('kafkajs');
const { CompressionTypes, CompressionCodecs } = kafkajs;

// Register compression codecs
try {
    const SnappyCodec = require('kafkajs-snappy');
    CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec();
    console.log('✅ Snappy codec registered');
} catch (error) {
    console.log('❌ Failed to register Snappy codec:', error.message);
}

try {
    const LZ4Codec = require('kafkajs-lz4');
    CompressionCodecs[CompressionTypes.LZ4] = new LZ4Codec();
    console.log('✅ LZ4 codec registered');
} catch (error) {
    console.log('❌ Failed to register LZ4 codec:', error.message);
}

// Configuration
const KAFKA_BROKER = process.env.KAFKA_BROKER || 'localhost:9092';
const TEST_TOPIC = 'test-compression-' + Date.now();
const TEST_GROUP = 'test-compression-group-' + Date.now();

console.log('\nTest Configuration:');
console.log('--------------------------------------------------');
console.log('Broker:', KAFKA_BROKER);
console.log('Topic:', TEST_TOPIC);
console.log('Group:', TEST_GROUP);

// Create Kafka client
const kafka = new kafkajs.Kafka({
    clientId: 'compression-integration-test',
    brokers: [KAFKA_BROKER],
    retry: {
        retries: 3,
        initialRetryTime: 300,
        factor: 2
    }
});

// Test messages
const testMessages = [
    {
        id: 'test-1',
        data: 'This is a test message with some data that can be compressed',
        timestamp: Date.now()
    },
    {
        id: 'test-2',
        data: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(10),
        timestamp: Date.now()
    },
    {
        id: 'test-3',
        data: 'Short',
        timestamp: Date.now()
    }
];

// Helper function to test a specific compression type
async function testCompressionType(compressionType, compressionName) {
    console.log(`\n📝 Testing ${compressionName} compression`);
    console.log('--------------------------------------------------');

    const producer = kafka.producer({
        allowAutoTopicCreation: true,
        transactionTimeout: 30000
    });

    const consumer = kafka.consumer({
        groupId: TEST_GROUP + '-' + compressionName.toLowerCase(),
        fromBeginning: true
    });

    try {
        // Connect producer and consumer
        console.log(`  Connecting producer...`);
        await producer.connect();
        console.log(`  ✅ Producer connected`);

        console.log(`  Connecting consumer...`);
        await consumer.connect();
        console.log(`  ✅ Consumer connected`);

        console.log(`  Subscribing to topic: ${TEST_TOPIC}`);
        await consumer.subscribe({ topic: TEST_TOPIC, fromBeginning: true });

        // Send messages with compression
        console.log(`  Sending ${testMessages.length} messages with ${compressionName} compression...`);
        const sendResult = await producer.send({
            topic: TEST_TOPIC,
            compression: compressionType,
            messages: testMessages.map(msg => ({
                key: msg.id,
                value: JSON.stringify(msg)
            }))
        });

        console.log(`  ✅ Messages sent successfully`);
        console.log(`     Partition: ${sendResult[0].partition}, Base Offset: ${sendResult[0].baseOffset}`);

        // Receive and verify messages
        let receivedMessages = [];
        let resolveReceive;
        const receivePromise = new Promise(resolve => {
            resolveReceive = resolve;
        });

        await consumer.run({
            eachMessage: async ({ topic, partition, message }) => {
                try {
                    const value = JSON.parse(message.value.toString());
                    receivedMessages.push(value);
                    console.log(`  📨 Received message: ${value.id}`);

                    if (receivedMessages.length >= testMessages.length) {
                        resolveReceive();
                    }
                } catch (error) {
                    console.log(`  ❌ Error parsing message: ${error.message}`);
                }
            }
        });

        // Wait for messages with timeout
        const timeout = setTimeout(() => {
            resolveReceive();
        }, 10000);

        await receivePromise;
        clearTimeout(timeout);

        // Verify messages
        console.log(`  Verifying received messages...`);
        let allVerified = true;
        for (const sentMsg of testMessages) {
            const receivedMsg = receivedMessages.find(m => m.id === sentMsg.id);
            if (receivedMsg && receivedMsg.data === sentMsg.data) {
                console.log(`  ✅ Message ${sentMsg.id} verified`);
            } else {
                console.log(`  ❌ Message ${sentMsg.id} verification failed`);
                allVerified = false;
            }
        }

        // Disconnect
        await producer.disconnect();
        await consumer.disconnect();

        if (allVerified) {
            console.log(`  ✅ ${compressionName} compression test PASSED`);
            return true;
        } else {
            console.log(`  ❌ ${compressionName} compression test FAILED`);
            return false;
        }

    } catch (error) {
        console.log(`  ❌ ${compressionName} test error: ${error.message}`);
        try {
            await producer.disconnect();
            await consumer.disconnect();
        } catch (disconnectError) {
            // Ignore disconnect errors
        }
        return false;
    }
}

// Main test function
async function runIntegrationTests() {
    console.log('\n🚀 Starting integration tests...');
    console.log('==================================================\n');

    // First, check if Kafka is available
    console.log('📝 Checking Kafka connection...');
    console.log('--------------------------------------------------');

    const admin = kafka.admin();
    try {
        await admin.connect();
        console.log('✅ Successfully connected to Kafka broker');
        await admin.disconnect();
    } catch (error) {
        console.log('❌ Cannot connect to Kafka broker:', error.message);
        console.log('\nℹ️  Skipping integration tests. To run these tests:');
        console.log('   1. Start a Kafka broker (e.g., docker-compose up kafka)');
        console.log('   2. Set KAFKA_BROKER environment variable if not using localhost:9092');
        console.log('   3. Run this test again\n');
        return false;
    }

    // Run tests for each compression type
    const results = {
        none: await testCompressionType(CompressionTypes.None, 'None'),
        gzip: await testCompressionType(CompressionTypes.GZIP, 'GZIP'),
        snappy: await testCompressionType(CompressionTypes.Snappy, 'Snappy'),
        lz4: await testCompressionType(CompressionTypes.LZ4, 'LZ4')
    };

    // Summary
    console.log('\n📊 Integration Test Summary');
    console.log('==================================================');
    console.log(`No Compression:    ${results.none ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`GZIP Compression:  ${results.gzip ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Snappy Compression: ${results.snappy ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`LZ4 Compression:    ${results.lz4 ? '✅ PASSED' : '❌ FAILED'}`);

    const allPassed = Object.values(results).every(r => r);

    if (allPassed) {
        console.log('\n🎉 All integration tests passed!');
        console.log('✅ All compression types can send and receive messages successfully');
        console.log('✅ LZ4 compression works end-to-end');
        return true;
    } else {
        console.log('\n⚠️  Some integration tests failed');
        return false;
    }
}

// Run tests
if (require.main === module) {
    runIntegrationTests()
        .then((success) => {
            process.exit(success ? 0 : 1);
        })
        .catch((error) => {
            console.error('❌ Unexpected error:', error);
            console.error(error.stack);
            process.exit(1);
        });
}

module.exports = runIntegrationTests;
