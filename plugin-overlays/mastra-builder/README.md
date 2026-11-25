# Mastra Builder private App skill overlay

Canonical source for the existing connected Mastra Builder App skill. Add the
skill directory to the existing private App-backed plugin, preserving its App
binding, name, presentation, MCP/OAuth configuration and sharing. Do not create
a duplicate App or package credentials. Plugin release is distinct from Git
merge and installed host skill availability. Validate frontmatter and implicit
invocation metadata, compare readback bytes, and smoke-test list_agents.
A new chat/reload may be required for host discovery; explicit probe is
MASTRA_BUILDER_SKILL_PROBE -> MB_OK_V1. Implicit routing must be observed on
an ordinary agent-development task, not inferred from the metadata.
