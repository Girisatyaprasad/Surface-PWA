export type OrganizationStatus = 'active' | 'inactive';
export type MembershipStatus = 'active' | 'inactive';
export type SurfaceOrganizationRole = 'member' | 'group_admin' | 'org_admin' | 'partner_analyst';
export type GroupPlanStatus = 'active' | 'inactive' | 'expired' | 'suspended';
export type GroupPlanEntitlement = {
  organizationId: string;
  status: GroupPlanStatus;
  planId: string | null;
  activatedAt: number | null;
  expiresAt: number | null;
  updatedAt: number;
};

// This is a backend response, not a client entitlement grant. Every sensitive
// operation is independently gated by the trusted backend and Firestore rules.
export type OrganizationAccessState = {
  groupPlanAvailable: boolean;
  groupPlanStatus: GroupPlanStatus;
  organizationAccessAvailable: boolean;
  surfaceRole?: SurfaceOrganizationRole;
  groupId?: string | null;
};

export function hasOrganizationAccess(state: OrganizationAccessState | null | undefined): boolean {
  return state?.groupPlanAvailable === true && state.organizationAccessAvailable === true && state.groupPlanStatus === 'active';
}

export type SurfaceOrganization = {
  id: string;
  name: string;
  companyKey?: string;
  status: OrganizationStatus;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
};

export type SurfaceGroup = {
  id: string;
  organizationId: string;
  name: string;
  parentGroupId?: string | null;
  status: OrganizationStatus;
  createdAt: number;
  updatedAt: number;
};

export type SurfaceMembership = {
  uid: string;
  organizationId: string;
  groupId?: string | null;
  status: MembershipStatus;
  joinedAt: number;
  updatedAt: number;
  surfaceRole: SurfaceOrganizationRole;
  companyRank?: string | null;
  recognitionTitle?: string | null;
};

export type AnalyticsPeriod = { periodStart: number; periodEnd: number };
export type ActivityDay = {
  day: string;
  peopleAdded: number;
  followupsCompleted: number;
  notesCreated: number;
  capturesCreated: number;
  eventsCreated: number;
};

export type MemberAnalyticsMetrics = {
  peopleAdded: number;
  activePins: number;
  followupsDue: number;
  followupsCompleted: number;
  followupsMissed: number;
  relationshipStageCounts: Readonly<Record<string, number>>;
  stalePeopleCount: number;
  notesCreated: number;
  capturesCreated: number;
  eventsCreated: number;
  activeDays: number;
  consistencyScore: number;
  activityByDay: readonly ActivityDay[];
};

export type MemberAnalytics = MemberAnalyticsMetrics & AnalyticsPeriod & {
  uid: string;
  organizationId: string;
  updatedAt: number;
};

export type AggregateAnalyticsMetrics = Omit<MemberAnalyticsMetrics, 'activeDays' | 'consistencyScore'> & {
  eventsCreated7d: number;
  eventsCreated30d: number;
};

export type GroupAnalytics = AggregateAnalyticsMetrics & AnalyticsPeriod & {
  organizationId: string;
  groupId: string;
  memberCount: number;
  activeMemberCount: number;
  inactiveMemberCount: number;
  activeRate: number;
  averageConsistencyScore: number;
  consistencyScoreSampleCount: number;
  updatedAt: number;
};

export type OrganizationAnalytics = AggregateAnalyticsMetrics & AnalyticsPeriod & {
  organizationId: string;
  groupCount: number;
  memberCount: number;
  activeMemberCount: number;
  inactiveMemberCount: number;
  activeRate: number;
  averageConsistencyScore: number;
  consistencyScoreSampleCount: number;
  updatedAt: number;
};
