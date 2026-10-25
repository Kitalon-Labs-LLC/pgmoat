---
'pgmoat': patch
---

pgmoat now exits after SIGINT or SIGTERM. Before, it shut down its connections but kept running, so Ctrl+C, `docker stop`, and MCP clients stopping the server left the process hanging until it was force-killed.
