# Mölkky cloud-backup infrastructure

One AWS Lambda (behind a Function URL) that performs the GitHub OAuth
**code → access-token** exchange for the Mölkky settings page. That exchange is
the only step the static GitHub Pages settings page can't do itself (it can't
hold the client secret, and GitHub's token endpoint sends no CORS headers).

Everything else — reading and writing the backup gist — happens in the watch's
PebbleKit JS, not here. This stack is stateless and stores nothing.

## One-time setup

### 1. Register a GitHub OAuth App
GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App.
- **Homepage URL:** `https://metuuu.github.io/pebble-molkky/`
- **Authorization callback URL:** `https://metuuu.github.io/pebble-molkky/config.html`
- After creating it, note the **Client ID** and generate a **Client secret**.

(The `gist` scope is requested at sign-in time by the page, not configured here.)

### 2. Store the client secret in SSM (never in source control)
```sh
aws ssm put-parameter \
  --name /molkky/github-oauth-client-secret \
  --type SecureString \
  --value 'YOUR_GITHUB_CLIENT_SECRET'
```

### 3. Deploy
```sh
cd infra
npm install
npx cdk bootstrap          # first time in this account/region only
npx cdk deploy -c githubClientId=YOUR_CLIENT_ID
```
CDK prints `MolkkyGithubOAuth.ExchangeUrl` — the Function URL.

### 4. Wire the page
Open `docs/config.html` and fill the `CONFIG` block near the top:
```js
var CONFIG = {
  clientId:    'YOUR_CLIENT_ID',
  exchangeUrl: 'https://....lambda-url.<region>.on.aws/'
};
```
Commit and push; GitHub Pages already serves `docs/`.

## Notes
- `allowOrigin` defaults to `https://metuuu.github.io` (CORS for the Function
  URL). Override with `-c allowOrigin=...` if you host the page elsewhere.
- The Lambda returns only `{ access_token, scope }`; it never logs or echoes the
  code or the secret.
- To rotate the secret: update the SSM parameter; the next cold start picks it up.
- Cost: effectively zero — a couple of invocations per user sign-in.
