/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import { GraphQLClient, type RequestOptions } from 'graphql-request';
import gql from 'graphql-tag';
type GraphQLClientRequestHeaders = RequestOptions['requestHeaders'];
export type Account_Filter = {
  /** Filter for the block changed event. */
  _change_block?: BlockChangedFilter | null | undefined;
  and?: Array<Account_Filter | null | undefined> | null | undefined;
  clientJobs_?: Job_Filter | null | undefined;
  evaluatorJobs_?: Job_Filter | null | undefined;
  id?: string | null | undefined;
  id_contains?: string | null | undefined;
  id_gt?: string | null | undefined;
  id_gte?: string | null | undefined;
  id_in?: Array<string> | null | undefined;
  id_lt?: string | null | undefined;
  id_lte?: string | null | undefined;
  id_not?: string | null | undefined;
  id_not_contains?: string | null | undefined;
  id_not_in?: Array<string> | null | undefined;
  or?: Array<Account_Filter | null | undefined> | null | undefined;
  providerJobs_?: Job_Filter | null | undefined;
  submittedClaims_?: Claim_Filter | null | undefined;
};

export type AgenticCommerce_Filter = {
  /** Filter for the block changed event. */
  _change_block?: BlockChangedFilter | null | undefined;
  and?: Array<AgenticCommerce_Filter | null | undefined> | null | undefined;
  chainId?: string | null | undefined;
  chainId_gt?: string | null | undefined;
  chainId_gte?: string | null | undefined;
  chainId_in?: Array<string> | null | undefined;
  chainId_lt?: string | null | undefined;
  chainId_lte?: string | null | undefined;
  chainId_not?: string | null | undefined;
  chainId_not_in?: Array<string> | null | undefined;
  createdAt?: string | null | undefined;
  createdAt_gt?: string | null | undefined;
  createdAt_gte?: string | null | undefined;
  createdAt_in?: Array<string> | null | undefined;
  createdAt_lt?: string | null | undefined;
  createdAt_lte?: string | null | undefined;
  createdAt_not?: string | null | undefined;
  createdAt_not_in?: Array<string> | null | undefined;
  emergencyWithdrawals_?: EmergencyWithdrawal_Filter | null | undefined;
  evaluatorFeeBP?: string | null | undefined;
  evaluatorFeeBP_gt?: string | null | undefined;
  evaluatorFeeBP_gte?: string | null | undefined;
  evaluatorFeeBP_in?: Array<string> | null | undefined;
  evaluatorFeeBP_lt?: string | null | undefined;
  evaluatorFeeBP_lte?: string | null | undefined;
  evaluatorFeeBP_not?: string | null | undefined;
  evaluatorFeeBP_not_in?: Array<string> | null | undefined;
  hooks_?: HookAllowlistEntry_Filter | null | undefined;
  id?: string | null | undefined;
  id_contains?: string | null | undefined;
  id_gt?: string | null | undefined;
  id_gte?: string | null | undefined;
  id_in?: Array<string> | null | undefined;
  id_lt?: string | null | undefined;
  id_lte?: string | null | undefined;
  id_not?: string | null | undefined;
  id_not_contains?: string | null | undefined;
  id_not_in?: Array<string> | null | undefined;
  implementation?: string | null | undefined;
  implementation_contains?: string | null | undefined;
  implementation_gt?: string | null | undefined;
  implementation_gte?: string | null | undefined;
  implementation_in?: Array<string> | null | undefined;
  implementation_lt?: string | null | undefined;
  implementation_lte?: string | null | undefined;
  implementation_not?: string | null | undefined;
  implementation_not_contains?: string | null | undefined;
  implementation_not_in?: Array<string> | null | undefined;
  jobCount?: string | null | undefined;
  jobCount_gt?: string | null | undefined;
  jobCount_gte?: string | null | undefined;
  jobCount_in?: Array<string> | null | undefined;
  jobCount_lt?: string | null | undefined;
  jobCount_lte?: string | null | undefined;
  jobCount_not?: string | null | undefined;
  jobCount_not_in?: Array<string> | null | undefined;
  jobs_?: Job_Filter | null | undefined;
  network?: string | null | undefined;
  network_contains?: string | null | undefined;
  network_contains_nocase?: string | null | undefined;
  network_ends_with?: string | null | undefined;
  network_ends_with_nocase?: string | null | undefined;
  network_gt?: string | null | undefined;
  network_gte?: string | null | undefined;
  network_in?: Array<string> | null | undefined;
  network_lt?: string | null | undefined;
  network_lte?: string | null | undefined;
  network_not?: string | null | undefined;
  network_not_contains?: string | null | undefined;
  network_not_contains_nocase?: string | null | undefined;
  network_not_ends_with?: string | null | undefined;
  network_not_ends_with_nocase?: string | null | undefined;
  network_not_in?: Array<string> | null | undefined;
  network_not_starts_with?: string | null | undefined;
  network_not_starts_with_nocase?: string | null | undefined;
  network_starts_with?: string | null | undefined;
  network_starts_with_nocase?: string | null | undefined;
  or?: Array<AgenticCommerce_Filter | null | undefined> | null | undefined;
  paused?: boolean | null | undefined;
  paused_in?: Array<boolean> | null | undefined;
  paused_not?: boolean | null | undefined;
  paused_not_in?: Array<boolean> | null | undefined;
  paymentTokens_?: PaymentTokenAllowlistEntry_Filter | null | undefined;
  platformFeeBP?: string | null | undefined;
  platformFeeBP_gt?: string | null | undefined;
  platformFeeBP_gte?: string | null | undefined;
  platformFeeBP_in?: Array<string> | null | undefined;
  platformFeeBP_lt?: string | null | undefined;
  platformFeeBP_lte?: string | null | undefined;
  platformFeeBP_not?: string | null | undefined;
  platformFeeBP_not_in?: Array<string> | null | undefined;
  platformTreasury?: string | null | undefined;
  platformTreasury_?: Account_Filter | null | undefined;
  platformTreasury_contains?: string | null | undefined;
  platformTreasury_contains_nocase?: string | null | undefined;
  platformTreasury_ends_with?: string | null | undefined;
  platformTreasury_ends_with_nocase?: string | null | undefined;
  platformTreasury_gt?: string | null | undefined;
  platformTreasury_gte?: string | null | undefined;
  platformTreasury_in?: Array<string> | null | undefined;
  platformTreasury_lt?: string | null | undefined;
  platformTreasury_lte?: string | null | undefined;
  platformTreasury_not?: string | null | undefined;
  platformTreasury_not_contains?: string | null | undefined;
  platformTreasury_not_contains_nocase?: string | null | undefined;
  platformTreasury_not_ends_with?: string | null | undefined;
  platformTreasury_not_ends_with_nocase?: string | null | undefined;
  platformTreasury_not_in?: Array<string> | null | undefined;
  platformTreasury_not_starts_with?: string | null | undefined;
  platformTreasury_not_starts_with_nocase?: string | null | undefined;
  platformTreasury_starts_with?: string | null | undefined;
  platformTreasury_starts_with_nocase?: string | null | undefined;
  updatedAt?: string | null | undefined;
  updatedAt_gt?: string | null | undefined;
  updatedAt_gte?: string | null | undefined;
  updatedAt_in?: Array<string> | null | undefined;
  updatedAt_lt?: string | null | undefined;
  updatedAt_lte?: string | null | undefined;
  updatedAt_not?: string | null | undefined;
  updatedAt_not_in?: Array<string> | null | undefined;
};

export type BlockChangedFilter = {
  number_gte: number;
};

export type ClaimStatus =
  | 'APPROVED'
  | 'PENDING'
  | 'REJECTED';

