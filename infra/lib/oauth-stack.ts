import * as path from 'path';
import { Stack, StackProps, CfnOutput, Duration } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';

// =============================================================================
// One Lambda (Function URL) that does the GitHub OAuth code->token exchange for
// Mölkky's settings page. Deliberately tiny: no API Gateway, no database, no VPC.
//
// The client secret is NOT in this template — it lives in an SSM SecureString
// parameter you create out-of-band (see infra/README.md), so the secret never
// touches source control or `cdk diff` output. The Lambda reads it at runtime.
// =============================================================================

export interface OAuthStackProps extends StackProps {
  /** The OAuth app's public client id. */
  githubClientId: string;
  /** Name of the SSM SecureString parameter holding the client secret. */
  clientSecretParam: string;
  /** Origin allowed to call the Function URL (your GitHub Pages site). */
  allowOrigin: string;
}

export class OAuthStack extends Stack {
  constructor(scope: Construct, id: string, props: OAuthStackProps) {
    super(scope, id, props);

    const fn = new lambda.Function(this, 'GithubOAuthExchange', {
      runtime: lambda.Runtime.NODEJS_20_X,          // global fetch + AWS SDK v3 preinstalled
      handler: 'exchange.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'lambda')),
      timeout: Duration.seconds(10),
      memorySize: 128,
      environment: {
        GITHUB_CLIENT_ID: props.githubClientId,
        GITHUB_CLIENT_SECRET_PARAM: props.clientSecretParam,
        ALLOW_ORIGIN: props.allowOrigin,
      },
    });

    // Let the function read (and decrypt) the secret parameter.
    const param = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'Secret', {
      parameterName: props.clientSecretParam,
    });
    param.grantRead(fn);

    const url = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,    // public endpoint; it only swaps a code for a token
      cors: {
        allowedOrigins: [props.allowOrigin],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ['Content-Type'],
      },
    });

    new CfnOutput(this, 'ExchangeUrl', {
      value: url.url,
      description: 'Paste this into docs/config.html CONFIG.exchangeUrl',
    });
  }
}
