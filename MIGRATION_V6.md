# Migration Guide: v5.x to v6.0.0

## Breaking Changes

Version 6.0.0 introduces a **breaking change** to resolve naming conflicts with other Kafka packages in the Node-RED ecosystem.

### Node Type Name Changes

All node types have been renamed to use the `oriolrius-` prefix instead of `hm-`:

| Old Node Type (v5.x) | New Node Type (v6.0.0) | Display Name |
|---------------------|------------------------|--------------|
| `hm-kafka-broker` | `oriolrius-kafka-broker` | Kafka Broker |
| `hm-kafka-producer` | `oriolrius-kafka-producer` | Kafka Send |
| `hm-kafka-consumer` | `oriolrius-kafka-consumer` | Kafka Receive |
| `hm-kafka-history-reader` | `oriolrius-kafka-history-reader` | Kafka History |

## Why This Change?

The previous node type names (`hm-kafka-*`) conflicted with the `@edgeflow/kafka-client` package, which uses identical node type names. Node-RED requires unique node types across all installed packages.

By renaming to `oriolrius-kafka-*`, we ensure:
- ✅ No conflicts with other Kafka packages
- ✅ Clear attribution to the package author
- ✅ Consistency with the npm package name (`@oriolrius/node-red-contrib-kafka`)

## Migration Steps

### Automatic Migration (Recommended)

Node-RED will automatically handle the migration when you upgrade:

1. **Update the package:**
   ```bash
   npm install @oriolrius/node-red-contrib-kafka@latest
   ```

2. **Restart Node-RED**

3. **Open your flows:**
   - Existing nodes will appear with a **red triangle** indicator
   - This is expected - the old node types no longer exist

4. **Replace old nodes:**
   - For each flow with old Kafka nodes:
     - Add new nodes from the palette (they will have the same display names)
     - Copy configuration from old nodes to new nodes
     - Rewire connections
     - Delete old nodes
   - Save and deploy

### Manual Flow Migration

If you prefer to update your flows before deploying:

1. **Export your flows** (for backup)

2. **Edit flow JSON** using search and replace:
   ```
   Find: "hm-kafka-broker"
   Replace with: "oriolrius-kafka-broker"

   Find: "hm-kafka-producer"
   Replace with: "oriolrius-kafka-producer"

   Find: "hm-kafka-consumer"
   Replace with: "oriolrius-kafka-consumer"

   Find: "hm-kafka-history-reader"
   Replace with: "oriolrius-kafka-history-reader"
   ```

3. **Import updated flows**

4. **Restart Node-RED**

## What's Not Changed

✅ **All functionality remains the same**
✅ **Configuration options unchanged**
✅ **Message formats unchanged**
✅ **Connection settings unchanged**
✅ **Schema Registry integration unchanged**
✅ **Compression support unchanged**

## Example Flow Update

### Before (v5.x):
```json
{
    "type": "hm-kafka-producer",
    "broker": "broker-id",
    "topic": "my-topic"
}
```

### After (v6.0.0):
```json
{
    "type": "oriolrius-kafka-producer",
    "broker": "broker-id",
    "topic": "my-topic"
}
```

## Need Help?

If you encounter issues during migration:

1. Check the [GitHub Issues](https://github.com/oriolrius/node-red-contrib-kafka/issues)
2. Create a new issue with:
   - Your Node-RED version
   - Package version (old and new)
   - Error messages or screenshots
   - Flow export (if possible)

## Rollback

If you need to rollback to v5.x:

```bash
npm install @oriolrius/node-red-contrib-kafka@5.1.2
```

Then restart Node-RED. Your existing flows will work with v5.1.2.

---

**Note:** This is a one-time breaking change to ensure long-term compatibility in the Node-RED ecosystem. We apologize for any inconvenience and appreciate your understanding.
