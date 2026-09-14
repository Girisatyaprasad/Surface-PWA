import { describe, expect, it } from 'vitest';
import { groupAnalyticsPath, groupIisAnalysisPath, groupPath, groupsPath, memberAnalyticsPath, memberIisAnalysisPath, memberIisInsightPath, membershipPath, membersPath, organizationAnalyticsPath, organizationIisAnalysisPath, organizationPath, personalAnalyticsPath } from './firestorePaths';

describe('organization Firestore paths', () => {
  it('uses the scoped organization schema', () => {
    expect(organizationPath('o')).toBe('organizations/o');
    expect(groupsPath('o')).toBe('organizations/o/groups');
    expect(groupPath('o', 'g')).toBe('organizations/o/groups/g');
    expect(membersPath('o')).toBe('organizations/o/members');
    expect(membershipPath('o', 'u')).toBe('organizations/o/members/u');
    expect(memberAnalyticsPath('o', 'u_2026')).toBe('organizations/o/memberAnalytics/u_2026');
    expect(groupAnalyticsPath('o', 'g_2026')).toBe('organizations/o/groupAnalytics/g_2026');
    expect(organizationAnalyticsPath('o', '2026')).toBe('organizations/o/organizationAnalytics/2026');
    expect(personalAnalyticsPath('u', '2026')).toBe('users/u/personalAnalytics/2026');
    expect(memberIisInsightPath('o', 'u', 'iis1_0123456789abcdef')).toBe('organizations/o/memberIisInsights/u/items/iis1_0123456789abcdef');
    expect(memberIisAnalysisPath('o', 'u', '7d')).toBe('organizations/o/memberIisAnalysis/u_7d');
    expect(groupIisAnalysisPath('o', 'g', '30d')).toBe('organizations/o/groupIisAnalysis/g_30d');
    expect(organizationIisAnalysisPath('o', '7d')).toBe('organizations/o/organizationIisAnalysis/7d');
  });

  it('rejects path traversal segments', () => {
    expect(() => membershipPath('o', 'u/other')).toThrow();
  });
});
