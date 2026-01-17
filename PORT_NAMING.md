# Port Naming Guide

## How Ports Work

In k8v, nodes communicate through **ports**. Each port has a name, and connections map data from one port to another.

## The Rule

**Port names in node metadata must match what you use in your code!**

### Example 1: Output Ports

If your code writes:
```javascript
outputs.result = [1, 2, 3];
```

Then your node **must** have an output port named `"result"` in its metadata.

### Example 2: Input Ports

If your code reads:
```javascript
print("Value:", inputs.value);
```

Then your node **must** have an input port named `"value"` in its metadata.

## Common Issues

### Issue: `inputs.value` is undefined

**Problem**: Your code uses `inputs.value`, but the node's input port is named `"input"`.

**Solution**: Either:
1. Change your code to use `inputs.input`
2. Or change the node's input port name to `"value"` (requires editing node metadata)

### Issue: Output not connected

**Problem**: Your code writes to `outputs.result`, but the node's output port is named `"output"`.

**Solution**: Either:
1. Change your code to use `outputs.output`
2. Or change the node's output port name to `"result"`

## Best Practices

1. **Use descriptive port names**: `value`, `data`, `result`, `items`, etc.
2. **Match code and metadata**: Always ensure port names in metadata match what you use in code
3. **Check connections**: When connecting nodes, make sure you're connecting the right ports

## How to Check Port Names

1. Select a node
2. Look at the node on the canvas - port names are shown next to the connection handles
3. Make sure your code uses the same names

## Example: Correct Setup

**First Node:**
- Code: `outputs.result = [1, 2, 3];`
- Output port: `"result"` ✓

**Second Node:**
- Code: `print("Got:", inputs.result);`
- Input port: `"result"` ✓
- Connection: First node's "result" output → Second node's "result" input ✓
