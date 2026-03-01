#!/usr/bin/env node
import { server } from "./dist/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
await server.connect(new StdioServerTransport());