export type Claim_Filter = {
  /** Filter for the block changed event. */
  _change_block?: BlockChangedFilter | null | undefined;
  and?: Array<Claim_Filter | null | undefined> | null | undefined;
  createdAt?: string | null | undefined;
  createdAtBlock?: string | null | undefined;
  createdAtBlock_gt?: string | null | undefined;
  createdAtBlock_gte?: string | null | undefined;
  createdAtBlock_in?: Array<string> | null | undefined;
  createdAtBlock_lt?: string | null | undefined;
  createdAtBlock_lte?: string | null | undefined;
  createdAtBlock_not?: string | null | undefined;
  createdAtBlock_not_in?: Array<string> | null | undefined;
  createdAtTransaction?: string | null | undefined;
  createdAtTransaction_contains?: string | null | undefined;
  createdAtTransaction_gt?: string | null | undefined;
  createdAtTransaction_gte?: string | null | undefined;
  createdAtTransaction_in?: Array<string> | null | undefined;
  createdAtTransaction_lt?: string | null | undefined;
  createdAtTransaction_lte?: string | null | undefined;
  createdAtTransaction_not?: string | null | undefined;
  createdAtTransaction_not_contains?: string | null | undefined;
  createdAtTransaction_not_in?: Array<string> | null | undefined;
  createdAt_gt?: string | null | undefined;
  createdAt_gte?: string | null | undefined;
  createdAt_in?: Array<string> | null | undefined;
  createdAt_lt?: string | null | undefined;
  createdAt_lte?: string | null | undefined;
  createdAt_not?: string | null | undefined;
  createdAt_not_in?: Array<string> | null | undefined;
  cumulativeAmount?: string | null | undefined;
  cumulativeAmount_gt?: string | null | undefined;
  cumulativeAmount_gte?: string | null | undefined;
  cumulativeAmount_in?: Array<string> | null | undefined;
  cumulativeAmount_lt?: string | null | undefined;
  cumulativeAmount_lte?: string | null | undefined;
  cumulativeAmount_not?: string | null | undefined;
  cumulativeAmount_not_in?: Array<string> | null | undefined;
  deliverable?: string | null | undefined;
  deliverable_contains?: string | null | undefined;
  deliverable_gt?: string | null | undefined;
  deliverable_gte?: string | null | undefined;
  deliverable_in?: Array<string> | null | undefined;
  deliverable_lt?: string | null | undefined;
  deliverable_lte?: string | null | undefined;
  deliverable_not?: string | null | undefined;
  deliverable_not_contains?: string | null | undefined;
  deliverable_not_in?: Array<string> | null | undefined;
  delta?: string | null | undefined;
  delta_gt?: string | null | undefined;
  delta_gte?: string | null | undefined;
  delta_in?: Array<string> | null | undefined;
  delta_lt?: string | null | undefined;
  delta_lte?: string | null | undefined;
  delta_not?: string | null | undefined;
  delta_not_in?: Array<string> | null | undefined;
  id?: string | null | undefined;
  id_contains?: string | null | undefined;
  id_gt?: string | null | undefined;
  id_gte?: string | null | undefined;
  id_in?: Array<string> | null | undefined;
  id_lt?: string | null | undefined;
  id_lte?: string | null | undefined;
  id_not?: string | null | undefined;
  id_not_contains?: string | null | undefined;
  id_not_in?: Array<string> | null | undefined;
  job?: string | null | undefined;
  job_?: Job_Filter | null | undefined;
  job_contains?: string | null | undefined;
  job_contains_nocase?: string | null | undefined;
  job_ends_with?: string | null | undefined;
  job_ends_with_nocase?: string | null | undefined;
  job_gt?: string | null | undefined;
  job_gte?: string | null | undefined;
  job_in?: Array<string> | null | undefined;
  job_lt?: string | null | undefined;
  job_lte?: string | null | undefined;
  job_not?: string | null | undefined;
  job_not_contains?: string | null | undefined;
  job_not_contains_nocase?: string | null | undefined;
  job_not_ends_with?: string | null | undefined;
  job_not_ends_with_nocase?: string | null | undefined;
  job_not_in?: Array<string> | null | undefined;
  job_not_starts_with?: string | null | undefined;
  job_not_starts_with_nocase?: string | null | undefined;
  job_starts_with?: string | null | undefined;
  job_starts_with_nocase?: string | null | undefined;
  optParams?: string | null | undefined;
  optParams_contains?: string | null | undefined;
  optParams_gt?: string | null | undefined;
  optParams_gte?: string | null | undefined;
  optParams_in?: Array<string> | null | undefined;
  optParams_lt?: string | null | undefined;
  optParams_lte?: string | null | undefined;
  optParams_not?: string | null | undefined;
  optParams_not_contains?: string | null | undefined;
  optParams_not_in?: Array<string> | null | undefined;
  or?: Array<Claim_Filter | null | undefined> | null | undefined;
  provider?: string | null | undefined;
  provider_?: Account_Filter | null | undefined;
  provider_contains?: string | null | undefined;
  provider_contains_nocase?: string | null | undefined;
  provider_ends_with?: string | null | undefined;
  provider_ends_with_nocase?: string | null | undefined;
  provider_gt?: string | null | undefined;
  provider_gte?: string | null | undefined;
  provider_in?: Array<string> | null | undefined;
  provider_lt?: string | null | undefined;
  provider_lte?: string | null | undefined;
  provider_not?: string | null | undefined;
  provider_not_contains?: string | null | undefined;
  provider_not_contains_nocase?: string | null | undefined;
  provider_not_ends_with?: string | null | undefined;
  provider_not_ends_with_nocase?: string | null | undefined;
  provider_not_in?: Array<string> | null | undefined;
  provider_not_starts_with?: string | null | undefined;
  provider_not_starts_with_nocase?: string | null | undefined;
  provider_starts_with?: string | null | undefined;
  provider_starts_with_nocase?: string | null | undefined;
  resolutionReason?: string | null | undefined;
  resolutionReason_contains?: string | null | undefined;
  resolutionReason_gt?: string | null | undefined;
  resolutionReason_gte?: string | null | undefined;
  resolutionReason_in?: Array<string> | null | undefined;
  resolutionReason_lt?: string | null | undefined;
  resolutionReason_lte?: string | null | undefined;
  resolutionReason_not?: string | null | undefined;
  resolutionReason_not_contains?: string | null | undefined;
  resolutionReason_not_in?: Array<string> | null | undefined;
  resolvedAt?: string | null | undefined;
  resolvedAtBlock?: string | null | undefined;
  resolvedAtBlock_gt?: string | null | undefined;
  resolvedAtBlock_gte?: string | null | undefined;
  resolvedAtBlock_in?: Array<string> | null | undefined;
  resolvedAtBlock_lt?: string | null | undefined;
  resolvedAtBlock_lte?: string | null | undefined;
  resolvedAtBlock_not?: string | null | undefined;
  resolvedAtBlock_not_in?: Array<string> | null | undefined;
  resolvedAtTransaction?: string | null | undefined;
  resolvedAtTransaction_contains?: string | null | undefined;
  resolvedAtTransaction_gt?: string | null | undefined;
  resolvedAtTransaction_gte?: string | null | undefined;
  resolvedAtTransaction_in?: Array<string> | null | undefined;
  resolvedAtTransaction_lt?: string | null | undefined;
  resolvedAtTransaction_lte?: string | null | undefined;
  resolvedAtTransaction_not?: string | null | undefined;
  resolvedAtTransaction_not_contains?: string | null | undefined;
  resolvedAtTransaction_not_in?: Array<string> | null | undefined;
  resolvedAt_gt?: string | null | undefined;
  resolvedAt_gte?: string | null | undefined;
  resolvedAt_in?: Array<string> | null | undefined;
  resolvedAt_lt?: string | null | undefined;
  resolvedAt_lte?: string | null | undefined;
  resolvedAt_not?: string | null | undefined;
  resolvedAt_not_in?: Array<string> | null | undefined;
  resolver?: string | null | undefined;
  resolver_?: Account_Filter | null | undefined;
  resolver_contains?: string | null | undefined;
  resolver_contains_nocase?: string | null | undefined;
  resolver_ends_with?: string | null | undefined;
  resolver_ends_with_nocase?: string | null | undefined;
  resolver_gt?: string | null | undefined;
  resolver_gte?: string | null | undefined;
  resolver_in?: Array<string> | null | undefined;
  resolver_lt?: string | null | undefined;
  resolver_lte?: string | null | undefined;
  resolver_not?: string | null | undefined;
  resolver_not_contains?: string | null | undefined;
  resolver_not_contains_nocase?: string | null | undefined;
  resolver_not_ends_with?: string | null | undefined;
  resolver_not_ends_with_nocase?: string | null | undefined;
  resolver_not_in?: Array<string> | null | undefined;
  resolver_not_starts_with?: string | null | undefined;
  resolver_not_starts_with_nocase?: string | null | undefined;
  resolver_starts_with?: string | null | undefined;
  resolver_starts_with_nocase?: string | null | undefined;
  status?: ClaimStatus | null | undefined;
  status_in?: Array<ClaimStatus> | null | undefined;
  status_not?: ClaimStatus | null | undefined;
  status_not_in?: Array<ClaimStatus> | null | undefined;
};

