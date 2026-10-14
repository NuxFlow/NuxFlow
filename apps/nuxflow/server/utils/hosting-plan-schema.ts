import { z } from 'zod'
import { PLAN_LIMITS } from '../../shared/lib/hosting-plan-limits'

// One nullable, non-negative whole number per limit (null = unlimited), keyed by the
// hosting_plans column name.
const limitFields = Object.fromEntries(
  PLAN_LIMITS.map(l => [l.column, z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional()]),
) as Record<typeof PLAN_LIMITS[number]['column'], z.ZodOptional<z.ZodNullable<z.ZodNumber>>>

export const planBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  priceText: z.string().trim().max(100).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  ...limitFields,
})
