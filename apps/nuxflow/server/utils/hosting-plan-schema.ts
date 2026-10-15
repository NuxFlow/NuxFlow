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
  // Selling it on a hosting platform's sign-up page (hosting-billing.ts). Prices are in
  // major units; null = not offered at that interval.
  isPublic: z.boolean().optional(),
  priceMonthly: z.number().min(0.5).max(100_000).multipleOf(0.01).nullable().optional(),
  priceYearly: z.number().min(0.5).max(1_000_000).multipleOf(0.01).nullable().optional(),
  currency: z.string().trim().toLowerCase().regex(/^[a-z]{3}$/, 'Use a 3-letter currency code, e.g. gbp').optional(),
  trialDays: z.number().int().min(0).max(90).optional(),
  ...limitFields,
})