export type EmergencyWithdrawal_Filter = {
  /** Filter for the block changed event. */
  _change_block?: BlockChangedFilter | null | undefined;
  agenticCommerce?: string | null | undefined;
  agenticCommerce_?: AgenticCommerce_Filter | null | undefined;
  agenticCommerce_contains?: string | null | undefined;
  agenticCommerce_contains_nocase?: string | null | undefined;
  agenticCommerce_ends_with?: string | null | undefined;
  agenticCommerce_ends_with_nocase?: string | null | undefined;
  agenticCommerce_gt?: string | null | undefined;
  agenticCommerce_gte?: string | null | undefined;
  agenticCommerce_in?: Array<string> | null | undefined;
  agenticCommerce_lt?: string | null | undefined;
  agenticCommerce_lte?: string | null | undefined;
  agenticCommerce_not?: string | null | undefined;
  agenticCommerce_not_contains?: string | null | undefined;
  agenticCommerce_not_contains_nocase?: string | null | undefined;
  agenticCommerce_not_ends_with?: string | null | undefined;
  agenticCommerce_not_ends_with_nocase?: string | null | undefined;
  agenticCommerce_not_in?: Array<string> | null | undefined;
  agenticCommerce_not_starts_with?: string | null | undefined;
  agenticCommerce_not_starts_with_nocase?: string | null | undefined;
  agenticCommerce_starts_with?: string | null | undefined;
  agenticCommerce_starts_with_nocase?: string | null | undefined;
  amount?: string | null | undefined;
  amount_gt?: string | null | undefined;
  amount_gte?: string | null | undefined;
  amount_in?: Array<string> | null | undefined;
  amount_lt?: string | null | undefined;
  amount_lte?: string | null | undefined;
  amount_not?: string | null | undefined;
  amount_not_in?: Array<string> | null | undefined;
  and?: Array<EmergencyWithdrawal_Filter | null | undefined> | null | undefined;
  blockNumber?: string | null | undefined;
  blockNumber_gt?: string | null | undefined;
  blockNumber_gte?: string | null | undefined;
  blockNumber_in?: Array<string> | null | undefined;
  blockNumber_lt?: string | null | undefined;
  blockNumber_lte?: string | null | undefined;
  blockNumber_not?: string | null | undefined;
  blockNumber_not_in?: Array<string> | null | undefined;
  id?: string | null | undefined;
  id_contains?: string | null | undefined;
  id_gt?: string | null | undefined;
  id_gte?: string | null | undefined;
  id_in?: Array<string> | null | undefined;
  id_lt?: string | null | undefined;
  id_lte?: string | null | undefined;
  id_not?: string | null | undefined;
  id_not_contains?: string | null | undefined;
  id_not_in?: Array<string> | null | undefined;
  or?: Array<EmergencyWithdrawal_Filter | null | undefined> | null | undefined;
  timestamp?: string | null | undefined;
  timestamp_gt?: string | null | undefined;
  timestamp_gte?: string | null | undefined;
  timestamp_in?: Array<string> | null | undefined;
  timestamp_lt?: string | null | undefined;
  timestamp_lte?: string | null | undefined;
  timestamp_not?: string | null | undefined;
  timestamp_not_in?: Array<string> | null | undefined;
  to?: string | null | undefined;
  to_?: Account_Filter | null | undefined;
  to_contains?: string | null | undefined;
  to_contains_nocase?: string | null | undefined;
  to_ends_with?: string | null | undefined;
  to_ends_with_nocase?: string | null | undefined;
  to_gt?: string | null | undefined;
  to_gte?: string | null | undefined;
  to_in?: Array<string> | null | undefined;
  to_lt?: string | null | undefined;
  to_lte?: string | null | undefined;
  to_not?: string | null | undefined;
  to_not_contains?: string | null | undefined;
  to_not_contains_nocase?: string | null | undefined;
  to_not_ends_with?: string | null | undefined;
  to_not_ends_with_nocase?: string | null | undefined;
  to_not_in?: Array<string> | null | undefined;
  to_not_starts_with?: string | null | undefined;
  to_not_starts_with_nocase?: string | null | undefined;
  to_starts_with?: string | null | undefined;
  to_starts_with_nocase?: string | null | undefined;
  token?: string | null | undefined;
  token_contains?: string | null | undefined;
  token_gt?: string | null | undefined;
  token_gte?: string | null | undefined;
  token_in?: Array<string> | null | undefined;
  token_lt?: string | null | undefined;
  token_lte?: string | null | undefined;
  token_not?: string | null | undefined;
  token_not_contains?: string | null | undefined;
  token_not_in?: Array<string> | null | undefined;
  transactionHash?: string | null | undefined;
  transactionHash_contains?: string | null | undefined;
  transactionHash_gt?: string | null | undefined;
  transactionHash_gte?: string | null | undefined;
  transactionHash_in?: Array<string> | null | undefined;
  transactionHash_lt?: string | null | undefined;
  transactionHash_lte?: string | null | undefined;
  transactionHash_not?: string | null | undefined;
  transactionHash_not_contains?: string | null | undefined;
  transactionHash_not_in?: Array<string> | null | undefined;
};

