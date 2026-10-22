// Shared E2E harness: Kafka (docker compose) + embedded Node-RED runtime loading ../../js
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const RED = require('node-red');
const { Kafka } = require('kafkajs');

const execAsync = promisify(exec);
const KAFKA_BROKER = 'localhost:58092';

let server;
let userDir;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeout = 30000, interval = 200, what = 'condition' } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await predicate()) {
            return;
        }
        await sleep(interval);
    }
    throw new Error(`Timed out after ${timeout} ms waiting for ${what}`);
}

async function dockerCompose(command) {
    return execAsync(`docker compose ${command}`, { cwd: __dirname });
}

async function startKafka() {
    console.log('📦 Starting Kafka container...');
    await dockerCompose('down -v');
    await dockerCompose('up -d --wait');
    console.log('✅ Kafka is ready\n');
}

async function stopKafka() {
    console.log('🛑 Stopping Kafka...');
    await dockerCompose('down -v').catch(() => {});
}

// Creates topics and waits until each one has a leader (a fresh KRaft broker can briefly refuse metadata)
async function createTopics(topics) {
    const admin = new Kafka({ clientId: 'e2e-admin', brokers: [KAFKA_BROKER], logLevel: 0 }).admin();
    await admin.connect();
    try {
        await waitFor(async () => {
            try {
                await admin.createTopics({ waitForLeaders: false, topics: topics.map(topic => ({ topic, numPartitions: 1 })) });
                const { topics: meta } = await admin.fetchTopicMetadata({ topics });
                return meta.every(t => t.partitions.length > 0 && t.partitions.every(p => p.leader >= 0));
            } catch (err) {
                return false;
            }
        }, { timeout: 30000, interval: 500, what: `topics ${topics.join(', ')}` });
    } finally {
        await admin.disconnect();
    }
}

async function startNodeRED() {
    console.log('🔴 Starting Node-RED runtime...');
    userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nrk-e2e-'));
    server = http.createServer();
    RED.init(server, {
        httpAdminRoot: false,
        httpNodeRoot: false,
        userDir,
        nodesDir: path.join(__dirname, '..', '..', 'js'),
        logging: { console: { level: 'error', metrics: false, audit: false } }
    });
    await new Promise(resolve => server.listen(0, resolve));
    await RED.start();
    console.log('✅ Node-RED runtime started\n');
}

async function stopNodeRED() {
    console.log('🛑 Stopping Node-RED...');
    try {
        await RED.nodes.setFlows([], null, 'full');
        await RED.stop();
    } catch (err) {
        // runtime may not have started
    }
    if (server) {
        server.close();
    }
    if (userDir) {
        fs.rmSync(userDir, { recursive: true, force: true });
    }
}

// Deploys a flow and records everything the given nodes send (by node id)
async function deploy(flow, captureIds = []) {
    await RED.nodes.setFlows(flow, null, 'full');
    // setFlows resolves before the new flow has started: wait for every node to exist
    await waitFor(() => flow.every(n => RED.nodes.getNode(n.id)), { timeout: 15000, what: 'flow start' });
    const captured = {};
    for (const id of captureIds) {
        const node = RED.nodes.getNode(id);
        captured[id] = [];
        const send = node.send.bind(node);
        node.send = (msg) => {
            captured[id].push(msg);
            return send(msg);
        };
    }
    return captured;
}

function getNode(id) {
    const node = RED.nodes.getNode(id);
    if (!node) {
        throw new Error(`Node ${id} not found`);
    }
    return node;
}

// Waits until a producer/consumer node reports ready
async function waitReady(id, timeout = 30000) {
    await waitFor(() => getNode(id).ready === true, { timeout, what: `${id} ready` });
}

// Accepts TCP connections and never answers (stalled broker / TLS handshake)
function silentServer() {
    const sockets = new Set();
    const srv = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({
        host: `127.0.0.1:${srv.address().port}`,
        close: () => { sockets.forEach(s => s.destroy()); srv.close(); }
    })));
}

// Tiny runner shared by the E2E suites
async function runSuite(name, tests, { setup, teardown } = {}) {
    console.log(`🚀 ${name}\n==================================================\n`);
    const results = [];
    try {
        if (setup) {
            await setup();
        }
        for (const [title, fn] of tests) {
            console.log(`📝 ${title}`);
            const start = Date.now();
            try {
                await fn();
                results.push(true);
                console.log(`  ✅ passed (${Date.now() - start} ms)\n`);
            } catch (err) {
                results.push(false);
                console.log(`  ❌ ${err.stack || err.message}\n`);
            }
        }
    } catch (err) {
        console.error(`❌ Setup failed: ${err.stack || err.message}`);
        results.push(false);
    } finally {
        if (teardown) {
            await teardown();
        }
    }
    const passed = results.filter(Boolean).length;
    console.log(`\n📊 ${name}: ${passed}/${results.length} passed`);
    process.exit(passed === results.length && results.length > 0 ? 0 : 1);
}

module.exports = {
    KAFKA_BROKER,
    RED,
    sleep,
    waitFor,
    startKafka,
    stopKafka,
    createTopics,
    startNodeRED,
    stopNodeRED,
    deploy,
    getNode,
    waitReady,
    silentServer,
    runSuite
};
