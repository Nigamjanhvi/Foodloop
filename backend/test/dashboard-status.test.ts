import assert from 'node:assert/strict';
import { test } from 'node:test';
import { donorDashboardMode } from '../../frontend/src/dashboard/dashboardState.ts';

test('donor dashboard selects a distinct experience for each stored organization state', () => {
  assert.equal(donorDashboardMode('pending'), 'onboarding');
  assert.equal(donorDashboardMode('verified'), 'workspace');
  assert.equal(donorDashboardMode('rejected'), 'review');
  assert.equal(new Set([donorDashboardMode('pending'), donorDashboardMode('verified'), donorDashboardMode('rejected')]).size, 3);
});
