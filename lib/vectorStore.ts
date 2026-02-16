import { Chroma } from "@langchain/community/vectorstores/chroma";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { Document } from "@langchain/core/documents";

const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
const COLLECTION_NAME = "extracted_docs";

let embeddingsInstance: GoogleGenerativeAIEmbeddings | null = null;

function getEmbeddings() {
  if (!embeddingsInstance) {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY is missing from .env");

    embeddingsInstance = new GoogleGenerativeAIEmbeddings({
      apiKey: apiKey,
      // Switched to embedding-001 for better v1beta compatibility
      model: "embedding-001", 
    });
  }
  return embeddingsInstance;
}

export async function getVectorStore() {
  const embeddings = getEmbeddings();

  try {
    // We pass the embeddings instance directly here to resolve the 
    // "No embedding function configuration found" warning.
    return await Chroma.fromExistingCollection(embeddings, {
      collectionName: COLLECTION_NAME,
      url: CHROMA_URL,
    });
  } catch (error) {
    console.log("Collection not found. Initializing new collection...");
    // Create the collection properly with the embedding function mapped
    return await Chroma.fromDocuments([], embeddings, {
      collectionName: COLLECTION_NAME,
      url: CHROMA_URL,
    });
  }
}

export async function addDocuments(docs: Document[]) {
  const store = await getVectorStore();
  await store.addDocuments(docs);
}

export async function searchSimilar(query: string, k: number = 5) {
  const store = await getVectorStore();
  // Ensure the search also uses the embedding function
  return await store.similaritySearch(query, k);
}