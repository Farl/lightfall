# AI Assistant Instructions

## Verification & Testing
- AI Assistants MUST ALWAYS self-verify and test their code changes locally before asking the user to review or test them.
- NEVER push untested code or ask the user to verify a change that you haven't validated yourself. 
- Use the available tools (e.g. running a local dev server, executing evaluate_script via Chrome DevTools MCP, calculating matrix transformations, bounds checking, etc.) to mathematically and practically guarantee that your output matches the requirements. 
- Do not blindly guess or assume a fix works, especially for complex math, positioning, or CSS/WebGL rendering alignments.
