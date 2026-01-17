# k8v Examples

## Basic Data Flow

### Example 1: Simple Addition

1. Create an **External Input** node with output `value` (number)
2. Create an **Inline Code** node with:
   - Input: `a` (number), `b` (number)
   - Output: `sum` (number)
   - Code:
     ```javascript
     outputs.sum = inputs.a + inputs.b;
     ```
3. Create an **External Output** node with input `result` (number)
4. Connect:
   - External Input → Inline Code (value → a)
   - External Input → Inline Code (value → b)
   - Inline Code → External Output (sum → result)

### Example 2: Data Transformation

1. Create an **External Input** node with output `data` (object)
2. Create an **Inline Code** node with:
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
3. Connect External Input → Inline Code → External Output

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

## Creating Reusable Subgraphs

1. Build a graph with External Input and External Output nodes
2. Mark nodes as external inputs/outputs
3. Wrap the subgraph into a Library Node
4. Use the Library Node in other graphs

## Best Practices

1. **Name your ports clearly**: Use descriptive names like `userData`, `processedResult`
2. **Define schemas**: Help the system validate connections
3. **Keep nodes focused**: Each node should do one thing well
4. **Use subgraphs**: Break complex logic into reusable components
5. **Document nodes**: Add descriptions to help others understand your nodes