export type HookAllowlistEntry_Filter = {
  /** Filter for the block changed event. */
  _change_block?: BlockChangedFilter | null | undefined;
  agenticCommerce?: string | null | undefined;
  agenticCommerce_?: AgenticCommerce_Filter | null | undefined;
  agenticCommerce_contains?: string | null | undefined;
  agenticCommerce_contains_nocase?: string | null | undefined;
  agenticCommerce_ends_with?: string | null | undefined;
  agenticCommerce_ends_with_nocase?: string | null | undefined;
  agenticCommerce_gt?: string | null | undefined;
  agenticCommerce_gte?: string | null | undefined;
  agenticCommerce_in?: Array<string> | null | undefined;
  agenticCommerce_lt?: string | null | undefined;
  agenticCommerce_lte?: string | null | undefined;
  agenticCommerce_not?: string | null | undefined;
  agenticCommerce_not_contains?: string | null | undefined;
  agenticCommerce_not_contains_nocase?: string | null | undefined;
  agenticCommerce_not_ends_with?: string | null | undefined;
  agenticCommerce_not_ends_with_nocase?: string | null | undefined;
  agenticCommerce_not_in?: Array<string> | null | undefined;
  agenticCommerce_not_starts_with?: string | null | undefined;
  agenticCommerce_not_starts_with_nocase?: string | null | undefined;
  agenticCommerce_starts_with?: string | null | undefined;
  agenticCommerce_starts_with_nocase?: string | null | undefined;
  allowed?: boolean | null | undefined;
  allowed_in?: Array<boolean> | null | undefined;
  allowed_not?: boolean | null | undefined;
  allowed_not_in?: Array<boolean> | null | undefined;
  and?: Array<HookAllowlistEntry_Filter | null | undefined> | null | undefined;
  hook?: string | null | undefined;
  hook_contains?: string | null | undefined;
  hook_gt?: string | null | undefined;
  hook_gte?: string | null | undefined;
  hook_in?: Array<string> | null | undefined;
  hook_lt?: string | null | undefined;
  hook_lte?: string | null | undefined;
  hook_not?: string | null | undefined;
  hook_not_contains?: string | null | undefined;
  hook_not_in?: Array<string> | null | undefined;
  id?: string | null | undefined;
  id_contains?: string | null | undefined;
  id_gt?: string | null | undefined;
  id_gte?: string | null | undefined;
  id_in?: Array<string> | null | undefined;
  id_lt?: string | null | undefined;
  id_lte?: string | null | undefined;
  id_not?: string | null | undefined;
  id_not_contains?: string | null | undefined;
  id_not_in?: Array<string> | null | undefined;
  or?: Array<HookAllowlistEntry_Filter | null | undefined> | null | undefined;
  updatedAt?: string | null | undefined;
  updatedAtBlock?: string | null | undefined;
  updatedAtBlock_gt?: string | null | undefined;
  updatedAtBlock_gte?: string | null | undefined;
  updatedAtBlock_in?: Array<string> | null | undefined;
  updatedAtBlock_lt?: string | null | undefined;
  updatedAtBlock_lte?: string | null | undefined;
  updatedAtBlock_not?: string | null | undefined;
  updatedAtBlock_not_in?: Array<string> | null | undefined;
  updatedAtTransaction?: string | null | undefined;
  updatedAtTransaction_contains?: string | null | undefined;
  updatedAtTransaction_gt?: string | null | undefined;
  updatedAtTransaction_gte?: string | null | undefined;
  updatedAtTransaction_in?: Array<string> | null | undefined;
  updatedAtTransaction_lt?: string | null | undefined;
  updatedAtTransaction_lte?: string | null | undefined;
  updatedAtTransaction_not?: string | null | undefined;
  updatedAtTransaction_not_contains?: string | null | undefined;
  updatedAtTransaction_not_in?: Array<string> | null | undefined;
  updatedAt_gt?: string | null | undefined;
  updatedAt_gte?: string | null | undefined;
  updatedAt_in?: Array<string> | null | undefined;
  updatedAt_lt?: string | null | undefined;
  updatedAt_lte?: string | null | undefined;
  updatedAt_not?: string | null | undefined;
  updatedAt_not_in?: Array<string> | null | undefined;
};

export type JobEventKind =
  | 'BUDGET_SET'
  | 'CLAIM_APPROVED'
  | 'CLAIM_REJECTED'
  | 'CLAIM_SETTLED'
  | 'CLAIM_SUBMITTED'
  | 'COMPLETED'
  | 'CREATED'
  | 'DISBURSED'
  | 'EVALUATOR_FEE_PAID'
  | 'EXPIRED'
  | 'FUNDED'
  | 'HOOK_DETACHED'
  | 'PAYMENT_RELEASED'
  | 'PAYOUT_RECEIVER_SET'
  | 'PLATFORM_FEE_PAID'
  | 'PROVIDER_SET'
  | 'REFUNDED'
  | 'REJECTED'
  | 'SETTLED'
  | 'SUBMITTED';

