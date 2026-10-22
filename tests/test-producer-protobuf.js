// Kafka Send node: Protobuf serialization (issue #2 / PR #4) and Avro / plain regressions
const path = require('path');
const { assert, loadNode, createNode, closeNode, fakeBroker, tick, run, summary } = require('./helpers');
const w = require('../js/protobuf-wire');

const PROTO = 'syntax = "proto3";\npackage acme;\nmessage First { string id = 1; }\nmessage Reading {\n  string id = 1;\n  double value = 2;\n  message Tag { string k = 1; }\n  repeated Tag tags = 3;\n}\n';
const ROOT = w.parseSchema(PROTO);

// Schema Registry double recording every call
function fakeRegistry({ registeredId = null, latestId = 11, schemas = {} } = {}) {
    const calls = [];
    return {
        calls,
        getRegistryIdBySchema: async (subject, schema) => {
            calls.push(['getRegistryIdBySchema', subject, schema.type]);
            if (registeredId === null) {
                const err = new Error('Schema not found'); err.status = 404; throw err;
            }
            return registeredId;
        },
        getLatestSchemaId: async (subject) => { calls.push(['getLatestSchemaId', subject]); return latestId; },
        getRegistryId: async (subject, version) => { calls.push(['getRegistryId', subject, version]); return 30 + version; },
        api: {
            Schema: { find: async ({ id }) => { calls.push(['find', id]); return { data: () => schemas[id] }; } },
            Subject: { register: async ({ subject, body }) => { calls.push(['register', subject, body.schemaType]); return { data: () => ({ id: 77 }) }; } }
        },
        encode: async (id, payload) => { calls.push(['encode', id]); return Buffer.from(`avro:${id}:${JSON.stringify(payload)}`); }
    };
}

async function producer(config, registry) {
    const broker = fakeBroker();
    const Producer = loadNode(path.join(__dirname, '..', 'js', 'kafka-producer.js'), { b1: broker });
    const node = createNode(Producer, Object.assign({ broker: 'b1', topic: 't1', requireAcks: 1, ackTimeoutMs: 1000, attributes: 0 }, config));
    if (registry) {
        node.schemaRegistry = registry;
    }
    await tick();
    return { node, broker };
}

async function send(node, payload) {
    await node.handlers.input({ payload });
}

const protobufConfig = (extra) => Object.assign({
    useSchemaValidation: true, serializationType: 'protobuf', protobufMode: 'registry',
    protobufSchema: PROTO, protobufMessageName: 'Reading', registryUrl: 'http://registry:8081', schemaSubject: 'readings-value'
}, extra);

