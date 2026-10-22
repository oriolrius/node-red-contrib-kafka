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
const REGISTRY_URL = 'http://localhost:58081';

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

// registry: also start Confluent Schema Registry (compose profile "registry")
async function startKafka({ registry = false } = {}) {
    console.log(`📦 Starting Kafka${registry ? ' + Schema Registry' : ''} containers...`);
    await dockerCompose('--profile registry down -v');
    await dockerCompose(`${registry ? '--profile registry ' : ''}up -d --wait`);
    console.log('✅ Containers are ready\n');
}

async function stopKafka() {
    console.log('🛑 Stopping containers...');
    await dockerCompose('--profile registry down -v').catch(() => {});
}

// Registers a schema through the Schema Registry REST API, returns its ID
async function registerSchema(subject, schemaType, schema) {
    const res = await fetch(`${REGISTRY_URL}/subjects/${encodeURIComponent(subject)}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/vnd.schemaregistry.v1+json' },
        body: JSON.stringify(schemaType === 'AVRO' ? { schema } : { schemaType, schema })
    });
    const body = await res.json();
    if (!res.ok) {
        throw new Error(`Schema registration failed: ${JSON.stringify(body)}`);
    }
    return body.id;
}

// Runs a command inside the Schema Registry container (Confluent CLI tools)
async function registryExec(command, input) {
    const { spawn } = require('child_process');
    return new Promise((resolve, reject) => {
        const child = spawn('docker', ['exec', '-i', 'schema-registry-e2e-test', 'bash', '-c', command]);
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', d => { stdout += d; });
        child.stderr.on('data', d => { stderr += d; });
        child.on('error', reject);
        child.on('close', code => (code === 0 ? resolve(stdout) : reject(new Error(`exit ${code}: ${stderr.slice(-500)}`))));
        child.stdin.end(input || '');
    });
}

function kafkaClient() {
    return new Kafka({ clientId: 'e2e-client', brokers: [KAFKA_BROKER], logLevel: 0 });
}

// Reads every message of a topic from the beginning with plain KafkaJS (raw values)
async function readTopic(topic, count, timeout = 20000) {
    const consumer = kafkaClient().consumer({ groupId: `e2e-read-${topic}-${Date.now()}` });
    const messages = [];
    await consumer.connect();
    try {
        await consumer.subscribe({ topic, fromBeginning: true });
        await consumer.run({ eachMessage: async ({ message }) => { messages.push(message); } });
        await waitFor(() => messages.length >= count, { timeout, what: `${count} raw message(s) on ${topic}` });
    } finally {
        await consumer.disconnect();
    }
    return messages;
}

async function topicSize(topic) {
    const admin = kafkaClient().admin();
    await admin.connect();
    try {
        const offsets = await admin.fetchTopicOffsets(topic);
        return offsets.reduce((sum, p) => sum + Number(p.high) - Number(p.low), 0);
    } finally {
        await admin.disconnect();
    }
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
    RED.hooks.add('onSend.e2e', (events) => {
        for (const event of events) {
            const list = capture[event.source.id];
            if (list && !list.includes(event.msg)) {
                list.push(event.msg);
            }
        }
    });
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

// Messages sent by the captured nodes, filled by an onSend hook (registered before every
// deploy, so nothing is missed even when a node sends while the flow is still starting)
let capture = {};

// Deploys a flow and records everything the given nodes send (by node id). Their outputs
// are wired to a junction sink because Node-RED only runs send hooks for wired outputs.
async function deploy(flow, captureIds = []) {
    capture = {};
    for (const id of captureIds) {
        capture[id] = [];
    }
    const nodes = flow.map(n => (captureIds.includes(n.id)
        ? Object.assign({}, n, { wires: (n.wires && n.wires.length ? n.wires : [[]]).map(w => w.concat('e2e-sink')) })
        : n));
    if (captureIds.length > 0) {
        nodes.push({ id: 'e2e-sink', type: 'junction', wires: [] });
    }
    await RED.nodes.setFlows(nodes, null, 'full');
    // setFlows resolves before the new flow has started: wait for every node to exist
    await waitFor(() => flow.every(n => RED.nodes.getNode(n.id)), { timeout: 15000, what: 'flow start' });
    return capture;
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
    REGISTRY_URL,
    registerSchema,
    registryExec,
    readTopic,
    topicSize,
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
