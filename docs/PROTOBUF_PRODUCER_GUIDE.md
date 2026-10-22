# Kafka Send: Protobuf Serialization Guide

Since **v6.2.0** the Kafka Send node can serialize messages with Protobuf, next to the existing Avro support. The first version of this feature was contributed by [@YRoshcha](https://github.com/YRoshcha) in [#4](https://github.com/oriolrius/node-red-contrib-kafka/pull/4).

| Format | Settings | Bytes on the topic |
|--------|----------|--------------------|
| Avro | Format `Avro` (default) | Confluent wire format, Avro payload |
| Protobuf + Schema Registry | Format `Protobuf`, mode `Schema Registry` | Confluent wire format: magic byte, schema ID, message indexes, Protobuf payload |
| Protobuf raw | Format `Protobuf`, mode `Raw` | Plain Protobuf bytes, no header, no registry |

Messages written in Schema Registry mode can be read by any Confluent-compatible consumer (Java/Python/Go serializers, `kafka-protobuf-console-consumer`) and by the **Kafka Receive** and **Kafka History Reader** nodes with schema validation enabled. The reverse also works: those nodes decode Protobuf messages produced by Confluent clients.

All of this only applies when **Enable Schema Validation** is checked. Without it the node publishes JSON as before.

## Settings

| Field | Description |
|-------|-------------|
| **Format** | `Avro (Schema Registry)` or `Protobuf` |
| **Protobuf mode** | `Schema Registry (Confluent wire format)` or `Raw (no Schema Registry)` |
| **.proto schema** | Text of the `.proto` file. Required in raw mode, optional with Schema Registry (see below) |
| **Message type** | Message to encode: `Reading`, `acme.iot.Reading` or `Outer.Inner`. Empty uses the first message of the file |
| **Registry URL**, **Schema Subject**, **Schema Version**, **Registry Authentication** | Same as for Avro; hidden in raw mode |
| **Auto-register schema if not found** | With a local `.proto`, registers it under the subject when it is not registered yet |
| **Validate schema only** | Validates and encodes, reports the result, does not publish |

### Which schema ID is used (Schema Registry mode)

- **Local `.proto` set**: the node looks up the ID registered for exactly that schema under the subject. If it is not registered, it registers it when *Auto-register* is on, otherwise it reports an error. *Schema Version* is not used in this case.
- **Local `.proto` empty**: the node reads the schema from the registry (*Schema Version* `latest` or a number), checks that it is a Protobuf schema and encodes with it.

The schema is resolved on the first message and cached until the node is redeployed.

## What to put in `msg.payload`

A plain object (or a JSON string) using the standard Protobuf JSON mapping:

```proto
syntax = "proto3";
package acme.iot;

enum Kind { UNKNOWN = 0; TEMP = 1; HUMIDITY = 2; }

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
```

```javascript
msg.payload = {
    id: "sensor-42",
    value: 23.5,
    kind: "TEMP",                 // enum: name or number
    ts: String(Date.now()),       // int64: number or decimal string
    tags: [{ k: "room", v: "lab" }],
    labels: { site: "bcn" },
    raw: "AAEC"                   // bytes: base64 string, Buffer or byte array
};
return msg;
```

The payload is validated strictly before anything is sent. Wrong types, unknown enum values and fields the message does not define are rejected with an error that lists every problem, for example:

```
Protobuf validation error: id: string expected; extra: unknown field
```

In that case nothing is published.

`msg.key` and `msg.headers` work as for the other formats. The topic is always the one configured in the node.

## Output

After a successful send the node outputs `msg.payload = { success, kafkaResult, originalData, topic, schemaId }` (`schemaId` is `null` in raw mode). In *validate only* mode it outputs `{ validated: true, schemaId, originalData, encodedSize }`.

## Reading Protobuf messages

**Kafka Receive** and **Kafka History Reader** with *Enable Schema Validation* look up the schema ID of each message. For Protobuf schemas they use the message indexes to pick the right message type and output a plain object, with:

- enums as names, int64 values as strings, bytes as base64
- fields left at their default value included

Avro messages are decoded exactly as before.

Raw Protobuf messages carry no schema information: read them without schema validation and decode the bytes yourself (for example with `protobufjs` in a Function node).

## Limitations

- Schema references (`import` of other registered schemas) are not supported.
- Well-known types such as `google/protobuf/timestamp.proto` need to be declared in the same `.proto` text.

## Testing

- `npm test` includes the wire-format tests (Confluent index encoding, a message captured from Confluent's serializer, validation) and producer tests with a mocked registry.
- `npm run test:e2e:registry` starts Kafka and Confluent Schema Registry in Docker and checks Avro, Protobuf in both modes, and interoperability with `kafka-protobuf-console-producer` / `kafka-protobuf-console-consumer`.
