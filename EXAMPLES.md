# k8v Examples

## Basic Data Flow

### Example 1: Simple Addition

1. Create two **Numeric Input** nodes named `A` and `B`
2. Create an **Inline Code** node with:
   - Input: `a` (number), `b` (number)
   - Output: `sum` (number)
   - Code:
     ```javascript
     outputs.sum = inputs.a + inputs.b;
     ```
3. Connect `A.value → sum.a`
4. Connect `B.value → sum.b`

### Example 2: Data Transformation

1. Create an **Inline Code** node that defines a source object:
   - Output: `data` (object)
   - Code:
     ```javascript
     outputs.data = { user: "Ada", active: true };
     ```
2. Create another **Inline Code** node with:
   - Input: `data` (object)
   - Output: `transformed` (object)
   - Code:
     ```javascript
     outputs.transformed = {
       ...inputs.data,
       processed: true,
       timestamp: Date.now()
     };
     ```
3. Connect the source node to the transform node

### Example 3: Array Processing

1. Create an **Inline Code** node for filtering:
   - Input: `items` (array), `threshold` (number)
   - Output: `filtered` (array)
   - Code:
     ```javascript
     outputs.filtered = inputs.items.filter(item => item.value > inputs.threshold);
     ```

2. Create another **Inline Code** node for mapping:
   - Input: `items` (array)
   - Output: `mapped` (array)
   - Code:
     ```javascript
     outputs.mapped = inputs.items.map(item => ({
       ...item,
       doubled: item.value * 2
     }));
     ```

3. Chain: Filter → Map → Output

## Roadmap Note

Reusable library nodes and reusable subgraph packaging are not implemented today. For now, model reuse by copying or duplicating the relevant nodes inside a graph.

## Best Practices

1. **Name your ports clearly**: Use descriptive names like `userData`, `processedResult`
2. **Define schemas**: Help the system validate connections
3. **Keep nodes focused**: Each node should do one thing well
4. **Use small node chains**: Break complex logic into smaller, focused graph segments
5. **Document nodes**: Add descriptions to help others understand your nodes
