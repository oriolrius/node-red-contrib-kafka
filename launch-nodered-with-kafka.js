#!/usr/bin/env node

// Launch Node-RED with Kafka nodes using Node-RED library
console.log('🚀 Launching Node-RED with Kafka History Reader');
console.log('===============================================');
console.log('This will start a Node-RED instance you can access via browser');
console.log('');

const http = require('http');
const express = require('express');
const RED = require('node-red');
const path = require('path');
const fs = require('fs');

// Create Express app
const app = express();

// Create HTTP server
const server = http.createServer(app);

// Create a temporary Node-RED directory
const tempDir = path.join(__dirname, 'temp-nodered');
const flowFile = path.join(tempDir, 'flows.json');

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

// Create a package.json for the temp directory to help with node loading
const tempPackageJson = {
    "name": "temp-nodered-kafka-test",
    "version": "1.0.0",
    "description": "Temporary Node-RED instance for Kafka testing",
    "node-red": {
        "nodes": {
            "hm-kafka-broker": path.join(__dirname, '..', 'js', 'kafka-broker.js'),
            "hm-kafka-producer": path.join(__dirname, '..', 'js', 'kafka-producer.js'),
            "hm-kafka-consumer": path.join(__dirname, '..', 'js', 'kafka-consumer.js'),
            "hm-kafka-history-reader": path.join(__dirname, '..', 'js', 'kafka-history-reader.js')
        }
    },
    "dependencies": {
        "@kafkajs/confluent-schema-registry": "^3.9.0",
        "kafkajs": "^2.2.4"
    }
};

fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify(tempPackageJson, null, 2));

// Node-RED settings - based on settings.js.basic with improvements
const settings = {
    // Flow file configuration
    flowFile: 'flows.json',
    flowFilePretty: true,
    
    // User directory
    userDir: tempDir,
    
    // Server configuration
    uiPort: process.env.PORT || 1880,
    httpAdminRoot: '/',
    httpNodeRoot: '/api',
    
    // Load additional nodes from our project
    nodesDir: path.join(__dirname, '..', 'js'),
    
    // CORS settings for HTTP admin interface
    httpAdminCors: {
        origin: "*",
        credentials: true
    },
    
    // CORS settings for HTTP nodes
    httpNodeCors: {
        origin: "*",
        methods: "GET,PUT,POST,DELETE"
    },
    
    // Authentication disabled (commented out like in settings.js.basic)
    // adminAuth: false,
    // httpAdminAuth: false,
    // httpNodeAuth: false,
    
    // Runtime state - IMPORTANT: This controls flow deployment
    runtimeState: {
        enabled: false,  // This should be false for normal operation
        ui: false        // This should be false for normal operation
    },
    
    // Diagnostics
    diagnostics: {
        enabled: true,
        ui: true
    },
    
    // Logging configuration
    logging: {
        console: {
            level: "info",
            metrics: false,
            audit: false
        }
    },
    
    // Editor theme configuration
    editorTheme: {
        tours: false,
        projects: {
            enabled: false,
            workflow: {
                mode: "manual"
            }
        },
        palette: {
            editable: true
        },
        codeEditor: {
            lib: "monaco"
        },
        markdownEditor: {
            mermaid: {
                enabled: true
            }
        },
        multiplayer: {
            enabled: false
        },
        header: {
            title: "Node-RED Kafka Testing",
            url: "about:blank"
        }
    },
    
    // Function node configuration
    functionExternalModules: true,
    functionTimeout: 0,
    functionGlobalContext: {
        // Add any global context variables here
    },
    
    // Export global context keys
    exportGlobalContextKeys: false,
    
    // External modules configuration
    externalModules: {
        // palette: {
        //     allowInstall: true,
        //     allowUpdate: true,
        //     allowUpload: true
        // }
    },
    
    // Debug configuration
    debugMaxLength: 1000,
    
    // Connection timeouts
    mqttReconnectTime: 15000,
    serialReconnectTime: 15000
};

