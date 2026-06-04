import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/error.js';
import { authenticate, type AuthedRequest } from '../../middleware/auth.js';
import { ok } from '../../lib/http.js';
import { apiKeyService } from './apikeys.service.js';

export const apiKeysRouter = Router();
apiKeysRouter.use(authenticate);
const uid = (req: unknown) => (req as AuthedRequest).auth.userId;

const upsertSchema = z.object({
  apiKey: z.string().min(10).max(256),
  secret: z.string().min(10).max(256),
  label: z.string().max(40).optional(),
});

/** POST /api/apikeys — validate against Binance, then store ENCRYPTED. */
apiKeysRouter.post('/', asyncHandler(async (req, res) => {
  const { apiKey, secret, label } = upsertSchema.parse(req.body);
  const result = await apiKeyService.upsert(uid(req), apiKey, secret, label);
  return ok(res, result, 201);
}));

/** GET /api/apikeys — never returns ciphertext or plaintext. */
apiKeysRouter.get('/', asyncHandler(async (req, res) => ok(res, await apiKeyService.getPublic(uid(req)))));

/** POST /api/apikeys/test — live connectivity check (balance + permissions). */
apiKeysRouter.post('/test', asyncHandler(async (req, res) => ok(res, await apiKeyService.testConnection(uid(req)))));

apiKeysRouter.delete('/:id', asyncHandler(async (req, res) => {
  await apiKeyService.revoke(uid(req), req.params.id!);
  return ok(res, { revoked: true });
}));