async function testProducerProtobuf() {
    console.log('\n🧪 Kafka Send Protobuf tests');

    await run('raw mode publishes plain Protobuf bytes, no registry', async () => {
        const { node, broker } = await producer(protobufConfig({ protobufMode: 'raw', registryUrl: '' }));
        assert.strictEqual(node.schemaRegistry, null);
        await send(node, { id: 'r1', value: 2.5, tags: [{ k: 'a' }] });
        const value = broker.sent[0].messages[0].value;
        assert.deepStrictEqual(w.decodeRaw(w.resolveType(ROOT, 'Reading'), value), { id: 'r1', value: 2.5, tags: [{ k: 'a' }] });
        assert.strictEqual(node.sent[0].payload.success, true);
        assert.strictEqual(node.errors.length, 0);
        await closeNode(node);
    });

    await run('raw mode without .proto fails at start', async () => {
        const { node, broker } = await producer(protobufConfig({ protobufMode: 'raw', protobufSchema: '' }));
        assert.match(node.errors[0], /needs a \.proto schema/);
        assert.strictEqual(node.ready, false);
        assert.strictEqual(broker.sent.length, 0);
        await closeNode(node);
    });

    await run('invalid .proto fails at start', async () => {
        const { node } = await producer(protobufConfig({ protobufSchema: 'syntax = "proto3"; message {' }));
        assert.match(node.errors[0], /Invalid \.proto schema/);
        await closeNode(node);
    });

    await run('registry + local .proto already registered: Confluent framing with its ID, cached', async () => {
        const registry = fakeRegistry({ registeredId: 5 });
        const { node, broker } = await producer(protobufConfig(), registry);
        await send(node, { id: 'r1', value: 1 });
        await send(node, { id: 'r2', value: 2 });
        const decoded = w.decodeConfluent(ROOT, broker.sent[1].messages[0].value);
        assert.strictEqual(decoded.schemaId, 5);
        assert.strictEqual(decoded.type.name, 'Reading');
        assert.deepStrictEqual(decoded.value, { id: 'r2', value: 2, tags: [] });
        assert.deepStrictEqual(registry.calls, [['getRegistryIdBySchema', 'readings-value', 'PROTOBUF']]);
        assert.strictEqual(node.sent[1].payload.schemaId, 5);
        await closeNode(node);
    });

    await run('registry + local .proto not registered + auto-register: registers it', async () => {
        const registry = fakeRegistry();
        const { node, broker } = await producer(protobufConfig({ autoRegister: true }), registry);
        await send(node, { id: 'r1' });
        assert.deepStrictEqual(registry.calls.map(c => c[0]), ['getRegistryIdBySchema', 'register']);
        assert.deepStrictEqual(registry.calls[1], ['register', 'readings-value', 'PROTOBUF']);
        assert.strictEqual(w.readHeader(broker.sent[0].messages[0].value).schemaId, 77);
        await closeNode(node);
    });

    await run('registry + local .proto not registered, no auto-register: error, nothing sent', async () => {
        const { node, broker } = await producer(protobufConfig(), fakeRegistry());
        await send(node, { id: 'r1' });
        assert.strictEqual(broker.sent.length, 0);
        assert.match(node.errors.join('\n'), /not registered under subject readings-value/);
        await closeNode(node);
    });

    await run('registry errors other than 404 are not treated as "not registered"', async () => {
        const registry = fakeRegistry();
        registry.getRegistryIdBySchema = async () => { const e = new Error('connect ECONNREFUSED'); e.status = undefined; throw e; };
        const { node, broker } = await producer(protobufConfig({ autoRegister: true }), registry);
        await send(node, { id: 'r1' });
        assert.strictEqual(broker.sent.length, 0);
        assert.match(node.errors.join('\n'), /ECONNREFUSED/);
        await closeNode(node);
    });

    await run('registry without local .proto: schema read from the registry (latest and fixed version)', async () => {
        const schemas = { 11: { schemaType: 'PROTOBUF', schema: PROTO }, 32: { schemaType: 'PROTOBUF', schema: PROTO } };
        for (const [schemaVersion, expectedId, lookup] of [['latest', 11, 'getLatestSchemaId'], ['2', 32, 'getRegistryId']]) {
            const registry = fakeRegistry({ schemas });
            const { node, broker } = await producer(protobufConfig({ protobufSchema: '', protobufMessageName: 'Reading.Tag', schemaVersion }), registry);
            await send(node, { k: 'nested' });
            const decoded = w.decodeConfluent(ROOT, broker.sent[0].messages[0].value);
            assert.strictEqual(decoded.schemaId, expectedId);
            assert.strictEqual(decoded.type.fullName, '.acme.Reading.Tag');
            assert.deepStrictEqual(registry.calls.map(c => c[0]), [lookup, 'find']);
            await closeNode(node);
        }
    });

    await run('registry schema that is not Protobuf is refused', async () => {
        const registry = fakeRegistry({ schemas: { 11: { schema: '{"type":"string"}' } } });
        const { node, broker } = await producer(protobufConfig({ protobufSchema: '' }), registry);
        await send(node, { id: 'r1' });
        assert.strictEqual(broker.sent.length, 0);
        assert.match(node.errors.join('\n'), /is AVRO, not PROTOBUF/);
        await closeNode(node);
    });

    await run('invalid payload: validation error, nothing published', async () => {
        const { node, broker } = await producer(protobufConfig(), fakeRegistry({ registeredId: 5 }));
        await send(node, { id: 'r1', value: 'not a number', extra: 1 });
        assert.strictEqual(broker.sent.length, 0);
        assert.match(node.errors[0], /value: number expected; extra: unknown field/);
        assert.match(node.errorMsgs[0].payload.error, /Protobuf validation error/);
        assert.strictEqual(node.sent.length, 0);
        await closeNode(node);
    });

    await run('JSON string payload is parsed before encoding', async () => {
        const { node, broker } = await producer(protobufConfig({ protobufMode: 'raw' }));
        await send(node, '{"id":"from-string"}');
        assert.deepStrictEqual(w.decodeRaw(w.resolveType(ROOT, 'Reading'), broker.sent[0].messages[0].value).id, 'from-string');
        await closeNode(node);
    });

    await run('validate-only mode reports and does not publish', async () => {
        const { node, broker } = await producer(protobufConfig({ validateOnly: true }), fakeRegistry({ registeredId: 5 }));
        await send(node, { id: 'r1' });
        assert.strictEqual(broker.sent.length, 0);
        assert.strictEqual(node.sent[0].payload.validated, true);
        assert.strictEqual(node.sent[0].payload.schemaId, 5);
        assert.ok(node.sent[0].payload.encodedSize > 5);
        await closeNode(node);
    });

    await run('Avro (no serializationType, flows saved before 6.2.0) still uses the registry client', async () => {
        const registry = fakeRegistry();
        const { node, broker } = await producer({ useSchemaValidation: true, registryUrl: 'http://registry:8081', schemaSubject: 'avro-value', protobufSchema: PROTO }, registry);
        assert.strictEqual(node.isProtobuf, false);
        await send(node, { id: 'a1' });
        assert.deepStrictEqual(registry.calls.map(c => c[0]), ['getLatestSchemaId', 'encode']);
        assert.strictEqual(broker.sent[0].messages[0].value.toString(), 'avro:11:{"id":"a1"}');
        await closeNode(node);
    });

    await run('plain mode unchanged: JSON value, key from id, compression attribute', async () => {
        const { node, broker } = await producer({ attributes: 1, serializationType: 'protobuf' });
        await send(node, { id: 42, text: 'hi' });
        const record = broker.sent[0];
        assert.strictEqual(record.compression, 1);
        assert.strictEqual(record.messages[0].value, '{"id":42,"text":"hi"}');
        assert.strictEqual(record.messages[0].key, '42');
        assert.strictEqual(node.sent[0].payload.success, true);
        await closeNode(node);
    });

    summary('Kafka Send Protobuf');
}

module.exports = testProducerProtobuf;

if (require.main === module) {
    testProducerProtobuf().then(() => process.exit(0), err => { console.error(err.message); process.exit(1); });
}
