// File memory for DeepSeek Harness (v1).
// MiniMax-shaped: user / agent-hot / topics. Model writes; host injects and nudges.
// Project facts stay in repo AGENTS.md (already injected by dsh-agent-instructions).
// Toggle: settings namespace md-memory.enabled

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';

const NS = settingsNamespace('md-memory');
const PLUGIN = 'dsh-md-memory';
const USER_CAP = 8 * 1024;
const MAIN_CAP = 12 * 1024;
const TOPIC_CAP = 20 * 1024;
const INJECT_CAP = 12 * 1024;
const TOPIC_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const NUDGE_HINT = /记住|以后都|以后要|不要再|别再|下次|偏好|拍板|永远不要|必须|remember (this|that|to)|from now on|don't (ever|again)|do not (ever|again)|always |never again|preference|standing (rule|preference)/i;

const USER_SEED = `# User

Cross-project facts about this user (identity, communication, standing preferences).
Write with memory(target=user, operation=append) and a one-sentence cross-project reason.
Do not put project-only facts or today's task state here.
`;

const MAIN_SEED = `# Agent memory

Hot rules that should apply in almost every session. Keep this file small.
Project-only facts belong in the repo AGENTS.md.
On-demand topics live in topics/ — list them here only as a one-line pointer if needed.
`;

function dshHome() {
  const fromEnv = process.env.DSH_HOME;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  return join(homedir(), '.dsh');
}

function paths() {
  const root = join(dshHome(), 'memory');
  return {
    root,
    user: join(root, 'user.md'),
    agentDir: join(root, 'agent'),
    main: join(root, 'agent', 'MEMORY.md'),
    topics: join(root, 'agent', 'topics'),
  };
}

function ensureStore() {
  const p = paths();
  mkdirSync(p.topics, { recursive: true });
  if (!existsSync(p.user)) writeFileSync(p.user, USER_SEED, 'utf8');
  if (!existsSync(p.main)) writeFileSync(p.main, MAIN_SEED, 'utf8');
  return p;
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function writeText(file, content) {
  writeFileSync(file, content, 'utf8');
}

function fnv(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function topicPath(name) {
  if (!TOPIC_NAME.test(name)) return undefined;
  return join(paths().topics, `${name}.md`);
}

function topicDescription(name, content) {
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const line = fm[1].split(/\r?\n/).find((row) => row.startsWith('description:'));
    if (line) {
      const value = line.slice('description:'.length).trim().replace(/^["']|["']$/g, '');
      if (value) return value;
    }
  }
  const heading = content.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : name;
}

function listTopics() {
  const dir = paths().topics;
  let names = [];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3));
  } catch {
    names = [];
  }
  return names.sort().map((name) => {
    const content = readText(join(dir, `${name}.md`));
    return { name, description: topicDescription(name, content), bytes: Buffer.byteLength(content, 'utf8') };
  });
}

function clip(text, cap) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= cap) return { text, truncated: false };
  let cut = text;
  while (Buffer.byteLength(cut, 'utf8') > cap && cut.length > 0) {
    cut = cut.slice(0, Math.max(0, cut.length - 64));
  }
  return { text: `${cut.trimEnd()}\n\n[truncated: ${bytes} bytes, cap ${cap}]`, truncated: true };
}

function snapshot() {
  const p = ensureStore();
  const user = readText(p.user);
  const main = readText(p.main);
  const topics = listTopics();
  return { user, main, topics, digest: fnv(`${user}\n---\n${main}\n---\n${topics.map((t) => `${t.name}:${t.description}`).join('\n')}`) };
}

