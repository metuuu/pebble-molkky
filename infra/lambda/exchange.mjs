// =============================================================================
// GitHub OAuth code -> token exchange. The ONLY backend Mölkky needs: the watch's
// settings page (a static GitHub Pages site) can't do this step itself, because
// it can't hold the client secret and GitHub's token endpoint sends no CORS
// headers. This Lambda holds the secret, makes the server-to-server call, and
// hands the access token back to the page.
//
// Stateless. No data is stored or logged here — the token is returned to the
// caller and never persisted. All gist read/write happens later in PKJS.
//
// Env:
//   GITHUB_CLIENT_ID          the OAuth app's public client id
//   GITHUB_CLIENT_SECRET_PARAM  SSM SecureString param name holding the secret
//   ALLOW_ORIGIN              CORS origin to allow (the GitHub Pages site)
// =============================================================================

import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});
let cachedSecret = null;                 // survives warm invocations

async function clientSecret() {
  if (cachedSecret) return cachedSecret;
  const out = await ssm.send(new GetParameterCommand({
    Name: process.env.GITHUB_CLIENT_SECRET_PARAM,
    WithDecryption: true,
  }));
  cachedSecret = out.Parameter.Value;
  return cachedSecret;
}

function cors() {
  return {
    'Access-Control-Allow-Origin': process.env.ALLOW_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function reply(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json', ...cors() }, body: JSON.stringify(body) };
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors(), body: '' };
  if (method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  let code, redirectUri;
  try {
    const b = JSON.parse(event.body || '{}');
    code = b.code;
    redirectUri = b.redirect_uri;        // optional; GitHub validates it against the app config
  } catch {
    return reply(400, { error: 'bad_json' });
  }
  if (!code) return reply(400, { error: 'missing_code' });

  let secret;
  try { secret = await clientSecret(); }
  catch { return reply(500, { error: 'secret_unavailable' }); }

  const params = {
    client_id: process.env.GITHUB_CLIENT_ID,
    client_secret: secret,
    code,
  };
  if (redirectUri) params.redirect_uri = redirectUri;

  let data;
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(params),
    });
    data = await res.json();
  } catch {
    return reply(502, { error: 'github_unreachable' });
  }

  // GitHub returns { error, error_description } on failure, or { access_token, scope, token_type }.
  if (data.error) return reply(400, { error: data.error, error_description: data.error_description });
  if (!data.access_token) return reply(400, { error: 'no_token' });

  // Return only the token + granted scope — never echo the code or secret.
  return reply(200, { access_token: data.access_token, scope: data.scope });
};
