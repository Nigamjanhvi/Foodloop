import { z } from 'zod';

export const phoneSchema = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Enter a valid phone number with country code, such as +911234567890.');
const locationSchema = z.object({
  city: z.string().trim().min(2).max(100),
  locality: z.string().trim().min(2).max(120),
  pincode: z.string().trim().regex(/^\d{5,10}$/),
});

export const organizationInputSchema = locationSchema.extend({
  name: z.string().trim().min(2).max(160),
  address: z.string().trim().min(5).max(500),
  serviceAreas: z.array(locationSchema.pick({ city: true, locality: true, pincode: true })).max(30).optional().default([]),
});

export const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128)
    .regex(/[a-z]/, 'Password must include a lowercase letter')
    .regex(/[A-Z]/, 'Password must include an uppercase letter')
    .regex(/[0-9]/, 'Password must include a number'),
  phone: phoneSchema,
  role: z.enum(['donor', 'ngo', 'volunteer']),
  organization: organizationInputSchema.optional(),
  volunteerLocation: locationSchema.optional(),
}).superRefine((value, context) => {
  if ((value.role === 'donor' || value.role === 'ngo') && !value.organization) {
    context.addIssue({ code: 'custom', path: ['organization'], message: 'Organization details are required for donor and NGO accounts.' });
  }
  if (value.role === 'volunteer' && !value.volunteerLocation) {
    context.addIssue({ code: 'custom', path: ['volunteerLocation'], message: 'City, locality, and pincode are required for volunteers.' });
  }
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  phone: phoneSchema,
  password: z.string().min(1).max(128),
});

export const phoneEnrollmentSchema = loginSchema;

export const verificationSchema = z.object({
  status: z.enum(['verified', 'rejected']),
  note: z.string().trim().max(1000).optional(),
});

export const verificationStatusSchema = z.enum(['pending', 'verified', 'rejected']);
