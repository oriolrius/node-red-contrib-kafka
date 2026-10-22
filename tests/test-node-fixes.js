// Regression tests for the 6.2.1 fixes: producer IoT formatting, producer error reporting,
// schema consumer start-up without subject, Avro values as plain objects
const http = require('http');
const path = require('path');
const avro = require('avsc');
const { assert, loadNode, createNode, closeNode, fakeBroker, tick, run, summary } = require('./helpers');
const { toPlain } = require('../js/protobuf-wire');

const AVRO_SCHEMA = { type: 'record', name: 'Event', fields: [{ name: 'id', type: 'string' }, { name: 'count', type: 'int' }, { name: 'tags', type: { type: 'array', items: { type: 'record', name: 'Tag', fields: [{ name: 'k', type: 'string' }] } } }] };
const AVRO_TYPE = avro.Type.forSchema(AVRO_SCHEMA);

// Minimal Schema Registry: subject "known-value" -> schema 1 (Avro), anything else -> 40401
function fakeRegistryServer() {
    const server = http.createServer((req, res) => {
        const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/vnd.schemaregistry.v1+json' }); res.end(JSON.stringify(body)); };
        let m;
        if ((m = req.url.match(/^\/subjects\/([^/]+)\/versions\/latest$/))) {
            return decodeURIComponent(m[1]) === 'known-value'
                ? send(200, { subject: 'known-value', version: 1, id: 1, schema: JSON.stringify(AVRO_SCHEMA) })
                : send(404, { error_code: 40401, message: `Subject '${decodeURIComponent(m[1])}' not found.` });
        }
        if (req.url === '/schemas/ids/1') {
            return send(200, { schema: JSON.stringify(AVRO_SCHEMA) });
        }
        send(404, { error_code: 40403, message: 'Schema not found' });
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

function avroMessage(value) {
    const header = Buffer.alloc(5);
    header.writeInt32BE(1, 1);
    return Buffer.concat([header, AVRO_TYPE.toBuffer(value)]);
}

function producerNode(config, brokerOptions) {
    const broker = fakeBroker(brokerOptions);
    const Producer = loadNode(path.join(__dirname, '..', 'js', 'kafka-producer.js'), { b1: broker });
    const node = createNode(Producer, Object.assign({ broker: 'b1', topic: 't1', requireAcks: 1, ackTimeoutMs: 1000, attributes: 0 }, config));
    return { node, broker };
}

async function consumerNode(config) {
    const broker = fakeBroker();
    const Consumer = loadNode(path.join(__dirname, '..', 'js', 'kafka-consumer.js'), { b1: broker });
    const node = createNode(Consumer, Object.assign({ broker: 'b1', topic: 't1', groupid: 'g', fromOffset: 'earliest', encoding: 'utf8' }, config));
    for (let i = 0; i < 50 && !broker.consumerState.running && node.errors.length === 0; i++) {
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    return { node, broker };
}

const IOT_FIELDS = [{ fieldName: 'name', dataType: 'TEXT' }, { fieldName: 'freeNum', dataType: 'INT32' }];

async function testNodeFixes() {
    console.log('\n🧪 6.2.1 fixes');
    const quiet = console.log;

    await run('producer IoT: object payload -> documented mc/dc/type/nameTypes/ts/values format', async () => {
        const { node, broker } = producerNode({ useiot: true, model: 'M1', device: 'D1', iotType: 'props', fields: IOT_FIELDS });
        await tick();
        console.log = () => {}; // utils.js logs every step
        try {
            await node.handlers.input({ payload: { name: 'lot A', freeNum: 12, extra: 'ignored' } });
        } finally {
            console.log = quiet;
        }
        assert.strictEqual(node.errors.length, 0, node.errors.join('\n'));
        const value = JSON.parse(broker.sent[0].messages[0].value);
        assert.deepStrictEqual(Object.keys(value), ['mc', 'dc', 'type', 'nameTypes', 'ts', 'values']);
        assert.deepStrictEqual([value.mc, value.dc, value.type], ['M1', 'D1', 'props']);
        assert.deepStrictEqual(value.nameTypes, ['name:TEXT', 'freeNum:INT32']);
        assert.deepStrictEqual(value.values, [['lot A', 12]]);
        assert.strictEqual(value.ts.length, 1);
        assert.ok(Number.isInteger(value.ts[0]));
        await closeNode(node);
    });

    await run('producer IoT: array payload -> one record and timestamp per item, missing fields null', async () => {
        const { node, broker } = producerNode({ useiot: true, model: 'M1', device: 'D1', iotType: 'props', fields: IOT_FIELDS });
        await tick();
        console.log = () => {};
        try {
            await node.handlers.input({ payload: [{ name: 'a', freeNum: 1 }, { name: 'b' }] });
        } finally {
            console.log = quiet;
        }
        const value = JSON.parse(broker.sent[0].messages[0].value);
        assert.deepStrictEqual(value.values, [['a', 1], ['b', null]]);
        assert.strictEqual(value.ts.length, 2);
        await closeNode(node);
    });

    await run('producer errors go to node.error with the msg (Catch node), no phantom 2nd output', async () => {
        const { node } = producerNode({}, { sendError: 'broker exploded' });
        await tick();
        await node.handlers.input({ payload: { id: 1 }, topic: 'x' });
        assert.strictEqual(node.sent.length, 0);
        assert.match(node.errors[0], /broker exploded/);
        assert.strictEqual(node.errorMsgs[0].payload.error, 'broker exploded');
        assert.deepStrictEqual(node.errorMsgs[0].payload.originalMessage.payload, { id: 1 });
        assert.strictEqual(node.errorMsgs[0].topic, 'x');
        await closeNode(node);
    });

    const registry = await fakeRegistryServer();
    try {
        await run('schema consumer starts even if the subject does not exist yet', async () => {
            const { node, broker } = await consumerNode({ useSchemaValidation: true, registryUrl: registry.url, schemaSubject: 'missing-value' });
            assert.strictEqual(broker.consumerState.running, true, `consumer not running: ${node.errors.join('; ')}`);
            assert.strictEqual(node.errors.length, 0);
            assert.match(node.warnings[0], /Schema subject 'missing-value' not found; consuming anyway/);
            await broker.deliver(avroMessage({ id: 'e1', count: 3, tags: [{ k: 'a' }] }));
            assert.deepStrictEqual(node.sent[0].payload, { id: 'e1', count: 3, tags: [{ k: 'a' }] });
            await closeNode(node);
        });

        await run('schema consumer outputs Avro records as plain objects', async () => {
            const { node, broker } = await consumerNode({ useSchemaValidation: true, registryUrl: registry.url, schemaSubject: 'known-value' });
            assert.strictEqual(broker.consumerState.running, true);
            await broker.deliver(avroMessage({ id: 'e2', count: 5, tags: [{ k: 'x' }, { k: 'y' }] }));
            const payload = node.sent[0].payload;
            assert.strictEqual(Object.getPrototypeOf(payload), Object.prototype);
            assert.strictEqual(Object.getPrototypeOf(payload.tags[0]), Object.prototype);
            assert.deepStrictEqual(payload, { id: 'e2', count: 5, tags: [{ k: 'x' }, { k: 'y' }] });
            await closeNode(node);
        });

        await run('schema consumer still stops on other registry errors', async () => {
            const { node, broker } = await consumerNode({ useSchemaValidation: true, registryUrl: 'http://127.0.0.1:9', schemaSubject: 'known-value' });
            await new Promise(resolve => setTimeout(resolve, 200));
            assert.strictEqual(broker.consumerState.running, false);
            assert.ok(node.errors.length > 0);
            await closeNode(node);
        });
    } finally {
        registry.close();
    }

    await run('toPlain keeps Buffers, Dates and scalars, flattens class instances', () => {
        class Rec { constructor() { this.a = 1; this.b = Buffer.from('x'); this.c = new Date(0); this.d = [new Rec2()]; } }
        class Rec2 { constructor() { this.z = null; } }
        const plain = toPlain(new Rec());
        assert.strictEqual(Object.getPrototypeOf(plain), Object.prototype);
        assert.ok(Buffer.isBuffer(plain.b));
        assert.ok(plain.c instanceof Date);
        assert.strictEqual(Object.getPrototypeOf(plain.d[0]), Object.prototype);
        assert.strictEqual(toPlain('s'), 's');
        assert.strictEqual(toPlain(null), null);
    });

    summary('6.2.1 fixes');
}

module.exports = testNodeFixes;

if (require.main === module) {
    testNodeFixes().then(() => process.exit(0), err => { console.error(err.message); process.exit(1); });
}
