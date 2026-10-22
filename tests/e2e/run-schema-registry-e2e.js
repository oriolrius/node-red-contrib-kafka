#!/usr/bin/env node
/**
 * Schema Registry end-to-end tests: Kafka + Confluent Schema Registry (docker compose,
 * profile "registry") + embedded Node-RED. Covers Avro (regression) and Protobuf in
 * registry and raw modes, plus interoperability with Confluent's own Protobuf
 * console producer/consumer. Run from the project root:
 *   npm run test:e2e:registry
 */
const assert = require('assert');
const protobuf = require('protobufjs');
const h = require('./harness');

const RUN = Date.now();
const topic = (name) => `sr-${name}-${RUN}`;
const REGISTRY = 'http://localhost:58081';

const PROTO = `syntax = "proto3";
package acme.iot;
enum Kind { UNKNOWN = 0; TEMP = 1; HUMIDITY = 2; }
message Header { string source = 1; }
message Reading {
  string id = 1;
  double value = 2;
  Kind kind = 3;
  int64 ts = 4;
  message Tag { string k = 1; string v = 2; }
  repeated Tag tags = 5;
  map<string, string> labels = 6;
}
`;

const AVRO = JSON.stringify({ type: 'record', name: 'Event', fields: [{ name: 'id', type: 'string' }, { name: 'count', type: 'int' }] });

const broker = () => ({ id: 'b', type: 'oriolrius-kafka-broker', name: 'Broker', hosts: h.KAFKA_BROKER });

function producer(t, extra) {
    return Object.assign({
        id: 'p', type: 'oriolrius-kafka-producer', broker: 'b', topic: t,
        requireAcks: 1, ackTimeoutMs: 5000, attributes: 0, useiot: false, useSchemaValidation: true,
        registryUrl: REGISTRY, schemaSubject: `${t}-value`, schemaVersion: 'latest', wires: [[]]
    }, extra);
}

function consumer(t, extra) {
    return Object.assign({
        id: 'c', type: 'oriolrius-kafka-consumer', broker: 'b', topic: t, groupid: `c-${t}`,
        fromOffset: 'earliest', encoding: 'utf8', useSchemaValidation: true,
        registryUrl: REGISTRY, schemaSubject: `${t}-value`, wires: [[]]
    }, extra);
}

// Publishes payloads with a producer-only flow and waits for each success output
async function publish(producerConfig, payloads) {
    const captured = await h.deploy([broker(), producerConfig], ['p']);
    await h.waitReady('p');
    for (const [i, payload] of payloads.entries()) {
        h.getNode('p').receive({ payload });
        await h.waitFor(() => captured.p.length > i, { what: 'producer output' });
    }
    return captured.p;
}

// Starts a schema-validating consumer on the topic and returns the first `count` payloads
async function consume(t, count, extra) {
    const captured = await h.deploy([broker(), consumer(t, extra)], ['c']);
    await h.waitFor(() => captured.c.length >= count, { timeout: 30000, what: `${count} consumed message(s)` });
    return captured.c.map(m => m.payload);
}