export type JobEvent_Filter = {
  /** Filter for the block changed event. */
  _change_block?: BlockChangedFilter | null | undefined;
  actor?: string | null | undefined;
  actor_?: Account_Filter | null | undefined;
  actor_contains?: string | null | undefined;
  actor_contains_nocase?: string | null | undefined;
  actor_ends_with?: string | null | undefined;
  actor_ends_with_nocase?: string | null | undefined;
  actor_gt?: string | null | undefined;
  actor_gte?: string | null | undefined;
  actor_in?: Array<string> | null | undefined;
  actor_lt?: string | null | undefined;
  actor_lte?: string | null | undefined;
  actor_not?: string | null | undefined;
  actor_not_contains?: string | null | undefined;
  actor_not_contains_nocase?: string | null | undefined;
  actor_not_ends_with?: string | null | undefined;
  actor_not_ends_with_nocase?: string | null | undefined;
  actor_not_in?: Array<string> | null | undefined;
  actor_not_starts_with?: string | null | undefined;
  actor_not_starts_with_nocase?: string | null | undefined;
  actor_starts_with?: string | null | undefined;
  actor_starts_with_nocase?: string | null | undefined;
  address?: string | null | undefined;
  address_contains?: string | null | undefined;
  address_gt?: string | null | undefined;
  address_gte?: string | null | undefined;
  address_in?: Array<string> | null | undefined;
  address_lt?: string | null | undefined;
  address_lte?: string | null | undefined;
  address_not?: string | null | undefined;
  address_not_contains?: string | null | undefined;
  address_not_in?: Array<string> | null | undefined;
  agenticCommerce?: string | null | undefined;
  agenticCommerce_?: AgenticCommerce_Filter | null | undefined;
  agenticCommerce_contains?: string | null | undefined;
  agenticCommerce_contains_nocase?: string | null | undefined;
  agenticCommerce_ends_with?: string | null | undefined;
  agenticCommerce_ends_with_nocase?: string | null | undefined;
  agenticCommerce_gt?: string | null | undefined;
  agenticCommerce_gte?: string | null | undefined;
  agenticCommerce_in?: Array<string> | null | undefined;
  agenticCommerce_lt?: string | null | undefined;
  agenticCommerce_lte?: string | null | undefined;
  agenticCommerce_not?: string | null | undefined;
  agenticCommerce_not_contains?: string | null | undefined;
  agenticCommerce_not_contains_nocase?: string | null | undefined;
  agenticCommerce_not_ends_with?: string | null | undefined;
  agenticCommerce_not_ends_with_nocase?: string | null | undefined;
  agenticCommerce_not_in?: Array<string> | null | undefined;
  agenticCommerce_not_starts_with?: string | null | undefined;
  agenticCommerce_not_starts_with_nocase?: string | null | undefined;
  agenticCommerce_starts_with?: string | null | undefined;
  agenticCommerce_starts_with_nocase?: string | null | undefined;
  amount?: string | null | undefined;
  amount_gt?: string | null | undefined;
  amount_gte?: string | null | undefined;
  amount_in?: Array<string> | null | undefined;
  amount_lt?: string | null | undefined;
  amount_lte?: string | null | undefined;
  amount_not?: string | null | undefined;
  amount_not_in?: Array<string> | null | undefined;
  and?: Array<JobEvent_Filter | null | undefined> | null | undefined;
  blockNumber?: string | null | undefined;
  blockNumber_gt?: string | null | undefined;
  blockNumber_gte?: string | null | undefined;
  blockNumber_in?: Array<string> | null | undefined;
  blockNumber_lt?: string | null | undefined;
  blockNumber_lte?: string | null | undefined;
  blockNumber_not?: string | null | undefined;
  blockNumber_not_in?: Array<string> | null | undefined;
  cumulativeAmount?: string | null | undefined;
  cumulativeAmount_gt?: string | null | undefined;
  cumulativeAmount_gte?: string | null | undefined;
  cumulativeAmount_in?: Array<string> | null | undefined;
  cumulativeAmount_lt?: string | null | undefined;
  cumulativeAmount_lte?: string | null | undefined;
  cumulativeAmount_not?: string | null | undefined;
  cumulativeAmount_not_in?: Array<string> | null | undefined;
  data?: string | null | undefined;
  data_contains?: string | null | undefined;
  data_gt?: string | null | undefined;
  data_gte?: string | null | undefined;
  data_in?: Array<string> | null | undefined;
  data_lt?: string | null | undefined;
  data_lte?: string | null | undefined;
  data_not?: string | null | undefined;
  data_not_contains?: string | null | undefined;
  data_not_in?: Array<string> | null | undefined;
  delta?: string | null | undefined;
  delta_gt?: string | null | undefined;
  delta_gte?: string | null | undefined;
  delta_in?: Array<string> | null | undefined;
  delta_lt?: string | null | undefined;
  delta_lte?: string | null | undefined;
  delta_not?: string | null | undefined;
  delta_not_in?: Array<string> | null | undefined;
  id?: string | null | undefined;
  id_contains?: string | null | undefined;
  id_gt?: string | null | undefined;
  id_gte?: string | null | undefined;
  id_in?: Array<string> | null | undefined;
  id_lt?: string | null | undefined;
  id_lte?: string | null | undefined;
  id_not?: string | null | undefined;
  id_not_contains?: string | null | undefined;
  id_not_in?: Array<string> | null | undefined;
  job?: string | null | undefined;
  job_?: Job_Filter | null | undefined;
  job_contains?: string | null | undefined;
  job_contains_nocase?: string | null | undefined;
  job_ends_with?: string | null | undefined;
  job_ends_with_nocase?: string | null | undefined;
  job_gt?: string | null | undefined;
  job_gte?: string | null | undefined;
  job_in?: Array<string> | null | undefined;
  job_lt?: string | null | undefined;
  job_lte?: string | null | undefined;
  job_not?: string | null | undefined;
  job_not_contains?: string | null | undefined;
  job_not_contains_nocase?: string | null | undefined;
  job_not_ends_with?: string | null | undefined;
  job_not_ends_with_nocase?: string | null | undefined;
  job_not_in?: Array<string> | null | undefined;
  job_not_starts_with?: string | null | undefined;
  job_not_starts_with_nocase?: string | null | undefined;
  job_starts_with?: string | null | undefined;
  job_starts_with_nocase?: string | null | undefined;
  kind?: JobEventKind | null | undefined;
  kind_in?: Array<JobEventKind> | null | undefined;
  kind_not?: JobEventKind | null | undefined;
  kind_not_in?: Array<JobEventKind> | null | undefined;
  logIndex?: string | null | undefined;
  logIndex_gt?: string | null | undefined;
  logIndex_gte?: string | null | undefined;
  logIndex_in?: Array<string> | null | undefined;
  logIndex_lt?: string | null | undefined;
  logIndex_lte?: string | null | undefined;
  logIndex_not?: string | null | undefined;
  logIndex_not_in?: Array<string> | null | undefined;
  optParams?: string | null | undefined;
  optParams_contains?: string | null | undefined;
  optParams_gt?: string | null | undefined;
  optParams_gte?: string | null | undefined;
  optParams_in?: Array<string> | null | undefined;
  optParams_lt?: string | null | undefined;
  optParams_lte?: string | null | undefined;
  optParams_not?: string | null | undefined;
  optParams_not_contains?: string | null | undefined;
  optParams_not_in?: Array<string> | null | undefined;
  or?: Array<JobEvent_Filter | null | undefined> | null | undefined;
  selector?: string | null | undefined;
  selector_contains?: string | null | undefined;
  selector_gt?: string | null | undefined;
  selector_gte?: string | null | undefined;
  selector_in?: Array<string> | null | undefined;
  selector_lt?: string | null | undefined;
  selector_lte?: string | null | undefined;
  selector_not?: string | null | undefined;
  selector_not_contains?: string | null | undefined;
  selector_not_in?: Array<string> | null | undefined;
  timestamp?: string | null | undefined;
  timestamp_gt?: string | null | undefined;
  timestamp_gte?: string | null | undefined;
  timestamp_in?: Array<string> | null | undefined;
  timestamp_lt?: string | null | undefined;
  timestamp_lte?: string | null | undefined;
  timestamp_not?: string | null | undefined;
  timestamp_not_in?: Array<string> | null | undefined;
  token?: string | null | undefined;
  token_contains?: string | null | undefined;
  token_gt?: string | null | undefined;
  token_gte?: string | null | undefined;
  token_in?: Array<string> | null | undefined;
  token_lt?: string | null | undefined;
  token_lte?: string | null | undefined;
  token_not?: string | null | undefined;
  token_not_contains?: string | null | undefined;
  token_not_in?: Array<string> | null | undefined;
  transactionHash?: string | null | undefined;
  transactionHash_contains?: string | null | undefined;
  transactionHash_gt?: string | null | undefined;
  transactionHash_gte?: string | null | undefined;
  transactionHash_in?: Array<string> | null | undefined;
  transactionHash_lt?: string | null | undefined;
  transactionHash_lte?: string | null | undefined;
  transactionHash_not?: string | null | undefined;
  transactionHash_not_contains?: string | null | undefined;
  transactionHash_not_in?: Array<string> | null | undefined;
};

export type JobStatus =
  | 'COMPLETED'
  | 'EXPIRED'
  | 'FUNDED'
  | 'OPEN'
  | 'REJECTED'
  | 'SUBMITTED';

