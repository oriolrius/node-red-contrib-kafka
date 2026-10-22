// Protobuf helpers for the Confluent Schema Registry wire format.
//
//   byte 0      magic byte 0x00
//   bytes 1-4   schema ID (int32, big endian)
//   bytes 5..   message indexes: path of the message type inside the .proto file
//               (zigzag varint count + zigzag varint indexes; [0] is the single byte 0x00)
//   then        the Protobuf-encoded message
//
// @kafkajs/confluent-schema-registry 3.x writes no message indexes and always uses the
// first message of the schema, so the nodes encode and decode Protobuf here instead.
// Schema references (imports of other registered schemas) are not supported.
const protobuf = require('protobufjs');

const MAGIC_BYTE = 0;
const HEADER_SIZE = 5;

const TO_OBJECT_OPTIONS = { longs: String, enums: String, bytes: String, defaults: true, oneofs: true };

function parseSchema(text) {
    if (!text || String(text).trim() === '') {
        throw new Error('Protobuf schema (.proto) is empty');
    }
    return protobuf.parse(text, { keepCase: true }).root;
}

// Message types declared at file level, in declaration order (inside the package namespace)
function fileLevelTypes(namespace) {
    const types = [];
    for (const nested of namespace.nestedArray) {
        if (nested instanceof protobuf.Type) {
            types.push(nested);
        } else if (nested instanceof protobuf.Namespace && !(nested instanceof protobuf.Service)) {
            types.push(...fileLevelTypes(nested));
        }
    }
    return types;
}

function nestedTypes(type) {
    return type.nestedArray.filter(n => n instanceof protobuf.Type);
}

// Resolves the configured message type; empty name = first message of the file (Confluent default)
function resolveType(root, messageName) {
    const name = messageName ? String(messageName).trim() : '';
    if (name === '') {
        const first = fileLevelTypes(root)[0];
        if (!first) {
            throw new Error('Protobuf schema defines no message type');
        }
        return first;
    }
    try {
        return root.lookupType(name);
    } catch (err) {
        throw new Error(`Message type "${name}" not found in the .proto schema`);
    }
}

// Path of a type in the file: [index among file-level messages, index among nested messages, ...]
function messageIndexes(type) {
    const path = [];
    let current = type;
    while (current.parent instanceof protobuf.Type) {
        path.unshift(nestedTypes(current.parent).indexOf(current));
        current = current.parent;
    }
    path.unshift(fileLevelTypes(current.root).indexOf(current));
    if (path.some(i => i < 0)) {
        throw new Error(`Cannot locate message type ${type.fullName} in its schema`);
    }
    return path;
}

function typeFromIndexes(root, indexes) {
    let type = fileLevelTypes(root)[indexes[0]];
    for (let i = 1; type && i < indexes.length; i++) {
        type = nestedTypes(type)[indexes[i]];
    }
    if (!type) {
        throw new Error(`No message type at index path [${indexes.join(', ')}] in the schema`);
    }
    return type;
}

function zigzag(n) {
    return (n << 1) ^ (n >> 31);
}

function unzigzag(n) {
    return (n >>> 1) ^ -(n & 1);
}

function writeVarint(value, bytes) {
    let v = value >>> 0;
    while (v > 0x7f) {
        bytes.push((v & 0x7f) | 0x80);
        v >>>= 7;
    }
    bytes.push(v);
}

function readVarint(buffer, offset) {
    let result = 0;
    let shift = 0;
    let pos = offset;
    for (;;) {
        if (pos >= buffer.length || shift > 28) {
            throw new Error('Truncated or invalid message index varint');
        }
        const byte = buffer[pos++];
        result |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) {
            return { value: result >>> 0, offset: pos };
        }
        shift += 7;
    }
}

function encodeIndexes(indexes) {
    if (indexes.length === 1 && indexes[0] === 0) {
        return Buffer.from([0]);
    }
    const bytes = [];
    writeVarint(zigzag(indexes.length), bytes);
    for (const index of indexes) {
        writeVarint(zigzag(index), bytes);
    }
    return Buffer.from(bytes);
}

function decodeIndexes(buffer, offset) {
    let read = readVarint(buffer, offset);
    const count = unzigzag(read.value);
    if (count === 0) {
        return { indexes: [0], offset: read.offset };
    }
    if (count < 0 || count > 100) {
        throw new Error(`Invalid message index count ${count}`);
    }
    const indexes = [];
    for (let i = 0; i < count; i++) {
        read = readVarint(buffer, read.offset);
        indexes.push(unzigzag(read.value));
    }
    return { indexes, offset: read.offset };
}

const INT32_TYPES = { int32: [-2147483648, 2147483647], sint32: [-2147483648, 2147483647], sfixed32: [-2147483648, 2147483647], uint32: [0, 4294967295], fixed32: [0, 4294967295] };
const INT64_TYPES = { int64: true, sint64: true, sfixed64: true, uint64: false, fixed64: false };

