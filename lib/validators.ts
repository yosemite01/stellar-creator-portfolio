import { z } from 'zod'

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
})

export const creatorSchema = z.object({
  name: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  discipline: z.string().min(1).max(100),
  bio: z.string().min(1).max(2000),
  avatar: z.string().url().optional().default(''),
  cover_image: z.string().url().optional().default(''),
  tagline: z.string().max(200).optional().default(''),
  linked_in: z.string().url().optional().default(''),
  twitter: z.string().url().optional().default(''),
  portfolio: z.string().url().optional().nullable(),
  skills: z.array(z.string().max(50)).max(20).default([]),
  hourly_rate: z.number().positive().optional().nullable(),
  response_time: z.string().max(50).optional().nullable(),
  availability: z.enum(['available', 'limited', 'unavailable']).optional().nullable(),
})

export const creatorUpdateSchema = creatorSchema.partial()

export const bountySchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(5000),
  budget: z.number().positive(),
  currency: z.string().length(3).default('USD'),
  deadline: z.string().datetime(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced', 'expert']),
  category: z.string().min(1).max(100),
  tags: z.array(z.string().max(50)).max(10).default([]),
  required_skills: z.array(z.string().max(50)).max(20).default([]),
  deliverables: z.string().max(2000).default(''),
  posted_by: z.string().uuid(),
})

export const bountyUpdateSchema = bountySchema.partial().omit({ posted_by: true })

export const userSchema = z.object({
  email: z.string().email().max(255),
  wallet_address: z.string().max(100).optional().nullable(),
  display_name: z.string().min(1).max(100),
  avatar_url: z.string().url().optional().nullable(),
  role: z.enum(['creator', 'client', 'admin']).default('client'),
})

export const userUpdateSchema = userSchema.partial()

export const applicationSchema = z.object({
  bounty_id: z.string().uuid(),
  creator_id: z.string().uuid(),
  proposed_budget: z.number().positive(),
  timeline: z.number().int().positive(),
  proposal: z.string().min(1).max(5000),
})

export const applicationUpdateSchema = z.object({
  proposed_budget: z.number().positive().optional(),
  timeline: z.number().int().positive().optional(),
  proposal: z.string().min(1).max(5000).optional(),
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
})

export type CreatorInput = z.infer<typeof creatorSchema>
export type CreatorUpdateInput = z.infer<typeof creatorUpdateSchema>
export type BountyInput = z.infer<typeof bountySchema>
export type BountyUpdateInput = z.infer<typeof bountyUpdateSchema>
export type UserInput = z.infer<typeof userSchema>
export type UserUpdateInput = z.infer<typeof userUpdateSchema>
export type ApplicationInput = z.infer<typeof applicationSchema>
export type ApplicationUpdateInput = z.infer<typeof applicationUpdateSchema>
export type PaginationInput = z.infer<typeof paginationSchema>

export function validateRequest<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; errors: z.ZodError } {
  const result = schema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, errors: result.error }
}

export function formatZodErrors(error: z.ZodError): { field: string; message: string }[] {
  return error.errors.map((err) => ({
    field: err.path.join('.'),
    message: err.message,
  }))
}
