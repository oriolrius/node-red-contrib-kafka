// Shared helpers for the assertion-based tests
const assert = require('assert');

// Minimal Node-RED runtime mock: loads a node module and returns its constructor.
// nodes: map of id -> object returned by RED.nodes.getNode (e.g. a fake broker)
function loadNode(modulePath, nodes = {}) {
    let Constructor;
    const RED = {
        nodes: {
            createNode: function (node, config) {
                node.warnings = [];
                node.errors = [];
                node.errorMsgs = [];
                node.statuses = [];
                node.sent = [];
                node.handlers = {};
                node.debug = () => {};
                node.log = () => {};
                node.warn = (msg) => node.warnings.push(msg);
                node.error = (text, msg) => { node.errors.push(text); node.errorMsgs.push(msg); };
                node.status = (status) => node.statuses.push(status);
                node.send = (msg) => node.sent.push(msg);
                node.on = (event, fn) => { node.handlers[event] = fn; };
            },
            registerType: function (type, ctor) {
                Constructor = ctor;
            },
            getNode: (id) => nodes[id] || null
        }
    };
    require(modulePath)(RED);
    return Constructor;
}

function createNode(Constructor, config) {
    const node = {};
    Constructor.call(node, config);
    return node;
}

// Closes a node created with createNode (clears intervals, disconnects clients)
function closeNode(node) {
    const close = node.handlers.close;
    if (!close) {
        return Promise.resolve();
    }
    // close(done) callback style, or async close() without parameters
    return close.length > 0 ? new Promise(resolve => close(resolve)) : Promise.resolve(close());
}

// Fake broker config node: the KafkaJS producer records what would be sent, the consumer
// keeps its eachMessage handler so tests can deliver messages (broker.deliver)
function fakeBroker({ sendError = null } = {}) {
    const sent = [];
    const consumerState = { subscribed: null, eachMessage: null, running: false };
    const producer = {
        connect: async () => {},
        disconnect: async () => {},
        on: () => {},
        send: async (record) => {
            if (sendError) {
                throw new Error(sendError);
            }
            sent.push(record);
            return [{ topicName: record.topic, partition: 0, errorCode: 0 }];
        }
    };
    const consumer = {
        connect: async () => {},
        disconnect: async () => {},
        subscribe: async (opts) => { consumerState.subscribed = opts; },
        run: async ({ eachMessage }) => { consumerState.eachMessage = eachMessage; consumerState.running = true; }
    };
    return {
        sent,
        consumerState,
        deliver: (value, topic = 't1') => consumerState.eachMessage({ topic, partition: 0, message: { value, offset: '0', key: null, timestamp: '0' } }),
        getKafka: () => ({ producer: () => producer, consumer: () => consumer }),
        getIotConfig: () => ({ useiot: false })
    };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

// Tiny test harness: run(name, fn) collects results; summary() exits non-zero on failure
const results = [];
async function run(name, fn) {
    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ✅ ${name}`);
    } catch (err) {
        results.push({ name, ok: false, err });
        console.log(`  ❌ ${name}\n     ${err.stack || err.message}`);
    }
}

function summary(suite) {
    const total = results.length;
    const failed = results.filter(r => !r.ok).length;
    results.length = 0;
    console.log(`\n${suite}: ${total - failed}/${total} passed`);
    if (failed > 0) {
        throw new Error(`${suite}: ${failed} test(s) failed`);
    }
}

module.exports = { assert, loadNode, createNode, closeNode, fakeBroker, tick, run, summary };