// Create a comprehensive sample flow with all Kafka nodes
const sampleFlow = [
    {
        "id": "kafka-broker-config",
        "type": "hm-kafka-broker",
        "name": "Comforsa Kafka Broker",
        "hosts": "broker.comforsa.com:9093",
        "clientId": "node-red-browser-test",
        "usetls": true,
        "usesasl": false,
        "username": "",
        "password": "",
        "useiot": false
    },
    {
        "id": "flow-tab-1",
        "type": "tab",
        "label": "Kafka History Reader Test",
        "disabled": false,
        "info": "Test flow for Kafka History Reader with real broker"
    },

    // ========== HISTORY READER TAB ==========
    {
        "id": "inject-trigger",
        "type": "inject",
        "z": "flow-tab-1",
        "name": "Trigger History Read",
        "props": [
            {
                "p": "payload"
            }
        ],
        "repeat": "",
        "crontab": "",
        "once": false,
        "onceDelay": 0.1,
        "topic": "",
        "payload": "{}",
        "payloadType": "json",
        "x": 160,
        "y": 120,
        "wires": [["kafka-history-reader"]]
    },
    {
        "id": "kafka-history-reader",
        "type": "hm-kafka-history-reader",
        "z": "flow-tab-1",
        "name": "S7 Data History Reader",
        "broker": "kafka-broker-config",
        "topic": "s7data",
        "maxMessages": "3",
        "offset": "1300",
        "direction": "forward",
        "encoding": "utf8",
        "useSchemaValidation": true,
        "registryUrl": "https://schema-registry.comforsa.com",
        "useRegistryAuth": true,
        "registryUsername": "proxy_user",
        "registryPassword": "ucKna%wt@CnNddhKeS3kmXe9",
        "schemaName": "s7data-value",
        "schemaVersion": "2",
        "x": 400,
        "y": 120,
        "wires": [["debug-output"]]
    },
    {
        "id": "debug-output",
        "type": "debug",
        "z": "flow-tab-1",
        "name": "Full Response",
        "active": true,
        "tosidebar": true,
        "console": false,
        "tostatus": false,
        "complete": "true",
        "targetType": "full",
        "statusVal": "",
        "statusType": "auto",
        "x": 650,
        "y": 120,
        "wires": []
    },
    {
        "id": "info-node-1",
        "type": "comment",
        "z": "flow-tab-1",
        "name": "Kafka History Reader Test Flow",
        "info": "This flow demonstrates the Kafka History Reader node:\n\n**Configuration:**\n- Broker: broker.comforsa.com:9093 (SSL)\n- Topic: s7data\n- Schema Registry: https://schema-registry.comforsa.com\n- Schema: s7data-value v2\n- Max Messages: 3\n- Direction: forward\n- Offset: 1300\n\n**How to use:**\n1. Click the inject node to trigger a history read\n2. Check the debug panel for results\n3. Modify the history reader node config to change parameters\n\n**Simple Logic:**\n- forward: reads N messages AFTER the offset\n- backward: reads N messages BEFORE the offset\n\n**Notes:**\n- SSL connection to Kafka broker\n- Schema Registry authentication enabled\n- Timeout set to 30 seconds",
        "x": 190,
        "y": 40,
        "wires": []
    }
];

// Write flow file
fs.writeFileSync(flowFile, JSON.stringify(sampleFlow, null, 2));

console.log(`📁 Created temporary Node-RED directory: ${tempDir}`);
console.log(`📦 Package file: ${path.join(tempDir, 'package.json')}`);
console.log(`🔄 Flow file: ${flowFile}`);
console.log('⚙️  Configuration: No authentication, flows deployable');
console.log('');

// Initialize Node-RED
RED.init(server, settings);

// Serve the editor UI from /
app.use(settings.httpAdminRoot, RED.httpAdmin);

// Serve the http nodes from /api
app.use(settings.httpNodeRoot, RED.httpNode);

// Start the server
const PORT = process.env.PORT || 1880;

server.listen(PORT, async () => {
    console.log('🔄 Starting Node-RED...');
    
    try {
        // Start Node-RED runtime
        await RED.start();
        
        console.log('✅ Node-RED started successfully!');
        console.log('📖 Open your browser to: http://localhost:' + PORT);
        console.log('� To stop: Press Ctrl+C');
        console.log('');
        console.log('📖 Test Instructions:');
        console.log('   1. You should see the "Kafka History Reader Test" flow');
        console.log('   2. Click the inject node to trigger a history read');
        console.log('   3. Check the debug panel on the right for results');
        console.log('');
        console.log('🔧 Configuration included:');
        console.log('   History Reader:');
        console.log('   - Kafka Broker: broker.comforsa.com:9093 (SSL)');
        console.log('   - Topic: s7data');
        console.log('   - Schema Registry: https://schema-registry.comforsa.com');
        console.log('   - Schema: s7data-value v2');
        console.log('   - Direction: forward from offset 1300');
        console.log('');
        
    } catch (error) {
        console.error('❌ Failed to start Node-RED:', error.message);
        process.exit(1);
    }
});

// Graceful shutdown
async function shutdown() {
    console.log('\n\n🛑 Stopping Node-RED...');
    
    try {
        await RED.stop();
        console.log('✅ Node-RED stopped gracefully');
        
        // Cleanup temp directory
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.log('🧹 Cleaned up temporary files');
        } catch (error) {
            console.log('⚠️  Could not clean up temporary files:', error.message);
        }
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Error stopping Node-RED:', error.message);
        process.exit(1);
    }
}

// Handle process termination
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    shutdown();
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown();
});
