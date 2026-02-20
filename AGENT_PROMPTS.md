# Agent Prompts and Skills

This document contains reusable prompts for AI-assisted development on k8v.
Copy and paste these to start specific tasks.

---

## 🎯 Quick Start Prompts

### Orientation
```
Read the ARCHITECTURE.md and EXECUTION_ENGINE.md files to understand the project structure.
Summarize the key components and current development priorities.
```

### Code Review
```
Read the .clinerules file and relevant .md documents. Then review the codebase for:
1. Security issues (especially eval usage)
2. Code quality issues
3. Missing documentation
4. Consistency problems
Provide a prioritized list of findings.
```

### What's Next
```
Read all .md documentation files in the project root. Look at the Implementation Roadmap
and Future Enhancements sections. What should we work on next?
```

---

## 🏗️ Architecture Prompts

### Plan New Feature
```
I want to implement [FEATURE]. Before coding:
1. Read relevant .md documentation
2. Identify affected components
3. Design the approach
4. Update documentation with the plan
5. Ask clarifying questions if needed
Do NOT write code yet - this is planning mode.
```

### Design Runtime
```
Read EXECUTION_ENGINE.md. I want to add a new execution runtime for [LANGUAGE/PLATFORM].
Design how it would implement the ExecutionRuntime interface.
Update EXECUTION_ENGINE.md with the design before implementing.
```

### Document Decision
```
We decided: [DECISION]
Rationale: [WHY]
Update the relevant .md files to document this architectural decision.
```

---

## 🔧 Implementation Prompts

### Implement Feature
```
Read the .clinerules and relevant documentation. Then implement [FEATURE].
Follow the project patterns and update documentation if architecture changes.
Build and test when complete.
```

### Add Node Type
```
Read .clinerules "Creating New Node Types" section.
Add a new node type called [NAME] that [DESCRIPTION].
Follow the documented pattern.
```

### Fix Bug
```
Read ARCHITECTURE.md Data Flow section. There's a bug: [DESCRIPTION].
Trace through the flow, identify the issue, fix it, and test.
```

### Refactor
```
Read .clinerules and ARCHITECTURE.md. Refactor [COMPONENT] to [GOAL].
Ensure the abstraction boundaries are maintained.
Update documentation if needed.
```

---

## 🔒 Security Prompts

### Security Review
```
Review the codebase for security issues, focusing on:
1. Code execution (eval, Function constructor)
2. Input validation
3. API security
4. Data sanitization
Reference EXECUTION_ENGINE.md for the planned security approach.
```

### Replace eval
```
Read EXECUTION_ENGINE.md. Implement the V8IsolateRuntime to replace the
current eval() usage in NodeExecutor.ts. Follow the interface design in
the documentation.
```

---

## 📖 Documentation Prompts

### Update Docs After Change
```
I just made these changes: [CHANGES]
Update the relevant .md documentation files to reflect these changes.
```

### Explain Code
```
Read and explain how [FILE/COMPONENT] works.
Use the documentation to provide context.
```

### Write Design Doc
```
I want to implement [FEATURE]. Help me write a design document in a new
.md file that covers:
1. Problem statement
2. Proposed solution
3. Interface design
4. Implementation steps
5. Future considerations
```

---

## 🚀 Session Start Prompts

### Resume Work
```
Read .clinerules and ARCHITECTURE.md. Look at the Implementation Roadmap
checkboxes. What was I working on? What's the next step?
```

### Fresh Start
```
I'm starting a new coding session on k8v. Read .clinerules to understand
the project. Then let me know: "How can I help you today?"
```

### Continue Feature
```
Continue implementing the [FEATURE] we discussed. Read any relevant .md
files for context on the design decisions made.
```

---

## 💡 Tips for Using Prompts

1. **Be specific** - Replace [BRACKETS] with specific details
2. **Reference docs** - Always mention which .md files are relevant
3. **Separate planning from implementation** - Use Plan mode first
4. **Update docs** - Ask to update documentation after changes
5. **Build and test** - Always verify changes compile

---

## Adding New Prompts

When you discover a useful prompt pattern:

```
### [Prompt Name]
[Description of when to use this prompt]

\`\`\`
[The actual prompt text]
\`\`\`
```
