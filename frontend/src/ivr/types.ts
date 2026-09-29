export type CampaignStatus = 'running' | 'paused' | 'stopped' | 'completed';
export type CampaignStatusKind = 'running' | 'paused' | 'stopped' | 'other';
export type IvrRow = Record<string, unknown>;
export type MetricKey = 'total' | 'dialed' | 'queued' | 'dialing' | 'completed' | 'interested' | 'concurrency';

export interface IvrCampaign {
  id: string;
  name: string;
  subtitle?: string;
  status: string;
  statusKind: CampaignStatusKind;
  state?: 'active' | 'archived' | 'draft';
  concurrency?: number;
  progressPercentage?: number;
  dialedLeads?: number;
  totalLeads?: number;
  queued?: number;
  dialing?: number;
  completed?: number;
  interested?: number;
  audioPrompt?: string;
  didPool?: string;
  leadListName?: string;
  transferGroup?: string;
  metrics: Partial<Record<MetricKey, number>>;
  progress: number | null;
  createdAt: string | null;
  raw: IvrRow;
}

export interface CallRecord {
  id: string;
  leadPhone: string;
  leadName?: string;
  callerId: string;
  campaignId: string;
  campaignName: string;
  durationSeconds: number;
  dtmfKey?: string;
  disposition: 'Interested' | 'Not Interested' | 'No Answer' | 'Busy' | 'Voicemail' | 'DNC' | 'Transferred' | string;
  callTime: string;
  agentName?: string;
  audioUrl?: string;
}

export interface LeadList {
  id: string;
  name: string;
  totalCount: number;
  validCount: number;
  dncFilteredCount: number;
  uploadedAt: string;
  status: 'Ready' | 'Processing' | 'In Use';
}

export interface AgentGroup {
  id: string;
  name: string;
  description: string;
  activeAgents: number;
  totalAgents: number;
  transferDid: string;
  liveCallsCount: number;
}

export interface DispositionRule {
  key: string;
  label: string;
  action: 'Tag' | 'Transfer' | 'DNC' | 'Callback' | 'Hangup';
  targetGroup?: string;
  smsFollowup?: boolean;
}

export interface DidNumber {
  id: string;
  number: string;
  carrier: string;
  state: string;
  assignedCampaign?: string;
  callsToday: number;
  spamScore: 'Low' | 'Medium' | 'High';
  status: 'Active' | 'Cooling' | 'Blocked';
}

export interface IvrDid {
  id: string;
  number: string;
  label: string;
  raw: IvrRow;
}

export interface IvrCall {
  id: string;
  phone: string;
  status: string;
  direction: 'in' | 'out' | null;
  callType: string;
  callStatus: string;
  reason: string;
  disposition: string;
  leadName: string;
  durationSeconds: number | null;
  talkSeconds: number | null;
  at: string | null;
  campaign: string;
  agent: string;
  recordingUrl: string | null;
  recordingSeconds: number | null;
  raw: IvrRow;
}

export type IvrResource = 'campaigns' | 'cdr' | 'lead-lists' | 'agent-groups' | 'dispositions' | 'dids';
