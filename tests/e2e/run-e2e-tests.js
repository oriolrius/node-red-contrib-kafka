#!/usr/bin/env node
/**
 * End-to-end tests: real Kafka (docker compose) + embedded Node-RED runtime
 * running this package's nodes. Run from the project root:
 *   node tests/e2e/run-e2e-tests.js
 */
const assert = require('assert');
const h = require('./harness');

const RUN = Date.now();
const topic = (name) => `e2e-${name}-${RUN}`;

function broker(id, extra = {}) {
    return Object.assign({ id, type: 'oriolrius-kafka-broker', name: 'Test Broker', hosts: h.KAFKA_BROKER }, extra);
}

function producer(id, brokerId, topicName, extra = {}) {
    return Object.assign({
        id, type: 'oriolrius-kafka-producer', broker: brokerId, topic: topicName,
        requireAcks: 1, ackTimeoutMs: 5000, attributes: 0, useSchemaValidation: false, useiot: false
    }, extra);
}

function consumer(id, brokerId, topicName, extra = {}) {
    return Object.assign({
        id, type: 'oriolrius-kafka-consumer', broker: brokerId, topic: topicName,
        groupid: `${id}-${RUN}`, fromOffset: 'earliest', encoding: 'utf8', useSchemaValidation: false, wires: [[]]
    }, extra);
}

const tests = [
    ['Basic producer -> consumer with explicit client timeouts (issue #3)', async () => {
        const t = topic('basic');
        await h.createTopics([t]);
        const captured = await h.deploy([
            broker('b1', { connectiontimeout: '3000', authenticationtimeout: '10000', requesttimeout: '20000' }),
            producer('p1', 'b1', t),
            consumer('c1', 'b1', t)
        ], ['c1']);
        const kafkaOptions = h.getNode('b1').getOptions();
        assert.strictEqual(kafkaOptions.connectionTimeout, 3000);
        assert.strictEqual(kafkaOptions.requestTimeout, 20000);
        await h.waitReady('p1');
        await h.waitReady('c1');

        const payload = { id: `msg-${RUN}`, message: 'Hello from E2E test!' };
        h.getNode('p1').receive({ payload });
        await h.waitFor(() => captured.c1.length >= 1, { what: 'message on consumer' });
        assert.deepStrictEqual(captured.c1[0].payload, payload);
        assert.strictEqual(captured.c1[0].topic, t);
    }],

    ['Compression: None, GZIP, Snappy, LZ4', async () => {
        const types = [['None', 0], ['GZIP', 1], ['Snappy', 2], ['LZ4', 3]];
        for (const [name, value] of types) {
            const t = topic(`comp-${name.toLowerCase()}`);
            await h.createTopics([t]);
            const captured = await h.deploy([
                broker('bc'),
                producer('pc', 'bc', t, { attributes: value }),
                consumer('cc', 'bc', t)
            ], ['cc']);
            await h.waitReady('pc');
            const payload = { compression: name, data: 'Test data for compression. '.repeat(50) };
            h.getNode('pc').receive({ payload });
            await h.waitFor(() => captured.cc.length >= 1, { what: `${name} message` });
            assert.deepStrictEqual(captured.cc[0].payload, payload);
            console.log(`  ✓ ${name}`);
        }
    }],

    ['Batch: 10 messages in order', async () => {
        const t = topic('batch');
        await h.createTopics([t]);
        const captured = await h.deploy([broker('bb'), producer('pb', 'bb', t), consumer('cb', 'bb', t)], ['cb']);
        await h.waitReady('pb');
        for (let i = 0; i < 10; i++) {
            h.getNode('pb').receive({ payload: { seq: i } });
            await h.sleep(50);
        }
        await h.waitFor(() => captured.cb.length >= 10, { what: '10 messages' });
        assert.deepStrictEqual(captured.cb.map(m => m.payload.seq), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }],

    ['Stalled TLS broker: producer never becomes ready', async () => {
        const server = await h.silentServer();
        try {
            await h.deploy([
                broker('bx', { hosts: server.host, usetls: true, selfsign: true, connectiontimeout: '400' }),
                producer('px', 'bx', topic('never'))
            ]);
            await h.sleep(1500);
            assert.notStrictEqual(h.getNode('px').ready, true, 'producer must not be ready');
        } finally {
            server.close();
        }
    }]
];

h.runSuite('Kafka nodes E2E', tests, {
    setup: async () => { await h.startKafka(); await h.startNodeRED(); },
    teardown: async () => { await h.stopNodeRED(); await h.stopKafka(); }
});
