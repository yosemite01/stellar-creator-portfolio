import { z } from "zod";

/**
 * Validation schemas for the testimonial mutation route
 * (`testimonials/[id]`).
 */

export const testimonialIdSchema = z.object({
  id: z
    .string({
      error: (iss) => (iss.input === undefined ? "Testimonial id is required" : undefined),
    })
    .trim()
    .min(1, "Testimonial id is required"),
});

export type TestimonialIdInput = z.infer<typeof testimonialIdSchema>;

export const updateTestimonialSchema = z.object({
  content: z
    .string({
      error: (iss) => (iss.input === undefined ? "Content is required" : undefined),
    })
    .trim()
    .min(1, "Content is required")
    .max(2000, "Content must be 2000 characters or fewer"),
  rating: z
    .number({
      error: (iss) => (iss.input === undefined ? "Rating is required" : undefined),
    })
    .int("Rating must be an integer")
    .min(1, "Rating must be at least 1")
    .max(5, "Rating must be at most 5"),
});

export type UpdateTestimonialInput = z.infer<typeof updateTestimonialSchema>;
