import { readEnvFile } from './env.js';

const bridgeEnv = readEnvFile([
  'ZEROCLAW_BRIDGE_URL',
  'ZEROCLAW_BRIDGE_API_KEY',
  'ZEROCLAW_BRIDGE_TIMEOUT_MS',
]);

const ZEROCLAW_BRIDGE_URL =
  process.env.ZEROCLAW_BRIDGE_URL || bridgeEnv.ZEROCLAW_BRIDGE_URL || '';
const ZEROCLAW_BRIDGE_API_KEY =
  process.env.ZEROCLAW_BRIDGE_API_KEY || bridgeEnv.ZEROCLAW_BRIDGE_API_KEY || '';

const DEFAULT_TIMEOUT_MS = 45_000;
const BRIDGE_TIMEOUT_MS = (() => {
  const parsed = Number(
    process.env.ZEROCLAW_BRIDGE_TIMEOUT_MS ||
      bridgeEnv.ZEROCLAW_BRIDGE_TIMEOUT_MS ||
      DEFAULT_TIMEOUT_MS,
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(parsed, 60_000);
})();

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractZeroclawCommand(
  content: string,
  assistantName: string,
  allowPlainCommand: boolean,
): string | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const mentionPattern = new RegExp(
    `^@${escapeRegex(assistantName)}\\s+\\/zc\\b\\s*:?\\s*(.*)$`,
    'i',
  );
  const mentionMatch = mentionPattern.exec(trimmed);
  if (mentionMatch) {
    return mentionMatch[1] || '';
  }

  if (allowPlainCommand) {
    const plainMatch = /^\/zc\b\s*:?\s*(.*)$/i.exec(trimmed);
    if (plainMatch) {
      return plainMatch[1] || '';
    }
  }

  return null;
}

export async function sendToZeroclawBridge(
  message: string,
  metadata?: Record<string, unknown>,
): Promise<string> {
  const trimmed = message.trim();
  if (!trimmed) {
    return 'Usage: /zc <message>';
  }

  if (!ZEROCLAW_BRIDGE_URL) {
    return 'ZeroClaw bridge is not configured. Set ZEROCLAW_BRIDGE_URL in .env.';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (ZEROCLAW_BRIDGE_API_KEY) {
      headers['X-Bridge-Key'] = ZEROCLAW_BRIDGE_API_KEY;
    }

    const res = await fetch(ZEROCLAW_BRIDGE_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: trimmed,
        metadata,
      }),
      signal: controller.signal,
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const responseText = typeof body.response === 'string' ? body.response.trim() : '';
    const details = typeof body.details === 'string' ? body.details : '';

    if (!res.ok) {
      return details
        ? `ZeroClaw bridge error: ${details}`
        : `ZeroClaw bridge error (HTTP ${res.status}).`;
    }

    if (!responseText) {
      return 'ZeroClaw bridge returned an empty response.';
    }

    return responseText;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return 'ZeroClaw bridge timed out.';
    }
    return `ZeroClaw bridge request failed: ${error instanceof Error ? error.message : String(error)}`;
  } finally {
    clearTimeout(timer);
  }
}
