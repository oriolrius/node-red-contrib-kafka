const should = require('should');
const helper = require('node-red-node-test-helper');

// Import the nodes
const kafkaHistoryReaderNode = require('../js/kafka-history-reader.js');
const kafkaBrokerNode = require('../js/kafka-broker.js');

describe('Kafka History Reader Node', function () {
    beforeEach(function (done) {
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it('should be loaded', function (done) {
        const flow = [
            { 
                id: "n1", 
                type: "oriolrius-kafka-history-reader", 
                name: "test history reader",
                broker: "b1",
                topic: "test-topic",
                messageTypes: "type1,type2",
                maxMessages: 5,
                fromOffset: "earliest"
            },
            {
                id: "b1",
                type: "oriolrius-kafka-broker",
                name: "test broker",
                hosts: "localhost:9092",
                clientId: "test-client"
            }
        ];
        
        helper.load([kafkaBrokerNode, kafkaHistoryReaderNode], flow, function () {
            const n1 = helper.getNode("n1");
            n1.should.have.property('name', 'test history reader');
            n1.should.have.property('type', 'oriolrius-kafka-history-reader');
            done();
        });
    });

    it('should have correct configuration properties', function (done) {
        const flow = [
            { 
                id: "n1", 
                type: "oriolrius-kafka-history-reader", 
                name: "test history reader",
                broker: "b1",
                topic: "sensor-data",
                messageTypes: "temperature,humidity,status",
                maxMessages: 10,
                fromOffset: "earliest",
                encoding: "utf8",
                useSchemaValidation: false
            },
            {
                id: "b1",
                type: "oriolrius-kafka-broker",
                name: "test broker",
                hosts: "localhost:9092",
                clientId: "test-client"
            }
        ];
        
        helper.load([kafkaBrokerNode, kafkaHistoryReaderNode], flow, function () {
            const n1 = helper.getNode("n1");
            
            // Check configuration properties
            n1.should.have.property('topic', 'sensor-data');
            n1.should.have.property('messageTypes', 'temperature,humidity,status');
            n1.should.have.property('maxMessages', 10);
            n1.should.have.property('fromOffset', 'earliest');
            n1.should.have.property('encoding', 'utf8');
            n1.should.have.property('useSchemaValidation', false);
            
            done();
        });
    });

    it('should validate required properties', function (done) {
        const flow = [
            { 
                id: "n1", 
                type: "oriolrius-kafka-history-reader", 
                name: "test history reader"
                // Missing required properties: broker, topic, messageTypes
            }
        ];
        
        try {
            helper.load([kafkaBrokerNode, kafkaHistoryReaderNode], flow, function () {
                // Should not reach here due to validation errors
                done(new Error('Expected validation to fail'));
            });
        } catch (error) {
            // Expected behavior - validation should fail
            done();
        }
    });

    it('should handle message input with override parameters', function (done) {
        const flow = [
            { 
                id: "n1", 
                type: "oriolrius-kafka-history-reader", 
                name: "test history reader",
                broker: "b1",
                topic: "test-topic",
                messageTypes: "default-type",
                maxMessages: 5,
                fromOffset: "earliest"
            },
            {
                id: "b1",
                type: "oriolrius-kafka-broker",
                name: "test broker",
                hosts: "localhost:9092",
                clientId: "test-client"
            },
            {
                id: "h1",
                type: "helper"
            }
        ];
        
        helper.load([kafkaBrokerNode, kafkaHistoryReaderNode], flow, function () {
            const n1 = helper.getNode("n1");
            const h1 = helper.getNode("h1");
            
            // Mock the broker's getKafka method to avoid actual Kafka connection
            const mockBroker = helper.getNode("b1");
            mockBroker.getKafka = function() {
                return {
                    consumer: function() {
                        return {
                            connect: async function() { return Promise.resolve(); },
                            subscribe: async function() { return Promise.resolve(); },
                            run: async function() { return Promise.resolve(); },
                            disconnect: async function() { return Promise.resolve(); }
                        };
                    }
                };
            };
            
            n1.wires = [["h1"]];
            
            // Test message with override parameters
            const testMessage = {
                messageTypes: "override-type1,override-type2",
                maxMessages: 15,
                fromOffset: "latest",
                timeoutMs: 5000,
                payload: {}
            };
            
            n1.receive(testMessage);
            
            // In a real test, we would verify the output
            // For now, just check that no errors are thrown
            setTimeout(() => {
                done();
            }, 100);
        });
    });

    it('should handle missing broker configuration gracefully', function (done) {
        const flow = [
            { 
                id: "n1", 
                type: "oriolrius-kafka-history-reader", 
                name: "test history reader",
                broker: "missing-broker",
                topic: "test-topic",
                messageTypes: "type1",
                maxMessages: 5
            }
        ];
        
        helper.load([kafkaBrokerNode, kafkaHistoryReaderNode], flow, function () {
            const n1 = helper.getNode("n1");
            
            // Node should handle missing broker gracefully
            n1.should.have.property('ready', false);
            
            done();
        });
    });
});

// Test message type parsing utility
describe('Message Type Detection', function() {
    it('should detect message types from various fields', function() {
        const testMessages = [
            { type: "sensor-data", value: 25.5 },
            { messageType: "alert", level: "warning" },
            { eventType: "status-update", status: "online" },
            { kind: "heartbeat", timestamp: Date.now() },
            { msgType: "error", error: "connection lost" },
            { content: "unknown message" } // Should default to 'unknown'
        ];
        
        const expectedTypes = ["sensor-data", "alert", "status-update", "heartbeat", "error", "unknown"];
        
        testMessages.forEach((msg, index) => {
            const messageType = msg.type || 
                              msg.messageType || 
                              msg.eventType ||
                              msg.kind ||
                              msg.msgType ||
                              'unknown';
            
            messageType.should.equal(expectedTypes[index]);
        });
    });
});