export type Job_Filter = {
  /** Filter for the block changed event. */
  _change_block?: BlockChangedFilter | null | undefined;
  agenticCommerce?: string | null | undefined;
  agenticCommerce_?: AgenticCommerce_Filter | null | undefined;
  agenticCommerce_contains?: string | null | undefined;
  agenticCommerce_contains_nocase?: string | null | undefined;
  agenticCommerce_ends_with?: string | null | undefined;
  agenticCommerce_ends_with_nocase?: string | null | undefined;
  agenticCommerce_gt?: string | null | undefined;
  agenticCommerce_gte?: string | null | undefined;
  agenticCommerce_in?: Array<string> | null | undefined;
  agenticCommerce_lt?: string | null | undefined;
  agenticCommerce_lte?: string | null | undefined;
  agenticCommerce_not?: string | null | undefined;
  agenticCommerce_not_contains?: string | null | undefined;
  agenticCommerce_not_contains_nocase?: string | null | undefined;
  agenticCommerce_not_ends_with?: string | null | undefined;
  agenticCommerce_not_ends_with_nocase?: string | null | undefined;
  agenticCommerce_not_in?: Array<string> | null | undefined;
  agenticCommerce_not_starts_with?: string | null | undefined;
  agenticCommerce_not_starts_with_nocase?: string | null | undefined;
  agenticCommerce_starts_with?: string | null | undefined;
  agenticCommerce_starts_with_nocase?: string | null | undefined;
  and?: Array<Job_Filter | null | undefined> | null | undefined;
  budget?: string | null | undefined;
  budget_gt?: string | null | undefined;
  budget_gte?: string | null | undefined;
  budget_in?: Array<string> | null | undefined;
  budget_lt?: string | null | undefined;
  budget_lte?: string | null | undefined;
  budget_not?: string | null | undefined;
  budget_not_in?: Array<string> | null | undefined;
  claims_?: Claim_Filter | null | undefined;
  client?: string | null | undefined;
  client_?: Account_Filter | null | undefined;
  client_contains?: string | null | undefined;
  client_contains_nocase?: string | null | undefined;
  client_ends_with?: string | null | undefined;
  client_ends_with_nocase?: string | null | undefined;
  client_gt?: string | null | undefined;
  client_gte?: string | null | undefined;
  client_in?: Array<string> | null | undefined;
  client_lt?: string | null | undefined;
  client_lte?: string | null | undefined;
  client_not?: string | null | undefined;
  client_not_contains?: string | null | undefined;
  client_not_contains_nocase?: string | null | undefined;
  client_not_ends_with?: string | null | undefined;
  client_not_ends_with_nocase?: string | null | undefined;
  client_not_in?: Array<string> | null | undefined;
  client_not_starts_with?: string | null | undefined;
  client_not_starts_with_nocase?: string | null | undefined;
  client_starts_with?: string | null | undefined;
  client_starts_with_nocase?: string | null | undefined;
  completionReason?: string | null | undefined;
  completionReason_contains?: string | null | undefined;
  completionReason_gt?: string | null | undefined;
  completionReason_gte?: string | null | undefined;
  completionReason_in?: Array<string> | null | undefined;
  completionReason_lt?: string | null | undefined;
  completionReason_lte?: string | null | undefined;
  completionReason_not?: string | null | undefined;
  completionReason_not_contains?: string | null | undefined;
  completionReason_not_in?: Array<string> | null | undefined;
  createdAt?: string | null | undefined;
  createdAtBlock?: string | null | undefined;
  createdAtBlock_gt?: string | null | undefined;
  createdAtBlock_gte?: string | null | undefined;
  createdAtBlock_in?: Array<string> | null | undefined;
  createdAtBlock_lt?: string | null | undefined;
  createdAtBlock_lte?: string | null | undefined;
  createdAtBlock_not?: string | null | undefined;
  createdAtBlock_not_in?: Array<string> | null | undefined;
  createdAtTransaction?: string | null | undefined;
  createdAtTransaction_contains?: string | null | undefined;
  createdAtTransaction_gt?: string | null | undefined;
  createdAtTransaction_gte?: string | null | undefined;
  createdAtTransaction_in?: Array<string> | null | undefined;
  createdAtTransaction_lt?: string | null | undefined;
  createdAtTransaction_lte?: string | null | undefined;
  createdAtTransaction_not?: string | null | undefined;
  createdAtTransaction_not_contains?: string | null | undefined;
  createdAtTransaction_not_in?: Array<string> | null | undefined;
  createdAt_gt?: string | null | undefined;
  createdAt_gte?: string | null | undefined;
  createdAt_in?: Array<string> | null | undefined;
  createdAt_lt?: string | null | undefined;
  createdAt_lte?: string | null | undefined;
  createdAt_not?: string | null | undefined;
  createdAt_not_in?: Array<string> | null | undefined;
  deliverable?: string | null | undefined;
  deliverable_contains?: string | null | undefined;
  deliverable_gt?: string | null | undefined;
  deliverable_gte?: string | null | undefined;
  deliverable_in?: Array<string> | null | undefined;
  deliverable_lt?: string | null | undefined;
  deliverable_lte?: string | null | undefined;
  deliverable_not?: string | null | undefined;
  deliverable_not_contains?: string | null | undefined;
  deliverable_not_in?: Array<string> | null | undefined;
  description?: string | null | undefined;
  description_contains?: string | null | undefined;
  description_contains_nocase?: string | null | undefined;
  description_ends_with?: string | null | undefined;
  description_ends_with_nocase?: string | null | undefined;
  description_gt?: string | null | undefined;
  description_gte?: string | null | undefined;
  description_in?: Array<string> | null | undefined;
  description_lt?: string | null | undefined;
  description_lte?: string | null | undefined;
  description_not?: string | null | undefined;
  description_not_contains?: string | null | undefined;
  description_not_contains_nocase?: string | null | undefined;
  description_not_ends_with?: string | null | undefined;
  description_not_ends_with_nocase?: string | null | undefined;
  description_not_in?: Array<string> | null | undefined;
  description_not_starts_with?: string | null | undefined;
  description_not_starts_with_nocase?: string | null | undefined;
  description_starts_with?: string | null | undefined;
  description_starts_with_nocase?: string | null | undefined;
  evaluator?: string | null | undefined;
  evaluatorFeePaid?: string | null | undefined;
  evaluatorFeePaid_gt?: string | null | undefined;
  evaluatorFeePaid_gte?: string | null | undefined;
  evaluatorFeePaid_in?: Array<string> | null | undefined;
  evaluatorFeePaid_lt?: string | null | undefined;
  evaluatorFeePaid_lte?: string | null | undefined;
  evaluatorFeePaid_not?: string | null | undefined;
  evaluatorFeePaid_not_in?: Array<string> | null | undefined;
  evaluator_?: Account_Filter | null | undefined;
  evaluator_contains?: string | null | undefined;
  evaluator_contains_nocase?: string | null | undefined;
  evaluator_ends_with?: string | null | undefined;
  evaluator_ends_with_nocase?: string | null | undefined;
  evaluator_gt?: string | null | undefined;
  evaluator_gte?: string | null | undefined;
  evaluator_in?: Array<string> | null | undefined;
  evaluator_lt?: string | null | undefined;
  evaluator_lte?: string | null | undefined;
  evaluator_not?: string | null | undefined;
  evaluator_not_contains?: string | null | undefined;
  evaluator_not_contains_nocase?: string | null | undefined;
  evaluator_not_ends_with?: string | null | undefined;
  evaluator_not_ends_with_nocase?: string | null | undefined;
  evaluator_not_in?: Array<string> | null | undefined;
  evaluator_not_starts_with?: string | null | undefined;
  evaluator_not_starts_with_nocase?: string | null | undefined;
  evaluator_starts_with?: string | null | undefined;
  evaluator_starts_with_nocase?: string | null | undefined;
  events_?: JobEvent_Filter | null | undefined;
  expiresAt?: string | null | undefined;
  expiresAt_gt?: string | null | undefined;
  expiresAt_gte?: string | null | undefined;
  expiresAt_in?: Array<string> | null | undefined;
  expiresAt_lt?: string | null | undefined;
  expiresAt_lte?: string | null | undefined;
  expiresAt_not?: string | null | undefined;
  expiresAt_not_in?: Array<string> | null | undefined;
  hook?: string | null | undefined;
  hook_contains?: string | null | undefined;
  hook_gt?: string | null | undefined;
  hook_gte?: string | null | undefined;
  hook_in?: Array<string> | null | undefined;
  hook_lt?: string | null | undefined;
  hook_lte?: string | null | undefined;
  hook_not?: string | null | undefined;
  hook_not_contains?: string | null | undefined;
  hook_not_in?: Array<string> | null | undefined;
  id?: string | null | undefined;
  id_contains?: string | null | undefined;
  id_gt?: string | null | undefined;
  id_gte?: string | null | undefined;
  id_in?: Array<string> | null | undefined;
  id_lt?: string | null | undefined;
  id_lte?: string | null | undefined;
  id_not?: string | null | undefined;
  id_not_contains?: string | null | undefined;
  id_not_in?: Array<string> | null | undefined;
  jobId?: string | null | undefined;
  jobId_gt?: string | null | undefined;
  jobId_gte?: string | null | undefined;
  jobId_in?: Array<string> | null | undefined;
  jobId_lt?: string | null | undefined;
  jobId_lte?: string | null | undefined;
  jobId_not?: string | null | undefined;
  jobId_not_in?: Array<string> | null | undefined;
  or?: Array<Job_Filter | null | undefined> | null | undefined;
  paymentToken?: string | null | undefined;
  paymentToken_contains?: string | null | undefined;
  paymentToken_gt?: string | null | undefined;
  paymentToken_gte?: string | null | undefined;
  paymentToken_in?: Array<string> | null | undefined;
  paymentToken_lt?: string | null | undefined;
  paymentToken_lte?: string | null | undefined;
  paymentToken_not?: string | null | undefined;
  paymentToken_not_contains?: string | null | undefined;
  paymentToken_not_in?: Array<string> | null | undefined;
  payoutReceiver?: string | null | undefined;
  payoutReceiver_?: Account_Filter | null | undefined;
  payoutReceiver_contains?: string | null | undefined;
  payoutReceiver_contains_nocase?: string | null | undefined;
  payoutReceiver_ends_with?: string | null | undefined;
  payoutReceiver_ends_with_nocase?: string | null | undefined;
  payoutReceiver_gt?: string | null | undefined;
  payoutReceiver_gte?: string | null | undefined;
  payoutReceiver_in?: Array<string> | null | undefined;
  payoutReceiver_lt?: string | null | undefined;
  payoutReceiver_lte?: string | null | undefined;
  payoutReceiver_not?: string | null | undefined;
  payoutReceiver_not_contains?: string | null | undefined;
  payoutReceiver_not_contains_nocase?: string | null | undefined;
  payoutReceiver_not_ends_with?: string | null | undefined;
  payoutReceiver_not_ends_with_nocase?: string | null | undefined;
  payoutReceiver_not_in?: Array<string> | null | undefined;
  payoutReceiver_not_starts_with?: string | null | undefined;
  payoutReceiver_not_starts_with_nocase?: string | null | undefined;
  payoutReceiver_starts_with?: string | null | undefined;
  payoutReceiver_starts_with_nocase?: string | null | undefined;
  pendingClaim?: string | null | undefined;
  pendingClaim_?: Claim_Filter | null | undefined;
  pendingClaim_contains?: string | null | undefined;
  pendingClaim_contains_nocase?: string | null | undefined;
  pendingClaim_ends_with?: string | null | undefined;
  pendingClaim_ends_with_nocase?: string | null | undefined;
  pendingClaim_gt?: string | null | undefined;
  pendingClaim_gte?: string | null | undefined;
  pendingClaim_in?: Array<string> | null | undefined;
  pendingClaim_lt?: string | null | undefined;
  pendingClaim_lte?: string | null | undefined;
  pendingClaim_not?: string | null | undefined;
  pendingClaim_not_contains?: string | null | undefined;
  pendingClaim_not_contains_nocase?: string | null | undefined;
  pendingClaim_not_ends_with?: string | null | undefined;
  pendingClaim_not_ends_with_nocase?: string | null | undefined;
  pendingClaim_not_in?: Array<string> | null | undefined;
  pendingClaim_not_starts_with?: string | null | undefined;
  pendingClaim_not_starts_with_nocase?: string | null | undefined;
  pendingClaim_starts_with?: string | null | undefined;
  pendingClaim_starts_with_nocase?: string | null | undefined;
  platformFeePaid?: string | null | undefined;
  platformFeePaid_gt?: string | null | undefined;
  platformFeePaid_gte?: string | null | undefined;
  platformFeePaid_in?: Array<string> | null | undefined;
  platformFeePaid_lt?: string | null | undefined;
  platformFeePaid_lte?: string | null | undefined;
  platformFeePaid_not?: string | null | undefined;
  platformFeePaid_not_in?: Array<string> | null | undefined;
  provider?: string | null | undefined;
  providerAgentId?: string | null | undefined;
  providerAgentId_gt?: string | null | undefined;
  providerAgentId_gte?: string | null | undefined;
  providerAgentId_in?: Array<string> | null | undefined;
  providerAgentId_lt?: string | null | undefined;
  providerAgentId_lte?: string | null | undefined;
  providerAgentId_not?: string | null | undefined;
  providerAgentId_not_in?: Array<string> | null | undefined;
  providerPayment?: string | null | undefined;
  providerPayment_gt?: string | null | undefined;
  providerPayment_gte?: string | null | undefined;
  providerPayment_in?: Array<string> | null | undefined;
  providerPayment_lt?: string | null | undefined;
  providerPayment_lte?: string | null | undefined;
  providerPayment_not?: string | null | undefined;
  providerPayment_not_in?: Array<string> | null | undefined;
  provider_?: Account_Filter | null | undefined;
  provider_contains?: string | null | undefined;
  provider_contains_nocase?: string | null | undefined;
  provider_ends_with?: string | null | undefined;
  provider_ends_with_nocase?: string | null | undefined;
  provider_gt?: string | null | undefined;
  provider_gte?: string | null | undefined;
  provider_in?: Array<string> | null | undefined;
  provider_lt?: string | null | undefined;
  provider_lte?: string | null | undefined;
  provider_not?: string | null | undefined;
  provider_not_contains?: string | null | undefined;
  provider_not_contains_nocase?: string | null | undefined;
  provider_not_ends_with?: string | null | undefined;
  provider_not_ends_with_nocase?: string | null | undefined;
  provider_not_in?: Array<string> | null | undefined;
  provider_not_starts_with?: string | null | undefined;
  provider_not_starts_with_nocase?: string | null | undefined;
  provider_starts_with?: string | null | undefined;
  provider_starts_with_nocase?: string | null | undefined;
  refundedAmount?: string | null | undefined;
  refundedAmount_gt?: string | null | undefined;
  refundedAmount_gte?: string | null | undefined;
  refundedAmount_in?: Array<string> | null | undefined;
  refundedAmount_lt?: string | null | undefined;
  refundedAmount_lte?: string | null | undefined;
  refundedAmount_not?: string | null | undefined;
  refundedAmount_not_in?: Array<string> | null | undefined;
  rejectionReason?: string | null | undefined;
  rejectionReason_contains?: string | null | undefined;
  rejectionReason_gt?: string | null | undefined;
  rejectionReason_gte?: string | null | undefined;
  rejectionReason_in?: Array<string> | null | undefined;
  rejectionReason_lt?: string | null | undefined;
  rejectionReason_lte?: string | null | undefined;
  rejectionReason_not?: string | null | undefined;
  rejectionReason_not_contains?: string | null | undefined;
  rejectionReason_not_in?: Array<string> | null | undefined;
  settledAmount?: string | null | undefined;
  settledAmount_gt?: string | null | undefined;
  settledAmount_gte?: string | null | undefined;
  settledAmount_in?: Array<string> | null | undefined;
  settledAmount_lt?: string | null | undefined;
  settledAmount_lte?: string | null | undefined;
  settledAmount_not?: string | null | undefined;
  settledAmount_not_in?: Array<string> | null | undefined;
  status?: JobStatus | null | undefined;
  status_in?: Array<JobStatus> | null | undefined;
  status_not?: JobStatus | null | undefined;
  status_not_in?: Array<JobStatus> | null | undefined;
  submittedAt?: string | null | undefined;
  submittedAt_gt?: string | null | undefined;
  submittedAt_gte?: string | null | undefined;
  submittedAt_in?: Array<string> | null | undefined;
  submittedAt_lt?: string | null | undefined;
  submittedAt_lte?: string | null | undefined;
  submittedAt_not?: string | null | undefined;
  submittedAt_not_in?: Array<string> | null | undefined;
  updatedAt?: string | null | undefined;
  updatedAtBlock?: string | null | undefined;
  updatedAtBlock_gt?: string | null | undefined;
  updatedAtBlock_gte?: string | null | undefined;
  updatedAtBlock_in?: Array<string> | null | undefined;
  updatedAtBlock_lt?: string | null | undefined;
  updatedAtBlock_lte?: string | null | undefined;
  updatedAtBlock_not?: string | null | undefined;
  updatedAtBlock_not_in?: Array<string> | null | undefined;
  updatedAtTransaction?: string | null | undefined;
  updatedAtTransaction_contains?: string | null | undefined;
  updatedAtTransaction_gt?: string | null | undefined;
  updatedAtTransaction_gte?: string | null | undefined;
  updatedAtTransaction_in?: Array<string> | null | undefined;
  updatedAtTransaction_lt?: string | null | undefined;
  updatedAtTransaction_lte?: string | null | undefined;
  updatedAtTransaction_not?: string | null | undefined;
  updatedAtTransaction_not_contains?: string | null | undefined;
  updatedAtTransaction_not_in?: Array<string> | null | undefined;
  updatedAt_gt?: string | null | undefined;
  updatedAt_gte?: string | null | undefined;
  updatedAt_in?: Array<string> | null | undefined;
  updatedAt_lt?: string | null | undefined;
  updatedAt_lte?: string | null | undefined;
  updatedAt_not?: string | null | undefined;
  updatedAt_not_in?: Array<string> | null | undefined;
};

