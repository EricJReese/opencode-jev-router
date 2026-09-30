#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';

const roles = {
  Explore: 'Explore repositories, locate relevant code, and explain existing behavior. Read only; do not modify files.',
  architect: 'Analyze requirements and design module boundaries, interfaces, and implementation plans. Read only; do not modify files.',
  'frontend-builder': 'Implement accessible, maintainable frontend interfaces consistent with the existing application.',
  'build-error-resolver': 'Diagnose and fix build, type-check, and dependency errors with focused changes.',
  'code-reviewer': 'Review code for correctness, maintainability, and regressions. Read only; report findings without modifying files.',
  'security-reviewer': 'Review code for concrete security vulnerabilities and recommend fixes. Read only; do not modify files.',
  'database-reviewer': 'Review database schemas, queries, migrations, and data integrity. Read only; do not modify files.',
  drafter: 'Draft clear documentation and other requested text consistent with the project.',
};

async function createFile(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, contents, { flag: 'wx' });
    console.log(`Created ${path}`);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log(`Kept existing ${path}`);
  }
}

async function main(args) {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: opencode-jev-router init [--global]\nCreates router config, starter agents, and routing skill; preserves existing files.');
    return;
  }
  if (args[0] !== 'init' || args.slice(1).some(arg => arg !== '--global') || args.length > 2) {
    throw new Error('Usage: opencode-jev-router init [--global]');
  }
  const root = args.includes('--global')
    ? resolve(homedir(), '.config/opencode')
    : resolve(process.cwd(), '.opencode');
  const configPath = resolve(root, 'jev-router/config.json');
  await createFile(configPath, await readFile(new URL('./config.example.json', import.meta.url), 'utf8'));
  // Use the active config, including a user's existing agent list, on repeat runs.
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (!Array.isArray(config.agents)) throw new Error(`Expected an agents array in ${configPath}.`);
  for (const agent of config.agents) {
    if (!agent || !Object.hasOwn(roles, agent.name) || typeof agent.definition !== 'string') {
      console.log(`Provide your own definition for agent ${agent?.name ?? '(unnamed)'}.`);
      continue;
    }
    const path = resolve(dirname(configPath), agent.definition);
    // Only generate the bundled starter paths; custom definitions remain user-owned.
    if (path !== resolve(root, 'agents', `${agent.name}.md`)) {
      console.log(`Provide your own definition at ${path}.`);
      continue;
    }
    const role = roles[agent.name];
    const permission = role.includes('Read only') ? 'permission:\n  edit: deny\n' : '';
    await createFile(path, `---\ndescription: ${role}\nmode: subagent\n${permission}---\n\n${role}\n`);
  }
  await createFile(resolve(root, 'skills/jev-router/SKILL.md'),
    await readFile(new URL('./skills/jev-router/SKILL.md', import.meta.url), 'utf8'));
  console.log('\nAdd "opencode-jev-router" to the plugin array in your OpenCode config:');
  console.log('{ "$schema": "https://opencode.ai/config.json", "plugin": ["opencode-jev-router"] }');
  console.log('\nReview the models and starter agents, set TYPESAFE_API_KEY in the OpenCode process environment, then restart OpenCode.');
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
