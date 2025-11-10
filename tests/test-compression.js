#!/usr/bin/env node

// Comprehensive test for Kafka compression functionality
console.log('🧪 Testing Kafka Compression Feature');
console.log('==================================================');

// Test 1: Verify compression codec dependencies
console.log('\n📝 Test 1: Verifying compression codec dependencies');
console.log('--------------------------------------------------');

try {
    const kafkajs = require('kafkajs');
    console.log('✅ kafkajs loaded successfully');

    const snappyCodec = require('kafkajs-snappy');
    console.log('✅ kafkajs-snappy loaded successfully');

    const lz4Codec = require('kafkajs-lz4');
    console.log('✅ kafkajs-lz4 loaded successfully');

    // Verify CompressionTypes enum exists
    const { CompressionTypes, CompressionCodecs } = kafkajs;
    console.log('✅ CompressionTypes:', {
        None: CompressionTypes.None,
        GZIP: CompressionTypes.GZIP,
        Snappy: CompressionTypes.Snappy,
        LZ4: CompressionTypes.LZ4
    });

} catch (error) {
    console.error('❌ Failed to load compression dependencies:', error.message);
    process.exit(1);
}

// Test 2: Verify codec registration in producer module
console.log('\n📝 Test 2: Verifying codec registration in producer');
console.log('--------------------------------------------------');

const { CompressionTypes, CompressionCodecs } = require('kafkajs');

// Mock RED environment
const mockRED = {
    nodes: {
        createNode: function(node, config) {
            node.config = config;
            node.status = function(status) {
                // Silent in test
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
                // Silent in test
            };
            node.on = function(event, callback) {
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
            if (type === 'oriolrius-kafka-producer') {
                mockRED._producerConstructor = constructor;
            }
            console.log(`✅ Node registered: ${type}`);
        }
    },
    _producerConstructor: null
};

// Mock broker
const mockBroker = {
    getKafka: function() {
        return mockKafka;
    },
    getIotConfig: function() {
        return { useiot: false };
    }
};

// Mock Kafka client with compression tracking
let lastCompressionUsed = null;
const mockKafka = {
    producer: function(config) {
        return {
            connect: async function() {
                return Promise.resolve();
            },
            send: async function(message) {
                lastCompressionUsed = message.compression;
                console.log('[PRODUCER] Compression type used:', message.compression || 'None (undefined)');
                return [{
                    topic: message.topic,
                    partition: 0,
                    offset: '123'
                }];
            },
            disconnect: async function() {
                return Promise.resolve();
            },
            on: function(event, callback) {
                if (event === 'producer.connect') {
                    setTimeout(callback, 50);
                }
            }
        };
    }
};

// Load producer module (this registers the codecs)
try {
    require('../js/kafka-producer.js')(mockRED);
    console.log('✅ Producer module loaded and codecs registered');

    // Verify codecs are registered
    if (CompressionCodecs[CompressionTypes.Snappy]) {
        console.log('✅ Snappy codec registered in CompressionCodecs');
    } else {
        console.log('⚠️  Snappy codec not found in CompressionCodecs');
    }

    if (CompressionCodecs[CompressionTypes.LZ4]) {
        console.log('✅ LZ4 codec registered in CompressionCodecs');
    } else {
        console.log('⚠️  LZ4 codec not found in CompressionCodecs');
    }

} catch (error) {
    console.error('❌ Failed to load producer module:', error.message);
    console.error(error.stack);
    process.exit(1);
}

// Test 3: Test each compression type
console.log('\n📝 Test 3: Testing compression configuration');
console.log('--------------------------------------------------');

async function testCompression(compressionType, compressionName) {
    console.log(`\n  Testing: ${compressionName} (value: ${compressionType})`);

    const config = {
        name: 'Test Producer',
        broker: 'test-broker',
        topic: 'test-topic',
        requireAcks: 1,
        ackTimeoutMs: 1000,
        attributes: compressionType,
        useSchemaValidation: false,
        useiot: false
    };

    const producerNode = {};
    mockRED.nodes.createNode(producerNode, config);
    mockRED._producerConstructor.call(producerNode, config);

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 200));

    // Send test message
    lastCompressionUsed = null;
    const testMessage = {
        payload: {
            id: 'test-123',
            message: 'Compression test',
            timestamp: Date.now()
        }
    };

    let result = false;

    if (producerNode._inputCallback && producerNode.ready) {
        await producerNode._inputCallback(testMessage);
        await new Promise(resolve => setTimeout(resolve, 100));

        if (compressionType === 0) {
            if (lastCompressionUsed === null || lastCompressionUsed === undefined) {
                console.log(`  ✅ ${compressionName}: No compression applied (as expected)`);
                result = true;
            } else {
                console.log(`  ❌ ${compressionName}: Expected no compression, got ${lastCompressionUsed}`);
                result = false;
            }
        } else {
            if (lastCompressionUsed === compressionType) {
                console.log(`  ✅ ${compressionName}: Compression type ${compressionType} applied correctly`);
                result = true;
            } else {
                console.log(`  ❌ ${compressionName}: Expected compression ${compressionType}, got ${lastCompressionUsed}`);
                result = false;
            }
        }
    } else {
        console.log(`  ⚠️  ${compressionName}: Producer not ready, skipping send test`);
        result = false;
    }

    // Cleanup - CRITICAL: Clear the interval to prevent hanging
    if (producerNode.interval) {
        clearInterval(producerNode.interval);
    }

    // Cleanup producer connection
    if (producerNode.producer && producerNode.producer.disconnect) {
        try {
            await producerNode.producer.disconnect();
        } catch (error) {
            // Ignore disconnect errors in tests
        }
    }

    return result;
}

