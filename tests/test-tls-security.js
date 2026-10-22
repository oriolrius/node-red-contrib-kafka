// Compromised eMudhra intermediate CA rejection (October 2026)
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const { X509Certificate } = require('crypto');
const { Kafka } = require('kafkajs');
const { assert, run, summary, loadNode, createNode } = require('./helpers');
const { findCompromisedCa, checkServerIdentity, COMPROMISED_CA_SPKI_SHA256, COMPROMISED_CA_CERT_SHA256 } = require('../js/tls-security');

const CHAINS_DIR = path.join(__dirname, 'fixtures', 'emudhra-chains');
const CHAIN_FILES = fs.readdirSync(CHAINS_DIR).filter(f => f.endsWith('.pem'));

function splitPem(text) {
    return text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
}

// Builds the object shape returned by tlsSocket.getPeerCertificate(true), leaf first
function peerCertificate(pems) {
    const certs = pems.map(pem => {
        const x509 = new X509Certificate(pem);
        const cn = (x509.subject.match(/CN=([^\n]+)/) || [])[1];
        return { subject: { CN: cn }, fingerprint256: x509.fingerprint256, raw: x509.raw };
    });
    certs.forEach((cert, i) => { cert.issuerCertificate = certs[i + 1] || cert; });
    return certs[0];
}

function connect(host, extra) {
    return new Promise((resolve) => {
        const socket = tls.connect(Object.assign({ host, port: 443, servername: host, checkServerIdentity }, extra), () => {
            socket.end();
            resolve({ ok: true });
        });
        socket.setTimeout(10000, () => { socket.destroy(); resolve({ ok: false, code: 'TIMEOUT' }); });
        socket.on('error', err => resolve({ ok: false, code: err.code, message: err.message }));
    });
}

async function testTlsSecurity() {
    console.log('\n🧪 Compromised CA (eMudhra) tests');

    await run('blocklist covers 8 keys and 16 certificates', () => {
        assert.strictEqual(COMPROMISED_CA_SPKI_SHA256.size, 8);
        assert.strictEqual(COMPROMISED_CA_CERT_SHA256.size, 16);
    });

    await run(`all ${CHAIN_FILES.length} published chains are rejected`, () => {
        assert.strictEqual(CHAIN_FILES.length, 12);
        for (const file of CHAIN_FILES) {
            const leaf = peerCertificate(splitPem(fs.readFileSync(path.join(CHAINS_DIR, file), 'utf8')));
            const bad = findCompromisedCa(leaf);
            assert.ok(bad, `${file} not detected`);
            assert.match(bad.subject.CN, /^EM (DV|OV|EV) TLS CA - G3[BC]$/);
            const err = checkServerIdentity(file.replace(/\.pem$/, ''), leaf);
            assert.ok(err instanceof Error);
            assert.strictEqual(err.code, 'ERR_TLS_COMPROMISED_CA');
        }
    });

    await run('detected by SPKI when the fingerprint is missing', () => {
        const pems = splitPem(fs.readFileSync(path.join(CHAINS_DIR, CHAIN_FILES[0]), 'utf8'));
        const leaf = peerCertificate(pems);
        delete leaf.issuerCertificate.fingerprint256;
        assert.ok(findCompromisedCa(leaf));
    });

    await run('unrelated chains are not flagged and keep normal hostname checks', () => {
        for (const pem of tls.rootCertificates) {
            assert.strictEqual(findCompromisedCa(peerCertificate([pem])), null);
        }
        const leaf = peerCertificate([tls.rootCertificates[0]]);
        const err = checkServerIdentity('example.invalid', leaf);
        assert.ok(err instanceof Error, 'hostname mismatch must still fail');
        assert.notStrictEqual(err.code, 'ERR_TLS_COMPROMISED_CA');
    });

    await run('handles empty / self-referencing certificate objects', () => {
        assert.strictEqual(findCompromisedCa({}), null);
        assert.strictEqual(findCompromisedCa(null), null);
    });

    if (process.env.TEST_LIVE_TLS === '1') {
        await run('live: eMudhra test hosts refused, normal host accepted', async () => {
            for (const host of ['dv-g3b-emudhra.we-have-a-problem.com', 'dv-g3b-aaa-emudhra.we-have-a-problem.com']) {
                const res = await connect(host);
                console.log(`     ${host}: ${res.ok ? 'CONNECTED' : res.code}`);
                assert.strictEqual(res.ok, false, `${host} must be refused`);
            }
            const good = await connect('github.com');
            assert.strictEqual(good.ok, true, `github.com: ${good.code} ${good.message}`);
        });

        await run('live: broker node -> KafkaJS refuses the compromised chain', async () => {
            const KafkaBroker = loadNode(path.join(__dirname, '..', 'js', 'kafka-broker.js'));
            const broker = createNode(KafkaBroker, { hosts: 'dv-g3b-emudhra.we-have-a-problem.com:443', usetls: true });
            const kafka = new Kafka(Object.assign(broker.getOptions(), { retry: { retries: 0 }, logLevel: 0 }));
            const admin = kafka.admin();
            try {
                await assert.rejects(admin.connect(), /compromised/);
            } finally {
                await admin.disconnect();
            }
        });
    } else {
        console.log('  ⏭️  live TLS check skipped (set TEST_LIVE_TLS=1)');
    }

    summary('Compromised CA');
}

module.exports = testTlsSecurity;

if (require.main === module) {
    // Explicit exit: KafkaJS leaves the timed-out socket half-open until the OS gives up
    testTlsSecurity().then(() => process.exit(0), err => { console.error(err.message); process.exit(1); });
}