function renderInjection(snap) {
  const parts = [];
  parts.push('<system-reminder>');
  parts.push('Harness memory (cross-session). Treat as a hint, not proof of the current repo. Verify paths and "latest" claims. Project-only facts belong in AGENTS.md.');
  const user = clip(snap.user.trim(), Math.min(USER_CAP, 6 * 1024));
  const main = clip(snap.main.trim(), Math.min(MAIN_CAP, 7 * 1024));
  if (user.text) {
    parts.push('');
    parts.push('## User');
    parts.push(user.text);
  }
  if (main.text) {
    parts.push('');
    parts.push('## Agent');
    parts.push(main.text);
  }
  if (snap.topics.length > 0) {
    parts.push('');
    parts.push('## Topics (read with memory when the description matches)');
    for (const topic of snap.topics) {
      parts.push(`- ${topic.name}: ${topic.description}`);
    }
  }
  parts.push('');
  parts.push('Write durable lessons with the memory tool. Narrowest layer: project AGENTS.md → agent main/topic → user (user append needs a cross-project reason).');
  parts.push(`<!-- dsh-memory-digest:${snap.digest} -->`);
  parts.push('</system-reminder>');
  return clip(parts.join('\n'), INJECT_CAP).text;
}

function visibleMemoryDigest(agent) {
  try {
    const messages = agent.session.deriveMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role !== 'user') continue;
      const source = message.source;
      if (!source || source.kind !== 'plugin' || source.plugin !== PLUGIN) continue;
      const text = Array.isArray(message.content)
        ? message.content.map((block) => (block && block.type === 'text' ? block.text : '')).join('\n')
        : '';
      const match = text.match(/<!-- dsh-memory-digest:([0-9a-f]+) -->/);
      if (match) return match[1];
      return 'present';
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function recentUserText(agent, proposed) {
  const chunks = [];
  if (Array.isArray(proposed)) {
    for (const message of proposed) {
      if (!message || message.role !== 'user') continue;
      if (message.source && message.source.kind !== 'user') continue;
      if (!Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block && block.type === 'text' && typeof block.text === 'string') chunks.push(block.text);
      }
    }
  }
  try {
    for (const event of [...agent.session.events].reverse().slice(0, 40)) {
      if (event.type !== 'user/message') continue;
      if (event.data?.source?.kind !== 'user') continue;
      const content = event.data.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block && block.type === 'text' && typeof block.text === 'string') chunks.push(block.text);
      }
      if (chunks.join('\n').length > 4000) break;
    }
  } catch {
    // ignore
  }
  return chunks.join('\n');
}

