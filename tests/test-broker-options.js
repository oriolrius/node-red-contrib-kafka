// Broker connection options: timeouts (issue #3) and regression checks for existing options
const net = require('net');
const path = require('path');
const { Kafka } = require('kafkajs');
const { assert, loadNode, createNode, run, summary } = require('./helpers');
const { checkServerIdentity } = require('../js/tls-security');

const KafkaBroker = loadNode(path.join(__dirname, '..', 'js', 'kafka-broker.js'));
// Local server that accepts TCP but never answers the TLS handshake: a stalled
// TLS connection, which only the connection timeout can end (issue #3 scenario)
function silentServer() {
    const sockets = new Set();
    const server = net.createServer(socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
        host: `127.0.0.1:${server.address().port}`,
        close: () => { sockets.forEach(s => s.destroy()); server.close(); }
    })));
}

function options(config) {
    const broker = createNode(KafkaBroker, Object.assign({ hosts: 'localhost:9092' }, config));
    return { opts: broker.getOptions(), broker };
}

async function timeToFail(host, connectiontimeout) {
    const { opts } = options({ hosts: host, usetls: true, selfsign: true, connectiontimeout });
    const kafka = new Kafka(Object.assign({}, opts, { retry: { retries: 0 }, logLevel: 0 }));
    const admin = kafka.admin();
    const start = Date.now();
    try {
        await assert.rejects(admin.connect(), /Connection timeout/);
        return Date.now() - start;
    } finally {
        await admin.disconnect();
    }
}

async function testBrokerOptions() {
    console.log('\n🧪 Broker options tests');

    await run('defaults: no timeout keys, brokers trimmed, clientId kept', () => {
        const { opts } = options({ hosts: ' a:9092 , b:9093' });
        assert.deepStrictEqual(opts.brokers, ['a:9092', 'b:9093']);
        assert.strictEqual(opts.clientId, 'node-red-contrib-kafka');
        for (const key of ['connectionTimeout', 'authenticationTimeout', 'requestTimeout']) {
            assert.ok(!(key in opts), `${key} must not be set by default`);
        }
        assert.ok(!('ssl' in opts));
        assert.ok(!('sasl' in opts));
    });

    await run('empty / whitespace timeouts keep KafkaJS defaults', () => {
        const { opts, broker } = options({ connectiontimeout: '', authenticationtimeout: '  ', requesttimeout: undefined });
        assert.ok(!('connectionTimeout' in opts));
        assert.ok(!('authenticationTimeout' in opts));
        assert.ok(!('requestTimeout' in opts));
        assert.strictEqual(broker.warnings.length, 0);
    });

    await run('valid timeouts are passed to KafkaJS as numbers', () => {
        const { opts } = options({ connectiontimeout: '5000', authenticationtimeout: 15000, requesttimeout: ' 60000 ' });
        assert.strictEqual(opts.connectionTimeout, 5000);
        assert.strictEqual(opts.authenticationTimeout, 15000);
        assert.strictEqual(opts.requestTimeout, 60000);
    });

    await run('invalid timeouts are ignored with a warning', () => {
        for (const bad of ['abc', '0', '-5', '1.5', '10s']) {
            const { opts, broker } = options({ connectiontimeout: bad });
            assert.ok(!('connectionTimeout' in opts), `"${bad}" must be ignored`);
            assert.strictEqual(broker.warnings.length, 1);
            assert.match(broker.warnings[0], /connectionTimeout/);
        }
    });

    await run('legacy flows without timeout fields still load (regression)', () => {
        const { opts, broker } = options({ hosts: 'localhost:9092', usetls: false, usesasl: false });
        assert.deepStrictEqual(Object.keys(opts).sort(), ['brokers', 'clientId']);
        assert.strictEqual(broker.warnings.length, 0);
    });

    await run('SASL options unchanged (regression)', () => {
        const { opts } = options({ usesasl: true, saslmechanism: 'scram-sha-256', username: 'u', password: 'p' });
        assert.deepStrictEqual(opts.sasl, { mechanism: 'scram-sha-256', username: 'u', password: 'p' });
        const plain = options({ usesasl: true, username: 'u', password: 'p' }).opts;
        assert.strictEqual(plain.sasl.mechanism, 'plain');
    });

    await run('TLS: compromised-CA check installed, rejectUnauthorized kept', () => {
        const strict = options({ usetls: true }).opts;
        assert.strictEqual(strict.ssl.rejectUnauthorized, true);
        assert.strictEqual(strict.ssl.checkServerIdentity, checkServerIdentity);
        assert.ok(!('ca' in strict.ssl), 'no CA file -> Node default trust store');
        const selfsigned = options({ usetls: true, selfsign: true }).opts;
        assert.strictEqual(selfsigned.ssl.rejectUnauthorized, false);
    });

    await run('TLS: unreadable CA file still raises (regression)', () => {
        const broker = createNode(KafkaBroker, { hosts: 'localhost:9092', usetls: true, cacert: '/nonexistent/ca.pem' });
        assert.throws(() => broker.getOptions(), /ENOENT/);
        assert.strictEqual(broker.errors.length, 1);
    });

    await run('KafkaJS honours connectionTimeout on a stalled TLS handshake (short vs long)', async () => {
        const server = await silentServer();
        let short, long;
        try {
            short = await timeToFail(server.host, '300');
            long = await timeToFail(server.host, '2000');
        } finally {
            server.close();
        }
        console.log(`     300 ms -> failed after ${short} ms, 2000 ms -> failed after ${long} ms`);
        assert.ok(short >= 250 && short < 1500, `short timeout took ${short} ms`);
        assert.ok(long >= 1900 && long < 4000, `long timeout took ${long} ms`);
    });

    summary('Broker options');
}

module.exports = testBrokerOptions;

if (require.main === module) {
    // Explicit exit: KafkaJS leaves the timed-out socket half-open until the OS gives up
    testBrokerOptions().then(() => process.exit(0), err => { console.error(err.message); process.exit(1); });
}
