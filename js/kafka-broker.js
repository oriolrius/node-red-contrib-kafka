
module.exports = function (RED) {
    const fs = require('fs');
    const { Kafka } = require('kafkajs');

    function KafkaBrokerNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.getOptions = function () {
            var options = {
                clientId: 'node-red-contrib-kafka',
                brokers: config.hosts.split(',').map(host => host.trim())
            };

            node.debug(`[Kafka Broker] Creating connection options for brokers: ${options.brokers.join(', ')}`);

            if (config.usetls) {
                node.debug(`[Kafka Broker] TLS enabled, configuring SSL options`);
                options.ssl = {};

                // Only read certificate files if paths are provided and not empty
                if (config.cacert && config.cacert.trim() !== '') {
                    try {
                        options.ssl.ca = fs.readFileSync(config.cacert, 'utf-8');
                        node.debug(`[Kafka Broker] Successfully loaded CA certificate from: ${config.cacert}`);
                    } catch (err) {
                        node.error(`[Kafka Broker] Failed to load CA certificate from ${config.cacert}: ${err.message}`);
                        throw err;
                    }
                }
                if (config.clientcert && config.clientcert.trim() !== '') {
                    try {
                        options.ssl.cert = fs.readFileSync(config.clientcert, 'utf-8');
                        node.debug(`[Kafka Broker] Successfully loaded client certificate from: ${config.clientcert}`);
                    } catch (err) {
                        node.error(`[Kafka Broker] Failed to load client certificate from ${config.clientcert}: ${err.message}`);
                        throw err;
                    }
                }
                if (config.privatekey && config.privatekey.trim() !== '') {
                    try {
                        options.ssl.key = fs.readFileSync(config.privatekey, 'utf-8');
                        node.debug(`[Kafka Broker] Successfully loaded private key from: ${config.privatekey}`);
                    } catch (err) {
                        node.error(`[Kafka Broker] Failed to load private key from ${config.privatekey}: ${err.message}`);
                        throw err;
                    }
                }
                if (config.passphrase && config.passphrase.trim() !== '') {
                    options.ssl.passphrase = config.passphrase;
                    node.debug(`[Kafka Broker] Passphrase configured for private key`);
                }
                options.ssl.rejectUnauthorized = !config.selfsign;
                node.debug(`[Kafka Broker] SSL reject unauthorized: ${!config.selfsign}`);
            } else {
                node.debug(`[Kafka Broker] TLS disabled, using plain connection`);
            }

            if (config.usesasl) {
                node.debug(`[Kafka Broker] SASL enabled with mechanism: ${config.saslmechanism || 'plain'}`);
                options.sasl = {
                    mechanism: config.saslmechanism || 'plain',
                    username: config.username,
                    password: config.password
                };
                node.debug(`[Kafka Broker] SASL username configured: ${config.username}`);
            } else {
                node.debug(`[Kafka Broker] SASL disabled`);
            }

            node.debug(`[Kafka Broker] Final connection options prepared`);
            return options;
        }

        // Create Kafka instance
        node.getKafka = function() {
            if (!node.kafka) {
                const options = node.getOptions();
                node.kafka = new Kafka(options);
                node.debug(`[Kafka Broker] Kafka instance created`);
            }
            return node.kafka;
        }

        // IoT configuration getters
        node.getIotConfig = function() {
            return {
                useiot: config.useiot,
                model: config.model,
                device: config.device,
                iotType: config.iotType,
                fields: config.fields || []
            };
        }

    }

    RED.nodes.registerType("hm-kafka-broker", KafkaBrokerNode);
}
