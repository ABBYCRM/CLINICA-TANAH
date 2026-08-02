/**
 * Admin-managed external integrations.
 *
 * Image provider keys are write-only: the API returns status and source, never
 * the saved plaintext credential.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth';
import { logAudit } from '../services/audit';
import {
  getImageIntegrationStatus,
  updateImageProviderKeys,
  type ManagedImageProvider,
} from '../services/integrationSettings';

const router = Router();
router.use(authenticate, requireRole('admin'));

const keyValue = z.string().trim().min(8).max(1000).nullable().optional();
const updateSchema = z.object({
  openai: keyValue,
  gemini: keyValue,
  a2e: keyValue,
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: 'Provide at least one provider key or null to clear a saved key.' },
);

router.get('/', (_req: Request, res: Response) => {
  res.json({ image_generation: getImageIntegrationStatus() });
});

router.put('/', (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: 'validation',
      message: parsed.error.issues[0]?.message || 'Invalid integration settings.',
    });
    return;
  }

  const before = getImageIntegrationStatus();
  const changes: Partial<Record<ManagedImageProvider, string | null>> = {};
  for (const provider of ['openai', 'gemini', 'a2e'] as ManagedImageProvider[]) {
    if (Object.prototype.hasOwnProperty.call(parsed.data, provider)) {
      changes[provider] = parsed.data[provider] ?? null;
    }
  }

  const after = updateImageProviderKeys(changes);
  logAudit({
    tenantId: req.tenantId,
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'image_provider_credentials_updated',
    resourceType: 'integration_settings',
    resourceId: 'image_generation',
    beforeValue: {
      order: before.order,
      providers: Object.fromEntries(
        Object.entries(before.providers).map(([name, value]) => [name, {
          configured: value.configured,
          source: value.source,
        }]),
      ),
    },
    afterValue: {
      order: after.order,
      providers: Object.fromEntries(
        Object.entries(after.providers).map(([name, value]) => [name, {
          configured: value.configured,
          source: value.source,
        }]),
      ),
    },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] as string,
    legalBasis: 'legitimate_interest_art7_IX',
  });

  res.json({ ok: true, image_generation: after });
});

export default router;