export type PaymentTokenAllowlistEntry_Filter = {
  /** Filter for the block changed event. */
  _change_block?: BlockChangedFilter | null | undefined;
  agenticCommerce?: string | null | undefined;
  agenticCommerce_?: AgenticCommerce_Filter | null | undefined;
  agenticCommerce_contains?: string | null | undefined;
  agenticCommerce_contains_nocase?: string | null | undefined;
  agenticCommerce_ends_with?: string | null | undefined;
  agenticCommerce_ends_with_nocase?: string | null | undefined;
  agenticCommerce_gt?: string | null | undefined;
  agenticCommerce_gte?: string | null | undefined;
  agenticCommerce_in?: Array<string> | null | undefined;
  agenticCommerce_lt?: string | null | undefined;
  agenticCommerce_lte?: string | null | undefined;
  agenticCommerce_not?: string | null | undefined;
  agenticCommerce_not_contains?: string | null | undefined;
  agenticCommerce_not_contains_nocase?: string | null | undefined;
  agenticCommerce_not_ends_with?: string | null | undefined;
  agenticCommerce_not_ends_with_nocase?: string | null | undefined;
  agenticCommerce_not_in?: Array<string> | null | undefined;
  agenticCommerce_not_starts_with?: string | null | undefined;
  agenticCommerce_not_starts_with_nocase?: string | null | undefined;
  agenticCommerce_starts_with?: string | null | undefined;
  agenticCommerce_starts_with_nocase?: string | null | undefined;
  allowed?: boolean | null | undefined;
  allowed_in?: Array<boolean> | null | undefined;
  allowed_not?: boolean | null | undefined;
  allowed_not_in?: Array<boolean> | null | undefined;
  and?: Array<PaymentTokenAllowlistEntry_Filter | null | undefined> | null | undefined;
  id?: string | null | undefined;
  id_contains?: string | null | undefined;
  id_gt?: string | null | undefined;
  id_gte?: string | null | undefined;
  id_in?: Array<string> | null | undefined;
  id_lt?: string | null | undefined;
  id_lte?: string | null | undefined;
  id_not?: string | null | undefined;
  id_not_contains?: string | null | undefined;
  id_not_in?: Array<string> | null | undefined;
  or?: Array<PaymentTokenAllowlistEntry_Filter | null | undefined> | null | undefined;
  token?: string | null | undefined;
  token_contains?: string | null | undefined;
  token_gt?: string | null | undefined;
  token_gte?: string | null | undefined;
  token_in?: Array<string> | null | undefined;
  token_lt?: string | null | undefined;
  token_lte?: string | null | undefined;
  token_not?: string | null | undefined;
  token_not_contains?: string | null | undefined;
  token_not_in?: Array<string> | null | undefined;
  updatedAt?: string | null | undefined;
  updatedAtBlock?: string | null | undefined;
  updatedAtBlock_gt?: string | null | undefined;
  updatedAtBlock_gte?: string | null | undefined;
  updatedAtBlock_in?: Array<string> | null | undefined;
  updatedAtBlock_lt?: string | null | undefined;
  updatedAtBlock_lte?: string | null | undefined;
  updatedAtBlock_not?: string | null | undefined;
  updatedAtBlock_not_in?: Array<string> | null | undefined;
  updatedAtTransaction?: string | null | undefined;
  updatedAtTransaction_contains?: string | null | undefined;
  updatedAtTransaction_gt?: string | null | undefined;
  updatedAtTransaction_gte?: string | null | undefined;
  updatedAtTransaction_in?: Array<string> | null | undefined;
  updatedAtTransaction_lt?: string | null | undefined;
  updatedAtTransaction_lte?: string | null | undefined;
  updatedAtTransaction_not?: string | null | undefined;
  updatedAtTransaction_not_contains?: string | null | undefined;
  updatedAtTransaction_not_in?: Array<string> | null | undefined;
  updatedAt_gt?: string | null | undefined;
  updatedAt_gte?: string | null | undefined;
  updatedAt_in?: Array<string> | null | undefined;
  updatedAt_lt?: string | null | undefined;
  updatedAt_lte?: string | null | undefined;
  updatedAt_not?: string | null | undefined;
  updatedAt_not_in?: Array<string> | null | undefined;
};

