#!/usr/bin/env node

import { exportSchemas } from '@mastra/pg';

import { CLOUDFLARE_STORAGE_SCHEMA } from '../../src/runtime/cloudflare-runtime.ts';

process.stdout.write(exportSchemas(CLOUDFLARE_STORAGE_SCHEMA));
