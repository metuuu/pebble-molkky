// Push the GitHub OAuth client secret from infra/.env into AWS SSM as a
// SecureString, so it never lives in source control or the CDK template. The
// Lambda reads it from SSM at runtime.
//
//   npm run put-secret
//
// Requires the AWS CLI configured (same creds you deploy with).

import 'dotenv/config';
import { execFileSync } from 'node:child_process';

const secret = process.env.GITHUB_CLIENT_SECRET;
const name = process.env.GITHUB_CLIENT_SECRET_PARAM || '/molkky/github-oauth-client-secret';

if (!secret) {
  console.error('GITHUB_CLIENT_SECRET is empty. Set it in infra/.env (copy .env.example) first.');
  process.exit(1);
}

const args = ['ssm', 'put-parameter', '--name', name, '--type', 'SecureString', '--value', secret, '--overwrite'];
if (process.env.AWS_REGION) args.push('--region', process.env.AWS_REGION);

try {
  execFileSync('aws', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  console.log(`Stored the client secret in SSM at ${name}.`);
} catch (e) {
  console.error('Failed to put the parameter. Is the AWS CLI installed and configured?');
  process.exit(1);
}
