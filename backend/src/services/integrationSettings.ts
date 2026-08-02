/**
 * Runtime image-provider credentials managed from the admin Settings page.
 *
 * Secrets are encrypted at rest with the same AES-256-GCM primitive used for
 * protected clinical fields. API responses expose configuration state only;
 * plaintext keys are never returned after save.
 */
import { db } from '../db/schema';
import { open, seal } from './phiCrypto';

export type ManagedImageProvider = 'openai' | 'gemini' | 'a2e';

export const IMAGE_PROVIDER_PRIORITY = [
  'openai',
  'gemini',
  'a2e',
  'local_morph',
] as const;

const PROVIDERS: Record<ManagedImageProvider, {
  envKey: 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'A2E_API_KEY';
  enabledKey: 'OPENAI_ENABLED' | 'GEMINI_ENABLED' | 'A2E_ENABLED';
  settingKey: string;
  model: () => string;
}> = {
  openai: {
    envKey: 'OPENAI_API_KEY',
    enabledKey: 'OPENAI_ENABLED',
    settingKey: 'integration.image.openai_api_key',
    model: () => process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
  },
  gemini: {
    envKey: 'GEMINI_API_KEY',
    enabledKey: 'GEMINI_ENABLED',
    settingKey: 'integration.image.gemini_api_key',
    model: () => process.env.GEMINI_MODEL || 'gemini-2.5-flash-image',
  },
  a2e: {
    envKey: 'A2E_API_KEY',
    enabledKey: 'A2E_ENABLED',
    settingKey: 'integration.image.a2e_api_key',
    model: () => process.env.A2E_MODEL || 'nano-banana-pro',
  },
};

let baselineCaptured = false;
const bootEnv: Partial<Record<ManagedImageProvider, string>> = {};

function captureBootEnvironment(): void {
  if (baselineCaptured) return;
  for (const provider of Object.keys(PROVIDERS) as ManagedImageProvider[]) {
    const value = process.env[PROVIDERS[provider].envKey]?.trim();
    if (value) bootEnv[provider] = value;
  }
  baselineCaptured = true;
}

function readSavedSecret(provider: ManagedImageProvider): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(
    PROVIDERS[provider].settingKey,
  ) as { value?: string } | undefined;
  if (!row?.value) return null;
  const decrypted = open(row.value);
  if (!decrypted || decrypted === '[dados_protegidos_indisponiveis]') return null;
  return decrypted.trim() || null;
}

function applyRuntimeKey(provider: ManagedImageProvider, value: string | null): void {
  const config = PROVIDERS[provider];
  if (value) {
    process.env[config.envKey] = value;
    process.env[config.enabledKey] = 'true';
    return;
  }
  delete process.env[config.envKey];
  delete process.env[config.enabledKey];
}

export type ImageIntegrationStatus = {
  order: readonly string[];
  providers: Record<ManagedImageProvider, {
    configured: boolean;
    saved_in_settings: boolean;
    source: 'settings' | 'environment' | null;
    model: string;
  }>;
};

export function getImageIntegrationStatus(): ImageIntegrationStatus {
  captureBootEnvironment();
  const providers = {} as ImageIntegrationStatus['providers'];

  for (const provider of Object.keys(PROVIDERS) as ManagedImageProvider[]) {
    const saved = readSavedSecret(provider);
    const envFallback = bootEnv[provider] || null;
    const active = saved || envFallback;
    providers[provider] = {
      configured: !!active,
      saved_in_settings: !!saved,
      source: saved ? 'settings' : (envFallback ? 'environment' : null),
      model: PROVIDERS[provider].model(),
    };
  }

  return {
    order: IMAGE_PROVIDER_PRIORITY,
    providers,
  };
}

/**
 * Load encrypted Settings values into the process runtime. The provider order
 * is deliberately fixed to OpenAI -> Gemini -> A2E -> deterministic fallback.
 */
export function hydrateImageProviderSettings(): ImageIntegrationStatus {
  captureBootEnvironment();

  for (const provider of Object.keys(PROVIDERS) as ManagedImageProvider[]) {
    const active = readSavedSecret(provider) || bootEnv[provider] || null;
    applyRuntimeKey(provider, active);
  }

  process.env.IMAGE_PROVIDER_ORDER = IMAGE_PROVIDER_PRIORITY.join(',');
  return getImageIntegrationStatus();
}

export function updateImageProviderKeys(
  changes: Partial<Record<ManagedImageProvider, string | null>>,
): ImageIntegrationStatus {
  captureBootEnvironment();

  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now')
  `);
  const remove = db.prepare('DELETE FROM settings WHERE key = ?');

  const tx = db.transaction(() => {
    for (const provider of Object.keys(PROVIDERS) as ManagedImageProvider[]) {
      if (!Object.prototype.hasOwnProperty.call(changes, provider)) continue;
      const next = changes[provider];
      if (next === null) {
        remove.run(PROVIDERS[provider].settingKey);
        continue;
      }
      if (typeof next !== 'string') continue;
      const trimmed = next.trim();
      if (!trimmed) continue;
      upsert.run(PROVIDERS[provider].settingKey, seal(trimmed));
    }
  });

  tx();
  return hydrateImageProviderSettings();
}
