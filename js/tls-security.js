const crypto = require('crypto');
const tls = require('tls');

// eMudhra intermediate CA key compromise (disclosed 2026-10-20,
// https://emudhra.we-have-a-problem.com/). The private keys of these eight
// intermediates can be recovered from their certificates, so anyone can mint a
// "valid" certificate for any broker host. Node.js bundled roots before
// 22.23.4 / 24.22.1 / 26.12.1, and unpatched system bundles passed as CA file,
// still trust them. Each intermediate exists twice (issued by its emSign root
// and cross-signed by Sectigo "AAA Certificate Services"), with the same key.
const COMPROMISED_CA_SPKI_SHA256 = new Set([
    'EBED6475C2C2D80FCB199F3FE8DD6E6B3CE60B77EB15D4E42C3DEC0C6F5B5105', // EM DV TLS CA - G3B
    '49DD353DC2B919A3770645117D0E60C16115E7D1BC259EEFE734B00EA434FE5F', // EM DV TLS CA - G3C
    'E0254C7FCDC265E2F0F8A428DABB75AB4AE039B4872D62F5EE57F0877D5A8A41', // EM EV TLS CA - G3B
    '5C0660A2B164910D8FF589C18E14552E9E0EC237DCEFE2CB736D41A4811F81A0', // EM EV TLS CA - G3C
    'EC4FFA1AD0AC88081314B7AAFFEF6A91F97CD57291BB5BA686C5415F5EB4F6B6', // EM OV CS CA - G3B
    '92C063D67E8F14DB71D288E11266FFDAF69CBF115F7BAB14F3BC2F68D25E0E30', // EM OV CS CA - G3C
    '43BFFA19D6EF651451F6841E019931E96F6F2EAEFF28AB4B6F1CE4576DE2717B', // EM OV TLS CA - G3B
    '63ECEFEE431D49523BC1136C4E72D0206A477086CAF606CD5CF025686C109CF8', // EM OV TLS CA - G3C
]);

// Certificate fingerprints of every issued copy (direct and cross-signed), also
// checked when the SPKI cannot be computed.
const COMPROMISED_CA_CERT_SHA256 = new Set([
    '42C4ACCD12C4F59597925E1A08A7A90102608543809308D50EC427E118BA1493', // EM DV TLS CA - G3B <- emSign Root TLS CA - G3
    '45A883F349AEDFD5F3A649B5498FFB121712BA8B448F3F2A91DBC5A766FCDDBE', // EM DV TLS CA - G3B <- AAA Certificate Services
    '0164D7CEAE5BB909C272AF151FF44B1177AE9B47D9424B94F1D9558C30934D19', // EM DV TLS CA - G3C <- emSign Root TLS CA - G3
    '62B7F9868263F72F6911FC78CEAF72C1979158B7368BF648683BB2AA39B02E72', // EM DV TLS CA - G3C <- AAA Certificate Services
    'E7568FE6E12331F4FD7DE61DA4C7559D0F8EB192A218D4741A3BA75184333838', // EM EV TLS CA - G3B <- emSign Root TLS CA - G3
    '579480AEA166290BD3C643589E795FC0D0E54E86505D180F1DFF99EFD3199512', // EM EV TLS CA - G3B <- AAA Certificate Services
    '432EC25F0D28DE9006D97BF752F17BBB2CD41F669933FCB072D9A1148D0261F3', // EM EV TLS CA - G3C <- emSign Root TLS CA - G3
    'FD9D5C2DBBD4995AB69B8D50C439D9527B00529199C2FD01B2174EB58F07021F', // EM EV TLS CA - G3C <- AAA Certificate Services
    '9E39DE2881273ACC225A149C72BA3E0F51424963669AB633EE1DC7DF5DB067B4', // EM OV CS CA - G3B <- emSign Root CS CA - G3
    'A496E23AC0CAB8155FC9B117B97EAE368EFCBB9041AEC8804D5A308D2D01C2D8', // EM OV CS CA - G3B <- AAA Certificate Services
    '4B2460A466F95FD40113BCDCCA2CEB29B3B093921DE45474DA7DF48874C630B1', // EM OV CS CA - G3C <- emSign Root CS CA - G3
    '84112972B8E59D14560AE7E7119654474AAD119990CF3722BFC1E3B91615E1FD', // EM OV CS CA - G3C <- AAA Certificate Services
    '98B896625C0C230ADEEC3EB2CF6AAD5001ECF9156A68644E82374CE5833BC25B', // EM OV TLS CA - G3B <- emSign Root TLS CA - G3
    '5F1DED4DD590AF74631290CF073B122A2AAC6A1FA479778A0BD43579BD832699', // EM OV TLS CA - G3B <- AAA Certificate Services
    'CB6E15165AC802E9B3F993F16C25D41F4E81C21EBDE71AE1B012AC00BF9C7C3F', // EM OV TLS CA - G3C <- emSign Root TLS CA - G3
    '7485B51C0ED192878FA1D2F948FB529AE1842CC5086C4B67F7BE5B2039DE9489', // EM OV TLS CA - G3C <- AAA Certificate Services
]);

function normalizeFingerprint(fingerprint) {
    return String(fingerprint || '').replace(/:/g, '').toUpperCase();
}

function spkiSha256(cert) {
    if (!cert || !cert.raw) {
        return null;
    }
    try {
        const pem = `-----BEGIN CERTIFICATE-----\n${cert.raw.toString('base64')}\n-----END CERTIFICATE-----\n`;
        const spki = crypto.createPublicKey(pem).export({ type: 'spki', format: 'der' });
        return crypto.createHash('sha256').update(spki).digest('hex').toUpperCase();
    } catch (err) {
        return null;
    }
}

function isCompromisedCa(cert) {
    if (COMPROMISED_CA_CERT_SHA256.has(normalizeFingerprint(cert.fingerprint256))) {
        return true;
    }
    const spki = spkiSha256(cert);
    return spki !== null && COMPROMISED_CA_SPKI_SHA256.has(spki);
}

// Walks the chain returned by tlsSocket.getPeerCertificate(true) and returns
// the first compromised CA certificate found, or null.
function findCompromisedCa(peerCert) {
    const seen = new Set();
    let cert = peerCert;
    while (cert && typeof cert === 'object' && Object.keys(cert).length > 0) {
        const id = cert.fingerprint256 || cert;
        if (seen.has(id)) {
            break;
        }
        seen.add(id);
        if (isCompromisedCa(cert)) {
            return cert;
        }
        cert = cert.issuerCertificate;
    }
    return null;
}

// Drop-in replacement for tls.checkServerIdentity that also rejects chains
// built through a compromised CA. Node calls it after chain validation, so it
// only takes effect while certificate verification is on (not "Self-signed").
function checkServerIdentity(hostname, cert) {
    const compromised = findCompromisedCa(cert);
    if (compromised) {
        const name = (compromised.subject && compromised.subject.CN) || 'unknown CA';
        const err = new Error(`Certificate chain for ${hostname} goes through "${name}", an eMudhra intermediate CA whose private key is compromised (October 2026); refusing to connect`);
        err.code = 'ERR_TLS_COMPROMISED_CA';
        err.host = hostname;
        err.cert = cert;
        return err;
    }
    return tls.checkServerIdentity(hostname, cert);
}

module.exports = {
    COMPROMISED_CA_SPKI_SHA256,
    COMPROMISED_CA_CERT_SHA256,
    findCompromisedCa,
    checkServerIdentity
};
