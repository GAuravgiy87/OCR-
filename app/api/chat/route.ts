// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import { searchSimilar } from "@/lib/vectorStore";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();
    if (!query) {
      return NextResponse.json({ error: "No query provided" }, { status: 400 });
    }

    // 1. Retrieve relevant documents
    const relevantDocs = await searchSimilar(query, 5);
    const context = relevantDocs.map((doc) => doc.pageContent).join("\n\n");

    // 2. Build prompt
    const prompt = `
You are a helpful assistant that answers questions based on the provided context from a document.

Context:
${context}

Question: ${query}

Answer the question concisely based only on the context. If the context doesn't contain the answer, say "I couldn't find information about that in the document."
`;

    // 3. Generate answer with Gemini
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // or "gemini-pro"
    const result = await model.generateContent(prompt);
    const response = result.response.text();

    return NextResponse.json({
      answer: response,
      sources: relevantDocs.map((doc) => ({
        pageContent: doc.pageContent.substring(0, 200) + "...",
        metadata: doc.metadata,
      })),
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}