export type JobActivityFragment = { kind: JobEventKind, amount: string | null, timestamp: string, txHash: string, actor: { address: string } | null };

export type JobSummaryFragment = { jobId: string, status: JobStatus, providerAgentId: string, description: string, deliverable: string | null, completionReason: string | null, rejectionReason: string | null, budget: string, paymentToken: string | null, expiresAt: string, createdAt: string, updatedAt: string, client: { address: string }, provider: { address: string } | null, evaluator: { address: string }, activities: Array<{ kind: JobEventKind, amount: string | null, timestamp: string, txHash: string, actor: { address: string } | null }> };

export type ListJobsQueryVariables = Exact<{
  first?: number | null | undefined;
  skip?: number | null | undefined;
  where?: Job_Filter | null | undefined;
}>;


export type ListJobsQuery = { jobs: Array<{ jobId: string, status: JobStatus, providerAgentId: string, description: string, deliverable: string | null, completionReason: string | null, rejectionReason: string | null, budget: string, paymentToken: string | null, expiresAt: string, createdAt: string, updatedAt: string, client: { address: string }, provider: { address: string } | null, evaluator: { address: string }, activities: Array<{ kind: JobEventKind, amount: string | null, timestamp: string, txHash: string, actor: { address: string } | null }> }> };

export type GetJobQueryVariables = Exact<{
  jobId: string;
}>;


export type GetJobQuery = { jobs: Array<{ jobId: string, status: JobStatus, providerAgentId: string, description: string, deliverable: string | null, completionReason: string | null, rejectionReason: string | null, budget: string, paymentToken: string | null, expiresAt: string, createdAt: string, updatedAt: string, client: { address: string }, provider: { address: string } | null, evaluator: { address: string }, activities: Array<{ kind: JobEventKind, amount: string | null, timestamp: string, txHash: string, actor: { address: string } | null }> }> };

export const JobActivityFragmentDoc = gql`
    fragment JobActivity on JobEvent {
  kind
  actor {
    address: id
  }
  amount
  timestamp
  txHash: transactionHash
}
    `;
export const JobSummaryFragmentDoc = gql`
    fragment JobSummary on Job {
  jobId
  status
  client {
    address: id
  }
  provider {
    address: id
  }
  evaluator {
    address: id
  }
  providerAgentId
  description
  deliverable
  completionReason
  rejectionReason
  budget
  paymentToken
  expiresAt
  createdAt
  updatedAt
  activities: events(first: 1000, orderBy: timestamp, orderDirection: asc) {
    ...JobActivity
  }
}
    ${JobActivityFragmentDoc}`;
export const ListJobsDocument = gql`
    query ListJobs($first: Int, $skip: Int, $where: Job_filter) {
  jobs(
    first: $first
    skip: $skip
    orderBy: jobId
    orderDirection: asc
    where: $where
  ) {
    ...JobSummary
  }
}
    ${JobSummaryFragmentDoc}`;
export const GetJobDocument = gql`
    query GetJob($jobId: BigInt!) {
  jobs(first: 1, where: { jobId: $jobId }) {
    ...JobSummary
  }
}
    ${JobSummaryFragmentDoc}`;

export type SdkFunctionWrapper = <T>(action: (requestHeaders?:Record<string, string>) => Promise<T>, operationName: string, operationType?: string, variables?: any) => Promise<T>;


const defaultWrapper: SdkFunctionWrapper = (action, _operationName, _operationType, _variables) => action();

export function getSdk(client: GraphQLClient, withWrapper: SdkFunctionWrapper = defaultWrapper) {
  return {
    ListJobs(variables?: ListJobsQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ListJobsQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ListJobsQuery>({ document: ListJobsDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'ListJobs', 'query', variables);
    },
    GetJob(variables: GetJobQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<GetJobQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<GetJobQuery>({ document: GetJobDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'GetJob', 'query', variables);
    }
  };
}
export type Sdk = ReturnType<typeof getSdk>;