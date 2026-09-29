/** Internal type. DO NOT USE DIRECTLY. */
type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
/** Internal type. DO NOT USE DIRECTLY. */
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
import { GraphQLClient, type RequestOptions } from 'graphql-request';
import gql from 'graphql-tag';
type GraphQLClientRequestHeaders = RequestOptions['requestHeaders'];
export type AgentServiceAttributeType =
  | 'BOOLEAN'
  | 'JSON'
  | 'NUMBER'
  | 'STRING';

export type AgentServiceFeatureKind =
  | 'A2A_SKILL'
  | 'CAPABILITY'
  | 'CUSTOM'
  | 'MCP_PROMPT'
  | 'MCP_RESOURCE'
  | 'MCP_TOOL'
  | 'OASF_DOMAIN'
  | 'OASF_SKILL';

export type AgentServiceKind =
  | 'A2A'
  | 'AGENT_WALLET'
  | 'CUSTOM'
  | 'DID'
  | 'EMAIL'
  | 'ENS'
  | 'MCP'
  | 'OASF'
  | 'WEB';

export type AgentSummaryFragment = { agentURI: string, createdAt: string, createdAtTransaction: string, id: string, feedbackCount: string, owner: { address: string } | null, profile:
    | { name: string | null, description: string | null, image: string | null }
    | { name: string | null, description: string | null, image: string | null }
   | null, metadata: Array<{ key: string, value: string }> };

export type GetAgentQueryVariables = Exact<{
  id: string;
}>;


export type GetAgentQuery = { agents: Array<{ agentURI: string, createdAt: string, createdAtTransaction: string, id: string, feedbackCount: string, owner: { address: string } | null, profile:
      | { name: string | null, description: string | null, image: string | null }
      | { name: string | null, description: string | null, image: string | null }
     | null, metadata: Array<{ key: string, value: string }> }> };

export type ListAgentsQueryVariables = Exact<{
  first?: number | null | undefined;
  skip?: number | null | undefined;
  owner?: string | null | undefined;
}>;


export type ListAgentsQuery = { agents: Array<{ agentURI: string, createdAt: string, createdAtTransaction: string, id: string, feedbackCount: string, owner: { address: string } | null, profile:
      | { name: string | null, description: string | null, image: string | null }
      | { name: string | null, description: string | null, image: string | null }
     | null, metadata: Array<{ key: string, value: string }> }> };

export type SearchAgentProfilesQueryVariables = Exact<{
  text: string;
  first?: number | null | undefined;
  skip?: number | null | undefined;
  owner?: string | null | undefined;
}>;


export type SearchAgentProfilesQuery = { agentProfileSearch: Array<{ agent: { agentURI: string, createdAt: string, createdAtTransaction: string, id: string, feedbackCount: string, owner: { address: string } | null, profile:
        | { name: string | null, description: string | null, image: string | null }
        | { name: string | null, description: string | null, image: string | null }
       | null, metadata: Array<{ key: string, value: string }> } }> };

export type GetAgentServicesQueryVariables = Exact<{
  id: string;
}>;


export type GetAgentServicesQuery = { agents: Array<{ registration:
      | { services: Array<{ id: string, name: string, kind: AgentServiceKind, endpoint: string, version: string | null, features: Array<{ kind: AgentServiceFeatureKind, value: string }>, attributes: Array<{ key: string, value: string, valueType: AgentServiceAttributeType }> }> }
      | Record<PropertyKey, never>
     | null }> };

export type GetAgentFeedbacksQueryVariables = Exact<{
  id: string;
  first?: number | null | undefined;
  skip?: number | null | undefined;
}>;


export type GetAgentFeedbacksQuery = { agents: Array<{ feedback: Array<{ id: string, value: string, valueDecimals: number, tag1: string, tag2: string, feedbackURI: string, createdAt: string, createdAtTransaction: string, client: { address: string } }> }> };

export const AgentSummaryFragmentDoc = gql`
    fragment AgentSummary on Agent {
  id: agentId
  owner {
    address: id
  }
  profile: registration {
    name
    description
    image
  }
  metadata {
    key
    value
  }
  agentURI
  feedbackCount: activeFeedbackCount
  createdAt
  createdAtTransaction
}
    `;
