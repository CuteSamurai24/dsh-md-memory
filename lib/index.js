// Host plugin: file-based cross-session memory.
// The model writes markdown under ~/.dsh/memory. The host injects it.
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import z from '@deepseek-ai/schemastery';
import { bindSessionMemory } from './memory.js';

const NS = settingsNamespace('md-memory');

const Schema = z.object({
  enabled: z.boolean().default(true),
});

export const name = 'dsh-md-memory';

export default {
  name,
  apply(ctx) {
    ctx.inject(['settings'], (sctx) => {
      sctx.settings.register(NS, Schema);
    });

    ctx.inject(['tools', 'systemPrompt'], (mctx) => {
      bindSessionMemory(mctx);
    });
  },
};
