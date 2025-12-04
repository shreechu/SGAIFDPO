
const useVault = process.env.USE_KEY_VAULT === "true";
const vaultName = process.env.KEY_VAULT_NAME || "";

export async function getSecret(name: string): Promise<string> {
  if (!useVault) throw new Error("Key Vault usage disabled");
  if (!vaultName) throw new Error("KEY_VAULT_NAME not set");
  // Dynamically import Azure SDKs only when Key Vault is enabled to avoid
  // module-load errors during local development when those packages aren't installed.
  const { DefaultAzureCredential } = await import("@azure/identity");
  const { SecretClient } = await import("@azure/keyvault-secrets");
  const url = `https://${vaultName}.vault.azure.net`;
  const cred = new DefaultAzureCredential();
  const client = new SecretClient(url, cred);
  const sec = await client.getSecret(name);
  return sec.value || "";
}

// Helper to get all secrets from environment variables
export function getSecrets() {
  return {
    AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY || "",
    AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT || "",
    AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT || "",
    SPEECH_KEY: process.env.SPEECH_KEY || "",
    SPEECH_REGION: process.env.SPEECH_REGION || ""
  };
}