export const GetAgentDocument = gql`
    query GetAgent($id: Bytes!) {
  agents(first: 1, where: { id: $id, registration_not: null, agentURIKind: DATA }) {
    ...AgentSummary
  }
}
    ${AgentSummaryFragmentDoc}`;
export const ListAgentsDocument = gql`
    query ListAgents($first: Int, $skip: Int, $owner: String) {
  agents(
    first: $first
    skip: $skip
    orderBy: agentId
    orderDirection: asc
    where: { registration_not: null, agentURIKind: DATA, owner: $owner }
  ) {
    ...AgentSummary
  }
}
    ${AgentSummaryFragmentDoc}`;
export const SearchAgentProfilesDocument = gql`
    query SearchAgentProfiles($text: String!, $first: Int, $skip: Int, $owner: String) {
  agentProfileSearch(
    text: $text
    first: $first
    skip: $skip
    where: { agent_: { agentURIKind: DATA, owner: $owner } }
  ) {
    agent {
      ...AgentSummary
    }
  }
}
    ${AgentSummaryFragmentDoc}`;
export const GetAgentServicesDocument = gql`
    query GetAgentServices($id: Bytes!) {
  agents(first: 1, where: { id: $id, registration_not: null, agentURIKind: DATA }) {
    registration {
      ... on AgentRegistration {
        services(orderBy: position, orderDirection: asc) {
          id
          name
          kind
          endpoint
          version
          features(orderBy: position, orderDirection: asc) {
            kind
            value
          }
          attributes(orderBy: position, orderDirection: asc) {
            key
            value
            valueType
          }
        }
      }
    }
  }
}
    `;
export const GetAgentFeedbacksDocument = gql`
    query GetAgentFeedbacks($id: Bytes!, $first: Int, $skip: Int) {
  agents(first: 1, where: { id: $id, registration_not: null, agentURIKind: DATA }) {
    feedback(
      first: $first
      skip: $skip
      orderBy: createdAt
      orderDirection: desc
      where: { isRevoked: false }
    ) {
      id
      client {
        address: id
      }
      value
      valueDecimals
      tag1
      tag2
      feedbackURI
      createdAt
      createdAtTransaction
    }
  }
}
    `;

export type SdkFunctionWrapper = <T>(action: (requestHeaders?:Record<string, string>) => Promise<T>, operationName: string, operationType?: string, variables?: any) => Promise<T>;


const defaultWrapper: SdkFunctionWrapper = (action, _operationName, _operationType, _variables) => action();

export function getSdk(client: GraphQLClient, withWrapper: SdkFunctionWrapper = defaultWrapper) {
  return {
    GetAgent(variables: GetAgentQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<GetAgentQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<GetAgentQuery>({ document: GetAgentDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'GetAgent', 'query', variables);
    },
    ListAgents(variables?: ListAgentsQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<ListAgentsQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<ListAgentsQuery>({ document: ListAgentsDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'ListAgents', 'query', variables);
    },
    SearchAgentProfiles(variables: SearchAgentProfilesQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<SearchAgentProfilesQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<SearchAgentProfilesQuery>({ document: SearchAgentProfilesDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'SearchAgentProfiles', 'query', variables);
    },
    GetAgentServices(variables: GetAgentServicesQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<GetAgentServicesQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<GetAgentServicesQuery>({ document: GetAgentServicesDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'GetAgentServices', 'query', variables);
    },
    GetAgentFeedbacks(variables: GetAgentFeedbacksQueryVariables, requestHeaders?: GraphQLClientRequestHeaders, signal?: RequestInit['signal']): Promise<GetAgentFeedbacksQuery> {
      return withWrapper((wrappedRequestHeaders) => client.request<GetAgentFeedbacksQuery>({ document: GetAgentFeedbacksDocument, variables, requestHeaders: { ...requestHeaders, ...wrappedRequestHeaders }, signal }), 'GetAgentFeedbacks', 'query', variables);
    }
  };
}
export type Sdk = ReturnType<typeof getSdk>;