function scalarProblem(field, value) {
    const type = field.type;
    if (type in INT32_TYPES) {
        const [min, max] = INT32_TYPES[type];
        return Number.isInteger(value) && value >= min && value <= max ? null : `${type} expected`;
    }
    if (type in INT64_TYPES) {
        const signed = INT64_TYPES[type];
        const ok = (Number.isInteger(value) && (signed || value >= 0)) ||
            (typeof value === 'string' && (signed ? /^-?\d+$/ : /^\d+$/).test(value));
        return ok ? null : `${type} expected (integer or decimal string)`;
    }
    switch (type) {
        case 'double':
        case 'float':
            return typeof value === 'number' ? null : 'number expected';
        case 'bool':
            return typeof value === 'boolean' ? null : 'boolean expected';
        case 'string':
            return typeof value === 'string' ? null : 'string expected';
        case 'bytes':
            return typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array || Array.isArray(value)
                ? null : 'bytes expected (base64 string, Buffer or byte array)';
        default:
            return null;
    }
}

function valueProblems(field, value, where) {
    if (field.resolvedType instanceof protobuf.Enum) {
        const values = field.resolvedType.values;
        const ok = (typeof value === 'string' && Object.prototype.hasOwnProperty.call(values, value)) ||
            (Number.isInteger(value) && Object.values(values).includes(value));
        return ok ? [] : [`${where}: enum ${field.resolvedType.name} value expected (${Object.keys(values).join(', ')})`];
    }
    if (field.resolvedType instanceof protobuf.Type) {
        return validate(field.resolvedType, value, where);
    }
    const problem = scalarProblem(field, value);
    return problem ? [`${where}: ${problem}`] : [];
}

// Strict check of a plain JS object (JSON mapping: enum names, int64 as strings, bytes as base64).
// protobufjs fromObject() would otherwise coerce wrong types and drop unknown fields silently.
function validate(type, value, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [`${path || type.name}: object expected`];
    }
    const problems = [];
    for (const key of Object.keys(value)) {
        const field = type.fields[key];
        const where = path ? `${path}.${key}` : key;
        if (!field) {
            problems.push(`${where}: unknown field`);
            continue;
        }
        const v = value[key];
        if (v === null || v === undefined) {
            continue;
        }
        field.resolve();
        if (field.map) {
            if (typeof v !== 'object' || Array.isArray(v)) {
                problems.push(`${where}: object (map) expected`);
                continue;
            }
            for (const k of Object.keys(v)) {
                problems.push(...valueProblems(field, v[k], `${where}[${k}]`));
            }
        } else if (field.repeated) {
            if (!Array.isArray(v)) {
                problems.push(`${where}: array expected`);
                continue;
            }
            v.forEach((item, i) => problems.push(...valueProblems(field, item, `${where}[${i}]`)));
        } else {
            problems.push(...valueProblems(field, v, where));
        }
    }
    return problems;
}

// Validates a plain JS object against the type and returns the protobufjs message
function toMessage(type, payload) {
    const problems = validate(type, payload, '');
    if (problems.length > 0) {
        throw new Error(`Protobuf validation error: ${problems.join('; ')}`);
    }
    return type.fromObject(payload);
}

function encodeRaw(type, payload) {
    return Buffer.from(type.encode(toMessage(type, payload)).finish());
}

function encodeConfluent(schemaId, type, payload) {
    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt8(MAGIC_BYTE, 0);
    header.writeInt32BE(schemaId, 1);
    return Buffer.concat([header, encodeIndexes(messageIndexes(type)), encodeRaw(type, payload)]);
}

function readHeader(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < HEADER_SIZE) {
        throw new Error('Message is too short for the Confluent wire format');
    }
    if (buffer.readUInt8(0) !== MAGIC_BYTE) {
        throw new Error(`Unexpected magic byte ${buffer.readUInt8(0)}, expected ${MAGIC_BYTE}`);
    }
    return { schemaId: buffer.readInt32BE(1), offset: HEADER_SIZE };
}

function decodeRaw(type, buffer) {
    return type.toObject(type.decode(buffer), TO_OBJECT_OPTIONS);
}

// Decodes a Confluent-framed Protobuf message; root is the parsed schema of schemaId
function decodeConfluent(root, buffer) {
    const { schemaId, offset } = readHeader(buffer);
    const { indexes, offset: payloadOffset } = decodeIndexes(buffer, offset);
    const type = typeFromIndexes(root, indexes);
    return { schemaId, type, value: decodeRaw(type, buffer.subarray(payloadOffset)) };
}

// Schema Registry decoder for consumers: Protobuf schemas are decoded here (any message of the
// .proto, real message indexes), everything else goes through the registry client unchanged
function createSchemaDecoder(schemaRegistry) {
    const roots = new Map(); // schema ID -> parsed .proto root, or null for non-Protobuf schemas
    return {
        decode: async function (buffer) {
            const { schemaId } = readHeader(buffer);
            if (!roots.has(schemaId)) {
                const found = (await schemaRegistry.api.Schema.find({ id: schemaId })).data();
                roots.set(schemaId, found.schemaType === 'PROTOBUF' ? parseSchema(found.schema) : null);
            }
            const root = roots.get(schemaId);
            return root ? decodeConfluent(root, buffer).value : schemaRegistry.decode(buffer);
        },
        clear: () => roots.clear()
    };
}

module.exports = {
    createSchemaDecoder,
    parseSchema,
    resolveType,
    messageIndexes,
    typeFromIndexes,
    encodeIndexes,
    decodeIndexes,
    validate,
    toMessage,
    encodeRaw,
    encodeConfluent,
    readHeader,
    decodeRaw,
    decodeConfluent
};