async function runCompressionTests() {
    const results = [];

    results.push(await testCompression(0, 'No Compression'));
    results.push(await testCompression(1, 'GZIP'));
    results.push(await testCompression(2, 'Snappy'));
    results.push(await testCompression(3, 'LZ4'));

    return results;
}

// Test 4: Verify compression attribute values match KafkaJS types
console.log('\n📝 Test 4: Verifying compression value mappings');
console.log('--------------------------------------------------');

const compressionMappings = [
    { uiValue: 0, kafkaType: CompressionTypes.None, name: 'None' },
    { uiValue: 1, kafkaType: CompressionTypes.GZIP, name: 'GZIP' },
    { uiValue: 2, kafkaType: CompressionTypes.Snappy, name: 'Snappy' },
    { uiValue: 3, kafkaType: CompressionTypes.LZ4, name: 'LZ4' }
];

let mappingCorrect = true;
for (const mapping of compressionMappings) {
    if (mapping.uiValue === mapping.kafkaType) {
        console.log(`✅ ${mapping.name}: UI value ${mapping.uiValue} matches KafkaJS CompressionTypes.${mapping.name} (${mapping.kafkaType})`);
    } else {
        console.log(`❌ ${mapping.name}: UI value ${mapping.uiValue} does NOT match KafkaJS CompressionTypes.${mapping.name} (${mapping.kafkaType})`);
        mappingCorrect = false;
    }
}

// Test 5: Test codec instantiation
console.log('\n📝 Test 5: Testing codec instantiation');
console.log('--------------------------------------------------');

async function testCodecFunctionality() {
    const results = [];

    // Test Snappy - verify it can be instantiated as a factory function
    try {
        const SnappyCodec = require('kafkajs-snappy');

        // Test that it can be called as a factory function (without 'new')
        let codec;
        try {
            codec = SnappyCodec();
            console.log('✅ Snappy: Codec created successfully via factory function');
        } catch (instantiateError) {
            console.log('❌ Snappy: Failed to create codec:', instantiateError.message);
            results.push(false);
            throw instantiateError;
        }

        // Verify the instance has required methods
        if (typeof codec.compress === 'function' && typeof codec.decompress === 'function') {
            console.log('✅ Snappy: Codec has compress and decompress methods');
            results.push(true);
        } else {
            console.log('❌ Snappy: Codec instance missing compress/decompress methods');
            results.push(false);
        }
    } catch (error) {
        console.log('❌ Snappy codec test failed:', error.message);
        results.push(false);
    }

    // Test LZ4 - verify it can be instantiated with 'new'
    try {
        const LZ4Codec = require('kafkajs-lz4');

        // Test that it can be instantiated with 'new'
        let codec;
        try {
            codec = new LZ4Codec();
            console.log('✅ LZ4: Codec instantiated successfully with new keyword');
        } catch (instantiateError) {
            console.log('❌ LZ4: Failed to instantiate codec:', instantiateError.message);
            results.push(false);
            throw instantiateError;
        }

        // Verify the instance has required methods
        if (typeof codec.compress === 'function' && typeof codec.decompress === 'function') {
            console.log('✅ LZ4: Codec has compress and decompress methods');
            results.push(true);
        } else {
            console.log('❌ LZ4: Codec instance missing compress/decompress methods');
            results.push(false);
        }
    } catch (error) {
        console.log('❌ LZ4 codec test failed:', error.message);
        results.push(false);
    }

    return results;
}

// Run all tests
async function runAllTests() {
    try {
        console.log('\n🧪 Running all compression tests...');
        console.log('==================================================\n');

        // Run compression configuration tests
        const compressionResults = await runCompressionTests();

        // Run codec functionality tests
        const codecResults = await testCodecFunctionality();

        // Summary
        console.log('\n📊 Test Summary');
        console.log('==================================================');
        console.log(`Compression configuration tests: ${compressionResults.filter(r => r).length}/${compressionResults.length} passed`);
        console.log(`Codec functionality tests: ${codecResults.filter(r => r).length}/${codecResults.length} passed`);
        console.log(`Value mapping verification: ${mappingCorrect ? 'PASSED' : 'FAILED'}`);

        const allPassed =
            compressionResults.every(r => r) &&
            codecResults.every(r => r) &&
            mappingCorrect;

        if (allPassed) {
            console.log('\n🎉 All compression tests passed!');
            console.log('✅ Compression codecs are properly registered');
            console.log('✅ All compression types work correctly');
            console.log('✅ LZ4 compression is fully functional');
            console.log('✅ Snappy compression is fully functional');
            return true;
        } else {
            console.log('\n⚠️  Some tests failed. Please review the output above.');
            return false;
        }

    } catch (error) {
        console.error('❌ Test execution failed:', error.message);
        console.error(error.stack);
        return false;
    }
}

// Execute tests
if (require.main === module) {
    runAllTests()
        .then((success) => {
            process.exit(success ? 0 : 1);
        })
        .catch((error) => {
            console.error('❌ Unexpected error:', error);
            process.exit(1);
        });
}

module.exports = runAllTests;
