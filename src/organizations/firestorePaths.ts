function segment(value: string): string {
  if (!value.trim() || value.includes('/')) throw new TypeError('Firestore path identifiers must be non-empty path segments');
  return value;
}

export const organizationPath = (organizationId: string) => `organizations/${segment(organizationId)}`;
export const groupsPath = (organizationId: string) => `${organizationPath(organizationId)}/groups`;
export const groupPath = (organizationId: string, groupId: string) => `${groupsPath(organizationId)}/${segment(groupId)}`;
export const membersPath = (organizationId: string) => `${organizationPath(organizationId)}/members`;
export const membershipPath = (organizationId: string, uid: string) => `${membersPath(organizationId)}/${segment(uid)}`;
export const memberAnalyticsPath = (organizationId: string, uidPeriodId: string) => `${organizationPath(organizationId)}/memberAnalytics/${segment(uidPeriodId)}`;
export const groupAnalyticsPath = (organizationId: string, groupPeriodId: string) => `${organizationPath(organizationId)}/groupAnalytics/${segment(groupPeriodId)}`;
export const organizationAnalyticsPath = (organizationId: string, periodId: string) => `${organizationPath(organizationId)}/organizationAnalytics/${segment(periodId)}`;
export const personalAnalyticsPath = (uid: string, periodId: string) => `users/${segment(uid)}/personalAnalytics/${segment(periodId)}`;
export const memberIisInsightsPath = (organizationId: string, uid: string) => `${organizationPath(organizationId)}/memberIisInsights/${segment(uid)}`;
export const memberIisInsightPath = (organizationId: string, uid: string, insightId: string) => `${memberIisInsightsPath(organizationId, uid)}/items/${segment(insightId)}`;
export const memberIisAnalysisPath = (organizationId: string, uid: string, window: '7d' | '30d') => `${organizationPath(organizationId)}/memberIisAnalysis/${segment(`${uid}_${window}`)}`;
export const groupIisAnalysisPath = (organizationId: string, groupId: string, window: '7d' | '30d') => `${organizationPath(organizationId)}/groupIisAnalysis/${segment(`${groupId}_${window}`)}`;
export const organizationIisAnalysisPath = (organizationId: string, window: '7d' | '30d') => `${organizationPath(organizationId)}/organizationIisAnalysis/${segment(window)}`;
