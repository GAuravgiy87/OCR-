// lib/indexing.ts
import { Document } from "@langchain/core/documents";
import { addDocuments } from "./vectorStore";

export async function indexExtractedResults(pageResults: any[]) {
  const docs: Document[] = [];

  for (const result of pageResults) {
    const { pageNumber, tableData } = result;

    if (tableData.isTable && tableData.rows) {
      // Store each data row (skip the first header row)
      tableData.rows.forEach((row: string[], rowIndex: number) => {
        if (rowIndex === 0) return; // skip header
        const pageContent = row.join(" | ");
        docs.push(
          new Document({
            pageContent,
            metadata: {
              pageNumber,
              rowIndex,
              type: "table-row",
            },
          })
        );
      });
    } else if (tableData.text) {
      // For non‑table pages, store the full text as one document
      docs.push(
        new Document({
          pageContent: tableData.text,
          metadata: { pageNumber, type: "text" },
        })
      );
    }
  }

  if (docs.length > 0) {
    await addDocuments(docs);
    console.log(`✅ Indexed ${docs.length} documents from ${pageResults.length} page(s).`);
  } else {
    console.log("⚠️ No documents to index.");
  }
}