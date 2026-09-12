export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  input: string[];
  protocol: "openai" | "anthropic" | "dual";
  status: "HEALTHY" | "SILENT_FAILURE_LONG_CONTEXT" | "QUOTA_EXHAUSTED" | "WAF_BLOCKED" | "UNTESTED";
  latencyMs?: number;
  notes?: string;
  lastTestedAt?: string;
}

export interface GatewayCredits {
  currency: string;
  hardLimitUsd?: number;
  totalUsageUsd?: number;
  remainingUsd?: number;
  rawQuota?: number;
  isUnlimitedOrUnverified?: boolean;
}

export interface RouterGateway {
  id: string;
  name: string;
  baseUrl: string;
  backupUrl?: string;
  apiKey: string;
  engine: "new-api" | "one-api" | "custom";
  status: "ONLINE" | "DEGRADED" | "WAF_PROTECTED" | "OFFLINE";
  credits: GatewayCredits;
  models: DiscoveredModel[];
  headers?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export interface ProbeOptions {
  testShort?: boolean;
  testMedium?: boolean;
  testLongContext?: boolean; // Checks for silent failures >400 words
  timeoutMs?: number;
}

export interface ProbeResult {
  gatewayId: string;
  baseUrl: string;
  online: boolean;
  engine: string;
  statusInfo?: any;
  credits: GatewayCredits;
  models: DiscoveredModel[];
  errors: string[];
}
