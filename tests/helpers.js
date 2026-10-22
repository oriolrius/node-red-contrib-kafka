// Shared helpers for the assertion-based tests
const assert = require('assert');

// Minimal Node-RED runtime mock: loads a node module and returns its constructor
function loadNode(modulePath) {
    let Constructor;
    const RED = {
        nodes: {
            createNode: function (node, config) {
                node.warnings = [];
                node.errors = [];
                node.debug = () => {};
                node.log = () => {};
                node.warn = (msg) => node.warnings.push(msg);
                node.error = (msg) => node.errors.push(msg);
            },
            registerType: function (type, ctor) {
                Constructor = ctor;
            },
            getNode: () => null
        }
    };
    require(modulePath)(RED);
    return Constructor;
}

function createNode(Constructor, config) {
    const node = {};
    Constructor.call(node, config);
    return node;
}

// Tiny test harness: run(name, fn) collects results; summary() exits non-zero on failure
const results = [];
async function run(name, fn) {
    try {
        await fn();
        results.push({ name, ok: true });
        console.log(`  ✅ ${name}`);
    } catch (err) {
        results.push({ name, ok: false, err });
        console.log(`  ❌ ${name}\n     ${err.stack || err.message}`);
    }
}

function summary(suite) {
    const total = results.length;
    const failed = results.filter(r => !r.ok).length;
    results.length = 0;
    console.log(`\n${suite}: ${total - failed}/${total} passed`);
    if (failed > 0) {
        throw new Error(`${suite}: ${failed} test(s) failed`);
    }
}

module.exports = { assert, loadNode, createNode, run, summary };
