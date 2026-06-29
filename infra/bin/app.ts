#!/usr/bin/env node
import 'source-map-support/register';
import 'dotenv/config';                  // loads infra/.env (gitignored) into process.env
import * as cdk from 'aws-cdk-lib';
import { OAuthStack } from '../lib/oauth-stack';

// Config comes from the gitignored .env file (see .env.example), with CDK context
// (`-c key=value`) as an override. The client SECRET is never read here — it lives
// in SSM (pushed by `npm run put-secret`). Defaults match the GitHub Pages site.
const app = new cdk.App();

const githubClientId = app.node.tryGetContext('githubClientId') || process.env.GITHUB_CLIENT_ID;
const clientSecretParam = app.node.tryGetContext('clientSecretParam')
  || process.env.GITHUB_CLIENT_SECRET_PARAM || '/molkky/github-oauth-client-secret';
const allowOrigin = app.node.tryGetContext('allowOrigin')
  || process.env.ALLOW_ORIGIN || 'https://metuuu.github.io';

if (!githubClientId) {
  throw new Error('Set GITHUB_CLIENT_ID in infra/.env (copy .env.example) or pass `-c githubClientId=...`.');
}

new OAuthStack(app, 'MolkkyGithubOAuth', {
  githubClientId,
  clientSecretParam,
  allowOrigin,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
