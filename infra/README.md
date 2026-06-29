# Mölkky cloud-backup infrastructure (AWS)

One AWS Lambda (behind a Function URL) that performs the GitHub OAuth
**code → access-token** exchange for the Mölkky settings page. That exchange is
the only step the static GitHub Pages settings page can't do itself — it can't
hold the client secret, and GitHub's token endpoint sends no CORS headers.

Everything else (reading/writing the backup gist) happens in the watch's
PebbleKit JS, not here. This stack is stateless and stores no user data.

```
infra/
  bin/app.ts          CDK app entry — reads config from .env
  lib/oauth-stack.ts  the stack: one Lambda + Function URL
  lambda/exchange.mjs  the handler (code -> token)
  scripts/put-secret.mjs  pushes the client secret from .env into SSM
  .env.example        copy to .env (gitignored) and fill in
```

## Prerequisites
- Node.js 18+ and the AWS CLI configured (`aws configure`, or an `AWS_PROFILE`).
- An AWS account you can deploy to.

## Secrets & config: the `.env` file
All deploy config lives in **`infra/.env`**, which is **gitignored** (this is a
public repo — never commit real values). Start from the template:

```sh
cd infra
cp .env.example .env       # then edit .env with your values
npm install
```

`.env` holds your GitHub OAuth **client id** (not sensitive, kept here so nothing
is hardcoded) and **client secret** (sensitive). The secret is never baked into
the deployed template — `npm run put-secret` stores it in AWS SSM as a
SecureString, and the Lambda reads it from there at runtime.

## One-time setup

### 1. Register a GitHub OAuth App
GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App.
- **Homepage URL:** `https://metuuu.github.io/pebble-molkky/`
- **Authorization callback URL:** `https://metuuu.github.io/pebble-molkky/config.html`

Copy the **Client ID** and generate a **Client secret** into `infra/.env`.
(The `gist` scope is requested by the page at sign-in, not configured here.)

### 2. Store the secret in SSM
```sh
npm run put-secret         # reads GITHUB_CLIENT_SECRET from .env -> AWS SSM
```

### 3. Deploy
```sh
npx cdk bootstrap          # first time in this account/region only
npm run deploy             # reads GITHUB_CLIENT_ID etc. from .env
```
CDK prints **`MolkkyGithubOAuth.ExchangeUrl`** — the Function URL.

### 4. Wire the page
In `docs/config.html`, fill the `CONFIG` block near the top of the `<script>`:
```js
var CONFIG = {
  clientId:    'YOUR_CLIENT_ID',
  exchangeUrl: 'https://....lambda-url.<region>.on.aws/'
};
```
Commit and push; GitHub Pages already serves `docs/`.

## Everyday commands
```sh
npm run diff     # preview changes before deploying
npm run synth    # render the CloudFormation template locally
npm run deploy   # deploy
npx cdk destroy  # tear it all down
```
Rotate the secret anytime: edit `.env`, `npm run put-secret` (the next Lambda
cold start picks it up). To change the client id or CORS origin, edit `.env` and
`npm run deploy`.

## Notes
- `ALLOW_ORIGIN` (in `.env`) is the CORS origin allowed to call the Function URL;
  defaults to `https://metuuu.github.io`.
- The Lambda returns only `{ access_token, scope }` — it never logs or echoes the
  code or the secret.
- Cost is effectively zero: a couple of invocations per user sign-in.
