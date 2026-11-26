import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const SECRET_NAME = process.env.SECRET_NAME || "revenue-gate/api-keys";
const client = new SecretsManagerClient({ region: process.env.AWS_REGION || "ap-southeast-1" });

export async function loadSecrets() {
  try {
    const result = await client.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }));
    const secrets = JSON.parse(result.SecretString);
    for (const [key, value] of Object.entries(secrets)) {
      if (!process.env[key]) process.env[key] = value;
    }
    console.log("Loaded secrets from AWS Secrets Manager");
    return true;
  } catch (err) {
    console.log("Secrets Manager not available, using .env:", err.message);
    return false;
  }
}
