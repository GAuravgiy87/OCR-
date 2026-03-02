# Advanced Table OCR Extractor

Extract tables from images and PDFs using AI-powered OCR. Features local LLM (Ollama) and vector search (Qdrant) for intelligent document processing.

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ (`node --version`)
- **Docker** (for Qdrant) – [Install Docker](https://docs.docker.com/get-docker/)
- **Ollama** – [Install Ollama](https://ollama.ai)

### Installation Steps

#### 1. Clone the repository
```bash
git clone https://github.com/GAuravgiy87/OCR-.git
cd OCR-
```

#### 2. Install dependencies
```bash
npm install
# If you encounter peer dependency errors, use:
npm install --legacy-peer-deps
```

#### 3. Start Qdrant (vector database)
```bash
docker run -d -p 6333:6333 --name qdrant qdrant/qdrant
# Verify it's running:
curl http://localhost:6333/collections   # Should return {"result":{"collections":[]}}
# Or open http://localhost:6333/dashboard in your browser
```

#### 4. Install Ollama models
Pull the required models:
```bash
ollama pull nomic-embed-text   # For embeddings
ollama pull qwen2.5:1.5b       # For chat assistant
# Verify installed models:
ollama list
```
Ollama serves models automatically on `http://localhost:11434`.

#### 5. Run the development server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

## ✅ Verification Checklist
- [ ] Qdrant running: `docker ps | grep qdrant`
- [ ] Ollama models loaded: `ollama list` shows both models
- [ ] App accessible: http://localhost:3000 loads without errors

## 📖 Usage
1. Upload an image or PDF containing tables.
2. Wait for OCR processing (automatic table detection).
3. Edit extracted data if needed.
4. Export as CSV or Excel.

## 🛠️ Troubleshooting
- **Port conflicts**: Ensure ports 3000 (Next.js), 6333 (Qdrant), and 11434 (Ollama) are free.
- **Ollama not responding**: Run `ollama serve` in a separate terminal.
- **Qdrant connection error**: Restart container: `docker restart qdrant`.

---

**Happy extracting!**
