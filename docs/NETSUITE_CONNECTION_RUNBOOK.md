# NetSuite Connection Runbook (Mission Control)

## 1) Security + Access Setup
1. Rotate any password that appeared in chat/screenshot.
2. Use a dedicated integration user (or dedicated admin seat during setup only).
3. Enforce MFA/2FA for UI login users.
4. Use least privilege for integration role.

## 2) NetSuite Feature Flags
In NetSuite, enable:
1. `Setup > Company > Enable Features > SuiteCloud`
2. `SuiteTalk (Web Services)`
3. `REST Web Services`
4. `Token-based Authentication`

## 3) Integration Record + Tokens
1. Create integration record: `Setup > Integrations > Manage Integrations > New`
2. Ensure TBA is enabled on the integration.
3. Capture:
   - `Consumer Key`
   - `Consumer Secret`
4. For integration user + role, create access token and capture:
   - `Token ID`
   - `Token Secret`
5. Capture `Account ID` (realm) from `Setup > Company > Company Information`.

## 4) Environment Variables
Add to runtime secrets (not committed):
1. `NETSUITE_ACCOUNT_ID`
2. `NETSUITE_CONSUMER_KEY`
3. `NETSUITE_CONSUMER_SECRET`
4. `NETSUITE_TOKEN_ID`
5. `NETSUITE_TOKEN_SECRET`

Optional:
1. `NETSUITE_REALM` (defaults to account id)
2. `NETSUITE_BASE_URL` (defaults to `https://<account>.restlets.api.netsuite.com`)
3. `NETSUITE_RESTLET_PATH` (defaults to `/app/site/hosting/restlet.nl`)
4. `NETSUITE_DISCOVERY_SCRIPT_ID` (defaults to `2757`)
5. `NETSUITE_DISCOVERY_DEPLOY_ID` (defaults to `1`)
6. `NETSUITE_TIME_ENTRY_SCRIPT_ID` (defaults to `2758`)
7. `NETSUITE_TIME_ENTRY_DEPLOY_ID` (defaults to `1`)
8. `NETSUITE_SYNC_TOKEN` (recommended to protect sync `POST`s)

## 5) Mission Control Connector (Implemented)
Implemented in this repo:
1. OAuth 1.0a (HMAC-SHA256) signer in `src/lib/netsuite.ts`
2. Health endpoint in `src/app/api/integrations/netsuite/health/route.ts`
3. Discovery proxy endpoint in `src/app/api/integrations/netsuite/discovery/route.ts`
4. Time entry proxy endpoint in `src/app/api/integrations/netsuite/time-entries/route.ts`
5. Consultant sync endpoint in `src/app/api/integrations/netsuite/consultants/sync/route.ts`

## 6) Smoke Test
With app running:
1. `GET /api/integrations/netsuite/health`
2. Success criteria:
   - HTTP `200`
   - Response `{ ok: true }`
   - Both `discovery.ok` and `timeEntries.ok` are `true`
3. Failure responses:
   - `400` missing env vars
   - `401/403` auth/role issue
   - `404` wrong domain/path

Discovery smoke test:
1. `GET /api/integrations/netsuite/discovery?action=listEmployees&limit=1`
2. `GET /api/integrations/netsuite/discovery?action=listProjects&limit=1`
3. `GET /api/integrations/netsuite/discovery?action=listServiceItems&limit=1`

Time entry smoke test:
1. `GET /api/integrations/netsuite/time-entries?action=searchTimeEntries&dateFrom=2100-01-01&dateTo=2100-01-01&limit=1`
2. If you plan to write through Mission Control, test `POST /api/integrations/netsuite/time-entries` with a safe disposable `externalId`

Consultant sync:
1. `GET /api/integrations/netsuite/consultants/sync`
2. Confirm `missing` is empty and the preview endpoint points at the Discovery RESTlet.
3. `POST /api/integrations/netsuite/consultants/sync` with `{ "dryRun": true }`
4. Success criteria:
   - HTTP `200`
   - `ok: true`
   - non-zero `fetched` if the source has consultant data
5. When ready, run the same endpoint without `dryRun` to upsert consultants into Mission Control.

## 7) Troubleshooting
1. `401 INVALID_LOGIN_ATTEMPT`:
   - Wrong keys/tokens or role restrictions.
2. `403 INSUFFICIENT_PERMISSION`:
   - Role missing record/web services permissions.
3. `404`:
   - Wrong account domain or path.
4. Signature mismatch:
   - Confirm account/realm and token pair are from same account.
5. RESTlet request succeeds in code but NetSuite returns a business error envelope:
   - Check `code` and `error` in the JSON body (`MISSING_PARAMS`, `VALIDATION_FAILED`, `RECORD_NOT_FOUND`, etc.).
6. Deployment still in `TESTING`:
   - Change both RESTlet deployments to `RELEASED` before production traffic.

## 8) Production Hardening
1. Store secrets in vault/secret manager.
2. Rotate tokens regularly.
3. Add structured logging for status and response code only (never secrets).
4. Add integration health monitoring alert on repeated non-200 responses.
