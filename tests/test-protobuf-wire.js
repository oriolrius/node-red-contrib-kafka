// Protobuf Confluent wire format helpers (js/protobuf-wire.js)
const { assert, run, summary } = require('./helpers');
const w = require('../js/protobuf-wire');

const PROTO = `syntax = "proto3";
package acme.iot;
enum Kind { UNKNOWN = 0; TEMP = 1; }
message First { string id = 1; }
message Reading {
  string id = 1;
  double value = 2;
  Kind kind = 3;
  int64 ts = 4;
  message Tag { string k = 1; string v = 2; }
  repeated Tag tags = 5;
  map<string, string> labels = 6;
  bytes raw = 7;
}
message Other { message Deep { message Deeper { int32 x = 1; } } }
`;

// Captured from Confluent kafka-protobuf-console-producer (cp-schema-registry 7.9.2) with
// value.schema.id=1, input {"id":"from-confluent"}; schema ID 1 was this .proto (the registry
// keeps a normalised copy: same messages in the same order)
const CONFLUENT_SAMPLE = Buffer.from('0000000001000a0e66726f6d2d636f6e666c75656e74', 'hex');
const CONFLUENT_SAMPLE_SCHEMA = 'syntax = "proto3";\npackage acme;\nmessage First { string id = 1; }\nmessage Reading {\n  string id = 1;\n  double value = 2;\n  message Tag { string k = 1; string v = 2; }\n  repeated Tag tags = 3;\n}\n';

async function testProtobufWire() {
    console.log('\n🧪 Protobuf wire format tests');
    const root = w.parseSchema(PROTO);

    await run('message indexes follow declaration order, nested included', () => {
        const cases = { '': [0], First: [0], Reading: [1], 'acme.iot.Reading': [1], 'Reading.Tag': [1, 0], Other: [2], 'Other.Deep': [2, 0], 'Other.Deep.Deeper': [2, 0, 0] };
        for (const [name, indexes] of Object.entries(cases)) {
            assert.deepStrictEqual(w.messageIndexes(w.resolveType(root, name)), indexes, name);
            assert.strictEqual(w.typeFromIndexes(root, indexes), w.resolveType(root, name), name);
        }
    });

    await run('index encoding matches the Confluent varint format', () => {
        const vectors = [[[0], '00'], [[1], '0202'], [[1, 0], '040200'], [[2, 0, 0], '06040000'], [[70], '028c01']];
        for (const [indexes, hex] of vectors) {
            assert.strictEqual(w.encodeIndexes(indexes).toString('hex'), hex, JSON.stringify(indexes));
            const decoded = w.decodeIndexes(Buffer.from(hex, 'hex'), 0);
            assert.deepStrictEqual(decoded.indexes, indexes);
            assert.strictEqual(decoded.offset, hex.length / 2);
        }
    });

    await run('decodes a message produced by the Confluent serializer', () => {
        const decoded = w.decodeConfluent(w.parseSchema(CONFLUENT_SAMPLE_SCHEMA), CONFLUENT_SAMPLE);
        assert.strictEqual(decoded.schemaId, 1);
        assert.strictEqual(decoded.type.name, 'First');
        assert.deepStrictEqual(decoded.value, { id: 'from-confluent' });
    });

    await run('Confluent framing round trip (header, indexes, JSON mapping)', () => {
        const type = w.resolveType(root, 'Reading');
        const payload = { id: 'r1', value: 21.5, kind: 'TEMP', ts: '1792653673423', tags: [{ k: 'room', v: 'lab' }], labels: { site: 'bcn' }, raw: 'AAEC' };
        const buffer = w.encodeConfluent(4242, type, payload);
        assert.strictEqual(buffer.readUInt8(0), 0);
        assert.strictEqual(buffer.readInt32BE(1), 4242);
        assert.strictEqual(buffer.subarray(5, 7).toString('hex'), '0202');
        const decoded = w.decodeConfluent(root, buffer);
        assert.strictEqual(decoded.type, type);
        assert.deepStrictEqual(decoded.value, payload);
    });

    await run('nested type round trip resolves the right message', () => {
        const type = w.resolveType(root, 'Other.Deep.Deeper');
        const decoded = w.decodeConfluent(root, w.encodeConfluent(7, type, { x: -3 }));
        assert.strictEqual(decoded.type.fullName, '.acme.iot.Other.Deep.Deeper');
        assert.deepStrictEqual(decoded.value, { x: -3 });
    });

    await run('raw encoding is plain Protobuf (no header)', () => {
        const type = w.resolveType(root, 'First');
        const buffer = w.encodeRaw(type, { id: 'x' });
        assert.strictEqual(buffer.toString('hex'), '0a0178');
        assert.deepStrictEqual(w.decodeRaw(type, buffer), { id: 'x' });
    });

    await run('strict validation rejects wrong types, unknown fields and bad enums', () => {
        const type = w.resolveType(root, 'Reading');
        const bad = [
            [{ id: 1 }, /id: string expected/],
            [{ value: '3' }, /value: number expected/],
            [{ kind: 'NOPE' }, /kind: enum Kind/],
            [{ ts: '1.5' }, /ts: int64 expected/],
            [{ nope: true }, /nope: unknown field/],
            [{ tags: [{ k: 'a', zz: 1 }] }, /tags\[0\]\.zz: unknown field/],
            [{ tags: { k: 'a' } }, /tags: array expected/],
            [{ labels: { a: 1 } }, /labels\[a\]: string expected/],
            ['text', /object expected/],
            [[1, 2], /object expected/]
        ];
        for (const [payload, pattern] of bad) {
            assert.throws(() => w.encodeRaw(type, payload), pattern, JSON.stringify(payload));
        }
        assert.doesNotThrow(() => w.encodeRaw(type, { kind: 1, ts: 5, id: null }));
    });

    await run('schema and header errors are explicit', () => {
        assert.throws(() => w.parseSchema(''), /empty/);
        assert.throws(() => w.resolveType(root, 'Missing'), /Message type "Missing" not found/);
        assert.throws(() => w.resolveType(w.parseSchema('syntax = "proto3"; enum E { A = 0; }'), ''), /no message type/);
        assert.throws(() => w.readHeader(Buffer.from('01000000010a', 'hex')), /magic byte/);
        assert.throws(() => w.readHeader(Buffer.from('0000', 'hex')), /too short/);
        assert.throws(() => w.typeFromIndexes(root, [9]), /No message type/);
    });

    await run('schema decoder: Protobuf decoded locally, other schemas delegated, lookups cached', async () => {
        const lookups = [];
        const registry = {
            api: { Schema: { find: async ({ id }) => { lookups.push(id); return { data: () => (id === 1 ? { schemaType: 'PROTOBUF', schema: CONFLUENT_SAMPLE_SCHEMA } : { schema: '{"type":"string"}' }) }; } } },
            decode: async () => 'avro-decoded'
        };
        const decoder = w.createSchemaDecoder(registry);
        assert.deepStrictEqual(await decoder.decode(CONFLUENT_SAMPLE), { id: 'from-confluent' });
        assert.deepStrictEqual(await decoder.decode(CONFLUENT_SAMPLE), { id: 'from-confluent' });
        assert.strictEqual(await decoder.decode(Buffer.from('000000000206', 'hex')), 'avro-decoded');
        assert.deepStrictEqual(lookups, [1, 2]);
    });

    summary('Protobuf wire format');
}

module.exports = testProtobufWire;

if (require.main === module) {
    testProtobufWire().then(() => process.exit(0), err => { console.error(err.message); process.exit(1); });
}