const tests = [
    ['Avro regression: auto-register, publish, consume with schema decoding', async () => {
        const t = topic('avro');
        await h.createTopics([t]);
        await h.registerSchema(`${t}-value`, 'AVRO', AVRO); // the consumer needs the subject at start
        const out = await publish(producer(t, { autoRegister: true, autoSchema: AVRO }), [{ id: 'e1', count: 3 }]);
        assert.strictEqual(out[0].payload.success, true);
        // Avro values come back as avsc record instances (unchanged behaviour): compare by value
        assert.deepStrictEqual(JSON.parse(JSON.stringify(await consume(t, 1))), [{ id: 'e1', count: 3 }]);
    }],

    ['Protobuf + registry, local .proto auto-registered, non-first message type', async () => {
        const t = topic('proto-local');
        await h.createTopics([t]);
        const payload = { id: 'r1', value: 21.5, kind: 'TEMP', ts: '1792653673423', tags: [{ k: 'room', v: 'lab' }], labels: { site: 'bcn' } };
        const out = await publish(producer(t, {
            serializationType: 'protobuf', protobufMode: 'registry', protobufSchema: PROTO,
            protobufMessageName: 'Reading', autoRegister: true
        }), [payload]);
        assert.strictEqual(out[0].payload.success, true);
        const subject = await (await fetch(`${REGISTRY}/subjects/${t}-value/versions/latest`)).json();
        assert.strictEqual(subject.schemaType, 'PROTOBUF');
        assert.deepStrictEqual(await consume(t, 1), [payload]);
    }],

    ['Protobuf + registry, schema read from the registry, nested message type', async () => {
        const t = topic('proto-remote');
        await h.createTopics([t]);
        const id = await h.registerSchema(`${t}-value`, 'PROTOBUF', PROTO);
        const out = await publish(producer(t, {
            serializationType: 'protobuf', protobufMode: 'registry', protobufSchema: '', protobufMessageName: 'Reading.Tag'
        }), [{ k: 'nested', v: 'ok' }]);
        assert.strictEqual(out[0].payload.schemaId, id);
        assert.deepStrictEqual(await consume(t, 1), [{ k: 'nested', v: 'ok' }]);
    }],

    ['Interop: Confluent kafka-protobuf-console-consumer reads what the node publishes', async () => {
        const t = topic('proto-to-confluent');
        await h.createTopics([t]);
        await publish(producer(t, {
            serializationType: 'protobuf', protobufMode: 'registry', protobufSchema: PROTO,
            protobufMessageName: 'Reading', autoRegister: true
        }), [{ id: 'c1', value: 1.25, kind: 'HUMIDITY', tags: [{ k: 'a', v: 'b' }] }]);
        const out = await h.registryExec(`timeout 60 kafka-protobuf-console-consumer --bootstrap-server broker:19092 --topic ${t} --from-beginning --max-messages 1 --property schema.registry.url=http://localhost:8081 2>/dev/null`);
        const line = out.split('\n').find(l => l.startsWith('{'));
        // Confluent's JSON printer also lists fields left at their default value
        assert.deepStrictEqual(JSON.parse(line), { id: 'c1', value: 1.25, kind: 'HUMIDITY', ts: '0', tags: [{ k: 'a', v: 'b' }], labels: {} });
    }],

    ['Interop: the consumer node reads what Confluent kafka-protobuf-console-producer publishes', async () => {
        const t = topic('confluent-to-proto');
        await h.createTopics([t]);
        const id = await h.registerSchema(`${t}-value`, 'PROTOBUF', PROTO);
        await h.registryExec(`timeout 60 kafka-protobuf-console-producer --bootstrap-server broker:19092 --topic ${t} --property schema.registry.url=http://localhost:8081 --property value.schema.id=${id} 2>/dev/null`,
            '{"source":"confluent-cli"}\n');
        // value.schema.id without a message name uses the first message of the schema (Header)
        const [payload] = await consume(t, 1);
        assert.deepStrictEqual(payload, { source: 'confluent-cli' });
    }],

    ['Protobuf raw mode: plain Protobuf bytes, decodable with protobufjs', async () => {
        const t = topic('proto-raw');
        await h.createTopics([t]);
        await publish(producer(t, {
            serializationType: 'protobuf', protobufMode: 'raw', protobufSchema: PROTO, protobufMessageName: 'Reading', registryUrl: ''
        }), [{ id: 'raw1', value: 9 }]);
        const [message] = await h.readTopic(t, 1);
        const Reading = protobuf.parse(PROTO, { keepCase: true }).root.lookupType('acme.iot.Reading');
        assert.deepStrictEqual(Reading.toObject(Reading.decode(message.value)), { id: 'raw1', value: 9 });
    }],

    ['Invalid Protobuf payload is rejected and nothing is published', async () => {
        const t = topic('proto-invalid');
        await h.createTopics([t]);
        const captured = await h.deploy([broker(), producer(t, {
            serializationType: 'protobuf', protobufMode: 'registry', protobufSchema: PROTO, protobufMessageName: 'Reading', autoRegister: true
        })], ['p']);
        await h.waitReady('p');
        const node = h.getNode('p');
        const errors = [];
        const error = node.error.bind(node);
        node.error = (msg, ...rest) => { errors.push(String(msg)); return error(msg, ...rest); };
        node.receive({ payload: { id: 7, unknown: true } });
        await h.waitFor(() => errors.length > 0, { what: 'validation error' });
        assert.match(errors[0], /Protobuf validation error: id: string expected; unknown: unknown field/);
        await h.sleep(1000);
        assert.strictEqual(captured.p.length, 0, 'no success output');
        assert.strictEqual(await h.topicSize(t), 0, 'topic must stay empty');
    }]
];

h.runSuite('Schema Registry E2E', tests, {
    setup: async () => { await h.startKafka({ registry: true }); await h.startNodeRED(); },
    teardown: async () => { await h.stopNodeRED(); await h.stopKafka(); }
});
