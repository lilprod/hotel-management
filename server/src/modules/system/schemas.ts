import { z } from 'zod';

export const whoamiResponseSchema = z.object({
  user: z.object({ id: z.string().uuid(), name: z.string(), email: z.string() }),
  tenant: z.object({ id: z.string().uuid(), slug: z.string(), name: z.string() }),
  permissions: z.array(z.string()),
  propertyIds: z.array(z.string().uuid()),
  subscription: z.object({ status: z.string() }),
  entitlements: z.object({
    planCode: z.string().nullable(),
    features: z.array(z.string()),
    quotas: z.record(z.string(), z.number().int().nullable()),
  }),
});
export type WhoamiResponse = z.infer<typeof whoamiResponseSchema>;
