import { spawn } from 'child_process';
import os from 'os';

const TIMEOUT_MS = 10_000;
const MIN_ENV_ENTRIES = 10;

let cachedEnvPromise: Promise<Record<string, string>> | null = null;

function getDefaultShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  return os.platform() === 'darwin' ? '/bin/zsh' : '/bin/bash';
}

function processEnvAsRecord(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function resolveFromShell(): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    if (os.platform() === 'win32') {
      resolve(processEnvAsRecord());
      return;
    }

    const shell = getDefaultShell();
    const child = spawn(shell, ['-ilc', 'env -0'], {
      env: process.env as Record<string, string>,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: TIMEOUT_MS,
    });

    const chunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    child.on('error', () => {
      resolve(processEnvAsRecord());
    });

    child.on('close', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const env: Record<string, string> = {};

        const entries = raw.split('\0');
        for (const entry of entries) {
          if (!entry) continue;
          const eqIdx = entry.indexOf('=');
          if (eqIdx <= 0) continue;
          env[entry.slice(0, eqIdx)] = entry.slice(eqIdx + 1);
        }

        if (env.PATH && Object.keys(env).length >= MIN_ENV_ENTRIES) {
          resolve(env);
        } else {
          console.warn('[shellEnv] Resolved env failed validation, using process.env');
          resolve(processEnvAsRecord());
        }
      } catch {
        console.warn('[shellEnv] Failed to parse shell env, using process.env');
        resolve(processEnvAsRecord());
      }
    });

    setTimeout(() => {
      try { child.kill(); } catch {}
    }, TIMEOUT_MS);
  });
}

export function getResolvedEnv(): Promise<Record<string, string>> {
  if (!cachedEnvPromise) {
    cachedEnvPromise = resolveFromShell();
  }
  return cachedEnvPromise;
}
