
// Storage service with Cosmos DB support and local fallback
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

const DATA_DIR = path.resolve(__dirname, "../../data");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// Cosmos DB client (lazy loaded)
let cosmosClient: any = null;
let cosmosContainer: any = null;

async function getCosmosContainer() {
  if (cosmosContainer) return cosmosContainer;
  
  const cosmosEndpoint = process.env.COSMOS_ENDPOINT;
  const cosmosDatabase = process.env.COSMOS_DATABASE || "speech-quiz-db";
  const containerName = process.env.COSMOS_CONTAINER || "sessions";
  
  if (!cosmosEndpoint) return null;
  
  try {
    const { CosmosClient } = await import("@azure/cosmos");
    const { DefaultAzureCredential } = await import("@azure/identity");
    
    const credential = new DefaultAzureCredential();
    cosmosClient = new CosmosClient({ endpoint: cosmosEndpoint, aadCredentials: credential });
    const database = cosmosClient.database(cosmosDatabase);
    cosmosContainer = database.container(containerName);
    
    console.log("Cosmos DB connected successfully");
    return cosmosContainer;
  } catch (err) {
    console.warn("Cosmos DB not available, using local storage:", err);
    return null;
  }
}

export async function saveSession(item: any) {
  const id = item.sessionId || `s-${Date.now()}`;
  const doc = { id, ...item, timestamp: item.timestamp || new Date().toISOString() };
  
  // Try Cosmos DB first
  const container = await getCosmosContainer();
  if (container) {
    try {
      const { resource } = await container.items.create(doc);
      console.log("Session saved to Cosmos DB:", id);
      return resource;
    } catch (err) {
      console.error("Failed to save to Cosmos DB:", err);
      // Fall through to local storage
    }
  }
  
  // Fallback to local file storage
  let sessions: any[] = [];
  try {
    if (existsSync(SESSIONS_FILE)) {
      sessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8") || "[]");
    }
  } catch {
    sessions = [];
  }
  sessions.push(doc);
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), "utf8");
  console.log("Session saved to local file:", id);
  return doc;
}

export async function getAllSessions() {
  // Try Cosmos DB first
  const container = await getCosmosContainer();
  if (container) {
    try {
      const { resources } = await container.items.readAll().fetchAll();
      console.log(`Retrieved ${resources.length} sessions from Cosmos DB`);
      return resources;
    } catch (err) {
      console.error("Failed to read from Cosmos DB:", err);
    }
  }
  
  // Fallback to local file storage
  try {
    if (existsSync(SESSIONS_FILE)) {
      const sessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8") || "[]");
      console.log(`Retrieved ${sessions.length} sessions from local file`);
      return sessions;
    }
  } catch (err) {
    console.error("Failed to read local sessions:", err);
  }
  
  return [];
}

export async function saveAudioToBlob(filename: string, buffer: Buffer) {
  const storageAccountName = process.env.STORAGE_ACCOUNT_NAME;
  
  if (!storageAccountName) {
    console.warn("Blob storage not configured");
    return null;
  }
  
  try {
    const { BlobServiceClient } = await import("@azure/storage-blob");
    const { DefaultAzureCredential } = await import("@azure/identity");
    
    const credential = new DefaultAzureCredential();
    const blobServiceClient = new BlobServiceClient(
      `https://${storageAccountName}.blob.core.windows.net`,
      credential
    );
    
    const containerClient = blobServiceClient.getContainerClient("audio-recordings");
    const blockBlobClient = containerClient.getBlockBlobClient(filename);
    
    await blockBlobClient.upload(buffer, buffer.length);
    console.log("Audio saved to blob storage:", filename);
    return blockBlobClient.url;
  } catch (err) {
    console.error("Failed to save to blob storage:", err);
    return null;
  }
}