function isChild(agent) {
  return Boolean(agent && agent.session && agent.session.header && agent.session.header.parentSession);
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function wrapEntry(target, content, reason) {
  const date = dateStamp();
  if (target === 'user') {
    return `\n### Untitled (${date})\n<!-- mem-append-reason: ${reason} -->\n\n${content.trim()}\n`;
  }
  return `\n### Untitled (${date})\n${content.trim()}\n`;
}

function applyEdit(current, oldString, newString) {
  if (typeof oldString !== 'string' || oldString.length === 0) {
    return { ok: false, text: 'edit requires oldString.' };
  }
  const count = current.split(oldString).length - 1;
  if (count === 0) return { ok: false, text: 'oldString not found.' };
  if (count > 1) return { ok: false, text: `oldString matches ${count} times; make it unique.` };
  return { ok: true, text: current.replace(oldString, newString ?? '') };
}

function searchCorpus(query) {
  const q = query.trim().toLowerCase();
  if (!q) return 'query is required.';
  const hits = [];
  const snap = snapshot();
  const push = (where, text) => {
    const lower = text.toLowerCase();
    let from = 0;
    let n = 0;
    while (n < 3) {
      const at = lower.indexOf(q, from);
      if (at < 0) break;
      const start = Math.max(0, at - 80);
      const end = Math.min(text.length, at + q.length + 80);
      hits.push(`- ${where}: …${text.slice(start, end).replace(/\s+/g, ' ')}…`);
      from = at + q.length;
      n += 1;
    }
  };
  push('user.md', snap.user);
  push('MEMORY.md', snap.main);
  for (const topic of snap.topics) {
    push(`topics/${topic.name}.md`, readText(join(paths().topics, `${topic.name}.md`)));
  }
  return hits.length === 0 ? `No matches for ${JSON.stringify(query)}.` : `Matches for ${JSON.stringify(query)}:\n${hits.join('\n')}`;
}

function runMemory(args, exec, wrote) {
  const operation = typeof args.operation === 'string' ? args.operation : '';
  const target = typeof args.target === 'string' ? args.target : '';
  const agent = exec && exec.agent;
  if ((operation === 'append' || operation === 'edit' || operation === 'write' || operation === 'create' || operation === 'delete') && isChild(agent)) {
    return 'memory writes are disabled for subagents. Tell the parent what should be remembered.';
  }

  ensureStore();

  if (operation === 'list' || (operation === 'read' && target === 'topic' && !args.topicName)) {
    const topics = listTopics();
    if (topics.length === 0) return 'No topics yet.';
    return topics.map((topic) => `${topic.name} (${topic.bytes}B): ${topic.description}`).join('\n');
  }

  if (operation === 'search') {
    return searchCorpus(typeof args.query === 'string' ? args.query : '');
  }

  if (operation === 'read') {
    if (target === 'user') return readText(paths().user) || '(empty user.md)';
    if (target === 'main') return readText(paths().main) || '(empty MEMORY.md)';
    if (target === 'topic') {
      const file = topicPath(args.topicName);
      if (!file) return 'topicName must be kebab-case [a-z0-9-]{1,63}.';
      const text = readText(file);
      return text || `topic ${args.topicName} does not exist.`;
    }
    return 'read needs target=user|main|topic.';
  }

  if (operation === 'create') {
    const file = topicPath(args.topicName);
    if (!file) return 'create needs topicName kebab-case.';
    if (existsSync(file)) return `topic ${args.topicName} already exists.`;
    const description = typeof args.description === 'string' && args.description.trim() ? args.description.trim() : args.topicName;
    const body = typeof args.content === 'string' ? args.content : '';
    const text = `---\ndescription: ${description}\n---\n\n${body.trim()}\n`;
    if (Buffer.byteLength(text, 'utf8') > TOPIC_CAP) return `topic would exceed ${TOPIC_CAP} bytes.`;
    writeText(file, text);
    if (agent) wrote.add(agent.id);
    return `created topic ${args.topicName}.`;
  }

  if (operation === 'delete') {
    const file = topicPath(args.topicName);
    if (!file) return 'delete needs topicName.';
    if (!existsSync(file)) return `topic ${args.topicName} does not exist.`;
    unlinkSync(file);
    if (agent) wrote.add(agent.id);
    return `deleted topic ${args.topicName}.`;
  }

  const fileOf = () => {
    if (target === 'user') return { file: paths().user, cap: USER_CAP };
    if (target === 'main') return { file: paths().main, cap: MAIN_CAP };
    if (target === 'topic') {
      const file = topicPath(args.topicName);
      if (!file) return { error: 'topicName must be kebab-case.' };
      if (operation !== 'write' && !existsSync(file)) return { error: `topic ${args.topicName} does not exist.` };
      return { file, cap: TOPIC_CAP };
    }
    return { error: 'target must be user|main|topic.' };
  };

  if (operation === 'append' || operation === 'edit' || operation === 'write') {
    const dest = fileOf();
    if (dest.error) return dest.error;
    if (operation === 'append' && target === 'user') {
      const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
      if (!reason) return 'user append requires reason (one sentence: why this holds across projects).';
    }
    const current = readText(dest.file);
    let next = current;
    if (operation === 'write') {
      next = typeof args.content === 'string' ? args.content : '';
    } else if (operation === 'append') {
      const content = typeof args.content === 'string' ? args.content : '';
      if (!content.trim()) return 'append requires content.';
      next = current.replace(/\s*$/, '') + wrapEntry(target, content, args.reason);
    } else {
      const edited = applyEdit(current, args.oldString, args.newString);
      if (!edited.ok) return edited.text;
      next = edited.text;
    }
    if (Buffer.byteLength(next, 'utf8') > dest.cap) {
      return `refusing write: ${dest.file} would be ${Buffer.byteLength(next, 'utf8')} bytes (cap ${dest.cap}). Move long material to a topic.`;
    }
    writeText(dest.file, next);
    if (agent) wrote.add(agent.id);
    return `${operation} ok (${Buffer.byteLength(next, 'utf8')} bytes).`;
  }

  return 'unknown operation. Use read|append|edit|write|search|create|delete|list.';
}

function memoryEnabled(ctx) {
  const settings = ctx.get('settings');
  if (settings === undefined) return true;
  const section = settings.get(NS);
  if (section === undefined) return true;
  return section.enabled !== false;
}

export function bindSessionMemory(ctx) {
  const wrote = new Set();
  const nudged = new Set();
  let disposers = [];

  const install = () => {
    ensureStore();
    const drop = [];
    drop.push(ctx.systemPrompt.section({
      name: 'tool:memory',
      order: 150,
      text: [
        'You have a harness memory tool named memory.',
        'Layers, narrowest first: repo AGENTS.md (project) → memory target=main or topic (agent lessons) → memory target=user (only facts that stay true on a different project; append requires reason).',
        'Do not store recoverable repo structure, git facts, or in-flight task state.',
        'When you learn a reusable preference, correction, or lesson, write it immediately. Before you report a task complete, pause and write anything durable.',
        'Recalled memory is a hint: verify paths and current facts before acting.',
      ].join(' '),
    }));
    drop.push(ctx.tools.register(defineTool({
      name: 'memory',
      description:
        'Harness cross-session memory. Layers: user (cross-project facts, append needs reason), main (hot agent lessons), topic (on-demand). Project-only facts go in AGENTS.md, not here. Subagents cannot write.',
      parameters: {
        operation: {
          type: 'string',
          required: true,
          enum: ['read', 'append', 'edit', 'write', 'search', 'create', 'delete', 'list'],
          description: 'read/append/edit/write a layer; search all layers; create/delete/list topics.',
        },
        target: {
          type: 'string',
          enum: ['user', 'main', 'topic'],
          description: 'Layer for read/append/edit/write. Omit for search/list.',
        },
        content: { type: 'string', description: 'Text for append/write/create.' },
        reason: { type: 'string', description: 'Required for user append: why this holds across projects.' },
        topicName: { type: 'string', description: 'kebab-case topic id for target=topic or create/delete.' },
        description: { type: 'string', description: 'Topic description for create (shown in the hot index).' },
        oldString: { type: 'string', description: 'Exact text to replace for edit.' },
        newString: { type: 'string', description: 'Replacement text for edit.' },
        query: { type: 'string', description: 'Substring for search.' },
      },
      output: {
        schema: { type: 'string' },
        render(_args, value) {
          return [{ type: 'text', text: typeof value === 'string' && value ? value : '(empty)' }];
        },
      },
      execute: async (args, exec) => runMemory(args || {}, exec, wrote),
    })));
    drop.push(ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
      const decision = await next();
      if (decision.kind !== 'enter' || signal.aborted || agent === undefined) return decision;
      const extra = [];
      const snap = snapshot();
      const visible = visibleMemoryDigest(agent);
      if (visible !== snap.digest) {
        extra.push(createUserMessage({
          content: [{ type: 'text', text: renderInjection(snap) }],
          source: { kind: 'plugin', plugin: PLUGIN },
        }));
      }
      if (!isChild(agent) && !wrote.has(agent.id) && !nudged.has(agent.id)) {
        const text = recentUserText(agent, decision.messages);
        if (NUDGE_HINT.test(text)) {
          nudged.add(agent.id);
          extra.push(createUserMessage({
            content: [{
              type: 'text',
              text: '<system-reminder>\nThis session looks like it produced a durable preference or correction, but nothing was written to harness memory. If it should apply next session, call memory now (user / main / topic). Project-only facts go in AGENTS.md. Skip if nothing durable.\n</system-reminder>',
            }],
            source: { kind: 'plugin', plugin: PLUGIN },
          }));
        }
      }
      if (extra.length === 0) return decision;
      return { kind: 'enter', messages: [...extra, ...decision.messages] };
    }));
    return drop;
  };

  const sync = () => {
    for (const dispose of disposers) {
      try { dispose(); } catch { /* keep going */ }
    }
    disposers = [];
    if (!memoryEnabled(ctx)) return;
    disposers = install();
  };

  sync();
  ctx.on('settings/updated', (ns) => {
    if (ns === 'md-memory' || ns === NS) sync();
  });
}
