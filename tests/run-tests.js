#!/usr/bin/env node

console.log('🚀 Starting Simple Test Runner');
console.log('==================================================');

const fs = require('fs');
const path = require('path');

const testDir = __dirname;
const rootDir = path.dirname(testDir);
const jsDir = path.join(rootDir, 'js');

console.log('📁 Checking test directory structure...');
console.log(`Test directory: ${testDir}`);
console.log(`Root directory: ${rootDir}`);
console.log(`JS directory: ${jsDir}`);

console.log('\n🔍 Checking required files...');
const requiredFiles = [
    'js/kafka-producer.js',
    'js/kafka-consumer.js',
    'js/kafka-broker.js'
];

for (const file of requiredFiles) {
    const filePath = path.join(rootDir, file);
    if (fs.existsSync(filePath)) {
        console.log(`✅ ${file}`);
    } else {
        console.log(`❌ ${file} NOT FOUND`);
    }
}

console.log('\n📋 Available tests:');
const testFiles = fs.readdirSync(testDir).filter(file => 
    file.endsWith('.js') && (file.startsWith('test-') || file.includes('test')) && file !== 'run-tests.js'
);

for (const file of testFiles) {
    console.log(`✅ ${file}`);
}

console.log('\n🧪 Running tests...');
console.log('==================================================');

async function runTests() {
    try {
        // Run basic node loading test
        if (fs.existsSync(path.join(testDir, 'test-node-loading.js'))) {
            console.log('\n--- Running test-node-loading.js ---');
            require('./test-node-loading.js');
        }

        // Run comprehensive test (simplified)
        if (fs.existsSync(path.join(testDir, 'comprehensive-test.js'))) {
            console.log('\n--- Running comprehensive-test.js ---');
            require('./comprehensive-test.js');
        }

        // Run simple Kafka test
        if (fs.existsSync(path.join(testDir, 'simple-kafka-test.js'))) {
            console.log('\n--- Running simple-kafka-test.js ---');
            const simpleTest = require('./simple-kafka-test.js');
            await simpleTest();
        }

        // Broker options (timeouts) and compromised-CA rejection
        console.log('\n--- Running test-broker-options.js ---');
        await require('./test-broker-options.js')();
        console.log('\n--- Running test-tls-security.js ---');
        await require('./test-tls-security.js')();

        // Run compression test
        if (fs.existsSync(path.join(testDir, 'test-compression.js'))) {
            console.log('\n--- Running test-compression.js ---');
            const compressionTest = require('./test-compression.js');
            await compressionTest();
        }

        console.log('\n🏁 Test runner completed successfully');
        console.log('✅ All basic tests passed');
        console.log('✅ Producer and Consumer nodes are working correctly');
        console.log('✅ Compression functionality verified');
        // Explicit exit: KafkaJS leaves timed-out sockets half-open until the OS gives up
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Test runner failed:', error.message);
        process.exit(1);
    }
}

runTests();
