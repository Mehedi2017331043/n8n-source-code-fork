# Phase 0 discovery: automation platform

Status: draft. Source: `plan.md` §11, Phase 0.

This document records facts found in the repository. Each fact cites its
file. Items marked **open** need a running instance, a decision, or an
outside team.

## 1. Version baseline

| Item | Value | Source |
|---|---|---|
| Upstream base | n8n `2.49.0` on `master` | `packages/cli/package.json` |
| Pinned tag | Not set. `master` is not a release tag. | **open** |
| Node.js | `>=24.0.0` | `package.json` `engines` |
| pnpm | `12.4.2` | `package.json` `packageManager` |

**Action (open):** Pin the fork to a release tag or a commit. Plan §9.1
requires a pinned base.

## 2. Edition check (CE vs `.ee`)

Plan §10 says not to copy Enterprise-only code into the fork. The
repository holds `.ee` files. These are the files that matter for this
project:

| Area | Files | Edition |
|---|---|---|
| SAML SSO | `packages/cli/src/modules/sso-saml/saml.controller.ee.ts`, `saml.service.ee.ts` | `.ee` |
| OIDC SSO | `packages/cli/src/modules/sso-oidc/oidc.controller.ee.ts`, `oidc.service.ee.ts` | `.ee` |
| Roles and scopes | `packages/@n8n/permissions/src/schemas.ee.ts`, `roles/role-maps.ee.ts`, `roles/scopes/global-scopes.ee.ts` | `.ee` |
| Project scope | `packages/cli/src/workflows/workflow.service.ee.ts` | `.ee` |

**Impact:**

- SSO (plan §4) cannot reuse n8n's SAML or OIDC modules. Use a custom
  integration in a non-`.ee` path.
- The role model that the plan needs (`global:member`) sits in `.ee`
  files. Legal must confirm that the fork may use these files. This is
  part of the legal review in plan §10. **Open.**

## 3. Public registration

- No public sign-up route exists. A search of `packages/cli/src` found
  no `/register` or `/signup` endpoint.
- Users join only by invitation. `POST /invitations` requires the
  `user:create` global scope
  (`packages/cli/src/controllers/invitation.controller.ts`).
- The `global:member` role does not hold `user:create`.

**Result:** Public registration is already closed in the code. No change
is needed for plan §4.4 provisioning.

## 4. Role scopes for `global:member`

Source: `packages/@n8n/permissions/src/roles/scopes/global-scopes.ee.ts`
(`GLOBAL_MEMBER_SCOPES`).

- The role holds no global `workflow:*`, `credential:*` or
  `execution:*` scopes. Access to those resources comes from project
  scope.
- The role holds `user:list`. Every member can list users. This exposes
  identity data to all members. **Review:** decide whether `user:list`
  is needed for the approved features.
- The role holds `variable:read`, `dataTable:list`,
  `credentialResolver:list`, `apiKey:create` and `apiKey:update`.
  **Review** each one against plan §5.2.

## 5. Community packages and node policy

| Setting | Default | Effect | Source |
|---|---|---|---|
| `N8N_COMMUNITY_PACKAGES_ENABLED` | `true` | `false` disables community packages | `packages/cli/src/modules/community-packages/community-packages.config.ts` |
| `N8N_DISABLED_MODULES=community-packages` | unset | Also sets `enabled` to `false` | same file, `sanitize()` |
| `N8N_UNVERIFIED_PACKAGES_ENABLED` | `true` | Controls unverified packages only | same file |
| `NODES_EXCLUDE` | excludes `executeCommand` and `localFileTrigger` | Blocks two nodes | `packages/@n8n/config/src/configs/nodes.config.ts` |

**Result:** Plan §6.1 "disable end-user community-node installation" can
be met with `N8N_COMMUNITY_PACKAGES_ENABLED=false`. This setting is a
deployment setting. It is not a code default.

**Gap fixed:** `installOrUpdatePackage` in
`packages/cli/src/modules/community-packages/community-packages.service.ts`
did not check `enabled`. Only the pubsub and payload paths checked it. A
direct install request therefore ran even when the flag was `false`. The
guard now runs first. A unit test covers the rejection.

## 6. Feature-to-module map

Plan §2 lists 11 retained capabilities.

| # | Capability | Main paths |
|---|---|---|
| 1 | Workflow editor and canvas | `packages/frontend/editor-ui` |
| 2 | Node management | `packages/nodes-base`, `packages/cli/src/modules/community-packages`, `packages/cli/src/controllers/node-types.controller.ts` |
| 3 | Workflow execution engine | `packages/core`, `packages/cli/src/workflow-runner.ts`, `packages/cli/src/active-executions.ts`, `packages/cli/src/modules/engine-v2` |
| 4 | Execution history | `packages/cli/src/executions`, `packages/cli/src/modules/redaction` |
| 5 | Webhooks | `packages/cli/src/webhooks` |
| 6 | Queue mode | `packages/cli/src/scaling` |
| 7 | Redis | `packages/@n8n/config/src/configs/redis.config.ts` |
| 8 | PostgreSQL | `packages/@n8n/db`, `packages/@n8n/config/src/configs/database.config.ts` |
| 9 | Credential encryption | `packages/core/src/encryption`, `packages/cli/src/modules/encryption-key-manager` |
| 10 | Expression engine | `packages/workflow/src/expression*.ts`, `packages/workflow/src/expressions` |
| 11 | Error handling and retries | `packages/cli/src/workflows/error-workflow-validation.service.ts`, `packages/cli/src/errors` |

Essential supporting modules (plan §2.1): users, auth, and project scope.
See `packages/cli/src/controllers/auth.controller.ts`,
`packages/cli/src/controllers/users.controller.ts`, and
`packages/cli/src/workflows/workflow.service.ts`.

## 6.1 Dependency checks (open)

Plan §9.3 requires the frontend routes, backend controllers, services,
entities, migrations, and tests for each feature that is proposed for
removal. This list is not done. It is needed before Phase 4 removes
anything.

## 7. Isolation spike (plan §11, Phase 0)

The spike checks whether one member can see another member's workflows,
credentials, or executions.

**Code evidence so far:**

- `packages/cli/src/workflows/workflow.service.ts` (around line 330)
  checks that the personal-project owner matches the caller, unless the
  caller has `workflow:read` at global scope.
- The `global:member` role does not hold global `workflow:read`. Members
  therefore reach workflows only through their own project.

**Test evidence:** `packages/cli/test/integration/workflows/cross-user-isolation.api.test.ts`
passes 11 of 11 on the current `master`. It covers ID substitution for
workflows (list, get, update, delete, run, share), credentials (get,
update, delete) and executions (get, delete). This is an integration
test with SQLite. It does not replace the live spike on the pinned tag
with PostgreSQL.

**Result:** **Partly open.** The integration suite passes. The live
two-user spike on the pinned tag and PostgreSQL is still open.

## 8. Items for humans

| Item | Owner | Status |
|---|---|---|
| Legal review of SUL and `.ee` files | Legal/compliance | Open |
| Release tag pin | Automation platform team | Open |
| Scope of `user:list` and member API keys | Automation platform + security | Open |
| Isolation spike go/no-go | Automation platform + security | Open |
