export type VerificationState = 'pending' | 'verified' | 'rejected';

export const donorDashboardModes: Record<VerificationState, 'onboarding' | 'workspace' | 'review'> = {
  pending: 'onboarding',
  verified: 'workspace',
  rejected: 'review',
};

export function donorDashboardMode(status: VerificationState) {
  return donorDashboardModes[status];
}
