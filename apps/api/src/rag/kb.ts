import type { KbSource } from '@leadpilot/shared';
import { toVector, withTransaction, type Db } from '../db/pool.js';
import type { EmbeddingProvider } from '../llm/types.js';
import { chunkText } from './chunker.js';

export class KnowledgeBase {
  constructor(
    private readonly db: Db,
    private readonly embeddings: EmbeddingProvider,
  ) {}

  async addDocument(tenantId: string, title: string, content: string): Promise<{ id: string; chunks: number }> {
    const chunks = chunkText(content);
    // Prefix the title so short chunks keep their topic.
    const vectors = await this.embeddings.embed(chunks.map((c) => `${title}. ${c}`));
    return withTransaction(this.db, async (tx) => {
      const doc = await tx.query<{ id: string }>('INSERT INTO kb_documents (tenant_id, title) VALUES ($1, $2) RETURNING id', [tenantId, title]);
      const docId = doc.rows[0]!.id;
      for (const [i, chunk] of chunks.entries()) {
        await tx.query('INSERT INTO kb_chunks (tenant_id, document_id, ordinal, content, embedding) VALUES ($1, $2, $3, $4, $5)', [
          tenantId,
          docId,
          i,
          chunk,
          toVector(vectors[i]!),
        ]);
      }
      return { id: docId, chunks: chunks.length };
    });
  }

  async listDocuments(tenantId: string) {
    const res = await this.db.query<{ id: string; title: string; chunks: number; created_at: Date }>(
      `SELECT d.id, d.title, count(c.id)::int AS chunks, d.created_at
         FROM kb_documents d LEFT JOIN kb_chunks c ON c.document_id = d.id
        WHERE d.tenant_id = $1 GROUP BY d.id ORDER BY d.created_at DESC`,
      [tenantId],
    );
    return res.rows.map((r) => ({ id: r.id, title: r.title, chunks: r.chunks, createdAt: r.created_at.toISOString() }));
  }

  async deleteDocument(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM kb_documents WHERE tenant_id = $1 AND id = $2', [tenantId, id]);
    return (res.rowCount ?? 0) > 0;
  }

  /** Cosine-similarity search over the tenant's chunks (pgvector HNSW index). */
  async search(tenantId: string, query: string, topK: number, minScore: number): Promise<KbSource[]> {
    const [vector] = await this.embeddings.embed([query]);
    const res = await this.db.query<{ chunk_id: string; title: string; content: string; score: number }>(
      `SELECT c.id AS chunk_id, d.title, c.content, 1 - (c.embedding <=> $2::vector) AS score
         FROM kb_chunks c JOIN kb_documents d ON d.id = c.document_id
        WHERE c.tenant_id = $1
        ORDER BY c.embedding <=> $2::vector
        LIMIT $3`,
      [tenantId, toVector(vector!), topK],
    );
    return res.rows
      .filter((r) => r.score >= minScore)
      .map((r, i) => ({ id: i + 1, chunkId: r.chunk_id, title: r.title, content: r.content, score: Number(Number(r.score).toFixed(4)) }));
  }
}
