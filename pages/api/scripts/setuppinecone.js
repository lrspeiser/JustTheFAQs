import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Initialize Pinecone
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

// Define a valid index name
const indexName = "faq-embeddings"; // ✅ Use hyphen instead of underscore

async function createIndex() {
  try {
    console.log(`[Pinecone] Creating index "${indexName}"...`);

    await pc.createIndex({
      name: indexName,
      dimension: 1536, // Must match OpenAI embeddings (text-embedding-3-small uses 1536)
      metric: "cosine",
      spec: { 
        serverless: { 
          cloud: "aws", 
          region: "us-east-1" // Change if needed
        }
      }
    });

    console.log(`[Pinecone] ✅ Index "${indexName}" created successfully!`);
  } catch (error) {
    console.error(`[Pinecone] ❌ Error creating index:`, error.message);
  }
}

// Run the function
createIndex();
