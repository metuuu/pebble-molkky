#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { OAuthStack } from '../lib/oauth-stack';

// Config comes from CDK context (cdk.json or `-c key=value`), so nothing
// deploy-specific is hardcoded. The client SECRET is never here — it lives in
// SSM (see README). Defaults match the project's GitHub Pages site.
const app = new cdk.App();

const githubClientId = app.node.tryGetContext('githubClientId') || process.env.GITHUB_CLIENT_ID;
const clientSecretParam = app.node.tryGetContext('clientSecretParam') || '/molkky/github-oauth-client-secret';
const allowOrigin = app.node.tryGetContext('allowOrigin') || 'https://metuuu.github.io';

if (!githubClientId) {
  throw new Error('Set githubClientId via `cdk deploy -c githubClientId=...` or the GITHUB_CLIENT_ID env var.');
}

new OAuthStack(app, 'MolkkyGithubOAuth', {
  githubClientId,
  clientSecretParam,
  allowOrigin,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
