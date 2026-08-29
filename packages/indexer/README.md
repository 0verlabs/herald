# @hrld/indexer

Goldsky subgraphs and pipelines that index onchain events for Herald and forward them to the Herald webhook. Each registry gets its own subgraph and pipeline under `subgraphs/` and `pipelines/`. The current set is `identity-registry` and `reputation-registry`.

## Prerequisites

Run `bunx goldsky login` once per machine. See the `auth-setup` skill if login fails.

All commands below run from `packages/indexer`.

## Deploying a standard

Deploying one standard is three steps: deploy the subgraph, create or update the webhook secret it needs, then create the pipeline that reads from it. Do these in order. The pipeline references the subgraph by name, and the sink references the secret by name, so both have to exist first.

The examples below show both current standards, `identity-registry` and `reputation-registry`.

### 1. Deploy the subgraph

```sh
bunx goldsky subgraph deploy 'identity-registry/1.0.0' \
  --from-abi subgraphs/identity-registry/1.0.0/identity-registry-subgraph.json

bunx goldsky subgraph deploy 'reputation-registry/1.0.0' \
  --from-abi subgraphs/reputation-registry/1.0.0/reputation-registry-subgraph.json
```

The subgraph name and version come from the manifest's `name` field, not the folder path. Bump the version folder (`1.0.0` -> `1.1.0`) and the manifest's `version` field together when the contract address, ABI, or start block changes.

`pipelines/identity-registry-events.yaml` currently references the source subgraph as `identity-registry-0g`, which doesn't match the deployed name `identity-registry/1.0.0`. Confirm the deployed subgraph's name against `bunx goldsky subgraph list` before creating the pipeline, and fix the `sources` block in the YAML if it's wrong. `pipelines/reputation-registry-events.yaml` doesn't have this problem. It points at `reputation-registry` version `1.0.0`, which matches its deployed name.

### 2. Create or update the webhook secret

Pipelines authenticate to the Herald webhook with a shared secret. Create it once per environment:

```sh
bunx goldsky secret create \
  --name GOLDSKY_WEBHOOK_SECRET \
  --description "Herald webhook auth for <standard> pipelines" \
  --value '{"type": "httpauth", "secretKey": "Authorization", "secretValue": "Bearer <SECRET>"}'
```

`goldsky secret create` fails if `GOLDSKY_WEBHOOK_SECRET` already exists. Rotate the value with:

```sh
bunx goldsky secret update GOLDSKY_WEBHOOK_SECRET \
  --value '{"type": "httpauth", "secretKey": "Authorization", "secretValue": "Bearer <NEW_SECRET>"}'
```

Every pipeline in this package shares the same secret name. Updating it rotates auth for all of them at once.

### 3. Create the pipeline

```sh
bunx goldsky pipeline create identity-registry-events \
  --definition-path pipelines/identity-registry-events.yaml

bunx goldsky pipeline create reputation-registry-events \
  --definition-path pipelines/reputation-registry-events.yaml
```

The pipeline name is arbitrary and separate from the subgraph name; `pipeline create` reads the actual source subgraph from the `sources` block inside the YAML. If you change that YAML after the pipeline exists, redeploy with:

```sh
bunx goldsky pipeline update identity-registry-events \
  --definition-path pipelines/identity-registry-events.yaml

bunx goldsky pipeline update reputation-registry-events \
  --definition-path pipelines/reputation-registry-events.yaml
```

## Adding a new standard

1. Add `subgraphs/<standard>/<version>/` with the ABI and subgraph manifest. `subgraphs/identity-registry/1.0.0` and `subgraphs/reputation-registry/1.0.0` are working templates.
2. Add `pipelines/<standard>-events.yaml`, pointing its `sources` at the subgraph name from step 1 and its `sinks` at `GOLDSKY_WEBHOOK_SECRET`.
3. Run the three steps above for the new subgraph and pipeline. Skip step 2 if `GOLDSKY_WEBHOOK_SECRET` already exists.
