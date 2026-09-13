from __future__ import annotations

import hashlib, math, re
from collections import Counter
from datetime import datetime, timezone
from typing import Optional
from ..contracts import EvidenceChunk
from .chunking import structure_aware_chunk
from .reranker import Reranker, configured_reranker

STOP_WORDS = {
    "is", "are", "the", "a", "an", "and", "or", "to", "in", "for", "of", "with",
    "this", "that", "it", "at", "by", "from", "on", "as", "what", "which", "how",
    "be", "been", "being", "have", "has", "had", "do", "does", "did"
}

def _stem(w: str) -> str:
    w = w.lower()
    if w.startswith("exempt"): return "exempt"
    if w.startswith("require"): return "requir"
    if w.startswith("experienc"): return "experienc"
    if w.startswith("certif"): return "certif"
    for suff in ("tions", "tion", "ments", "ment", "ing", "ed", "es", "s"):
        if len(w) > len(suff) + 2 and w.endswith(suff):
            return w[:-len(suff)]
    return w

def _terms(text: str) -> Counter[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return Counter(_stem(w) for w in words if w not in STOP_WORDS)

def _score(a: Counter[str], b: Counter[str]) -> float:
    dot = sum(a[x] * b[x] for x in a.keys() & b.keys())
    return dot / math.sqrt(sum(x*x for x in a.values()) * sum(x*x for x in b.values())) if a and b else 0.0

MIN_RELEVANCE_THRESHOLD = 0.20

def _jaccard(s1: set[str], s2: set[str]) -> float:
    if not s1 or not s2:
        return 0.0
    return len(s1 & s2) / len(s1 | s2)

class InMemoryRAG:
    """Demo-safe lexical hybrid baseline; replace the scoring/index adapter with pgvector in API integration."""
    MIN_RELEVANCE_THRESHOLD = MIN_RELEVANCE_THRESHOLD

    def __init__(self, reranker: Optional[Reranker] = None):
        self._chunks: list[EvidenceChunk] = []
        self.reranker = reranker or configured_reranker()
    def index(self, document_id: str, title: str, text: str, *, page: Optional[int] = None, **metadata: object) -> list[EvidenceChunk]:
        digest = hashlib.sha256(text.encode()).hexdigest()
        raw_chunks = structure_aware_chunk(text)
        new_chunks = []
        for n, chunk_data in enumerate(raw_chunks, 1):
            part = chunk_data["text"]
            clause = chunk_data.get("clause")
            location_metadata = {"title": title, **{key: value for key, value in metadata.items() if key not in {"version", "effective_from", "effective_to", "security_level", "source_uri"}}}
            if clause:
                location_metadata["clause"] = clause
            if "scope" not in location_metadata:
                if location_metadata.get("tender_id"):
                    location_metadata["scope"] = "TENDER"
                elif location_metadata.get("document_type") == "POLICY" or location_metadata.get("is_shared"):
                    location_metadata["scope"] = "GLOBAL_POLICY"
            new_chunks.append(EvidenceChunk(id=f"{document_id}:{n}:{digest[:12]}", entity_type="document_chunk", entity_id=document_id, snippet=part.strip(), source_uri=metadata.get("source_uri"), page_number=page, content_hash=digest, location_metadata=location_metadata, version=metadata.get("version"), effective_from=metadata.get("effective_from"), effective_to=metadata.get("effective_to"), security_level=str(metadata.get("security_level", "INTERNAL"))))
        by_id = {chunk.id: chunk for chunk in self._chunks}
        by_id.update({chunk.id: chunk for chunk in new_chunks})
        self._chunks = list(by_id.values())
        return new_chunks
        
    def retrieve(self, query: str, filters: Optional[dict[str, object]] = None, top_k: int = 5) -> list[EvidenceChunk]:
        now = datetime.now(timezone.utc)
        filters = filters or {}
        needle = _terms(query)

        scoped_tender = filters.get("tender_id")
        scoped_tenant = filters.get("tenant_id")
        scoped_bidder = filters.get("bidder_id")

        candidates = []
        for c in self._chunks:
            # Temporal validity
            if c.effective_from and c.effective_from > now:
                continue
            if c.effective_to and c.effective_to < now:
                continue

            # Check shared global policy status: requires GLOBAL_POLICY scope (or un-scoped POLICY doc), PUBLIC security level, and NO tender_id
            is_shared_policy = (
                (c.location_metadata.get("scope") == "GLOBAL_POLICY" or (c.location_metadata.get("document_type") == "POLICY" and not c.location_metadata.get("scope")))
                and c.security_level == "PUBLIC"
                and not c.location_metadata.get("tender_id")
            )

            # Tenant isolation
            chunk_tenant = c.location_metadata.get("tenant_id")
            if scoped_tenant is not None and chunk_tenant is not None and chunk_tenant != scoped_tenant:
                if not is_shared_policy:
                    continue

            # Tender isolation
            chunk_tender = c.location_metadata.get("tender_id")
            if scoped_tender is not None:
                if chunk_tender is not None and chunk_tender != scoped_tender:
                    continue
                if chunk_tender is None and not is_shared_policy:
                    continue

            # Bidder isolation
            chunk_bidder = c.location_metadata.get("bidder_id")
            if scoped_bidder is not None and chunk_bidder is not None and chunk_bidder != scoped_bidder:
                continue

            # Other narrowing filters
            matches_all = True
            for k, v in filters.items():
                if k in {"tender_id", "tenant_id", "bidder_id"}:
                    continue
                if c.location_metadata.get(k) != v:
                    matches_all = False
                    break
            if not matches_all:
                continue

            candidates.append(c)

        fetch_k = top_k * 3
        scored: list[tuple[float, EvidenceChunk]] = []
        for c in candidates:
            raw_score = _score(needle, _terms(c.snippet))
            if raw_score >= MIN_RELEVANCE_THRESHOLD:
                meta = dict(c.location_metadata)
                bounded_score = round(max(0.0, min(1.0, float(raw_score))), 4)
                meta["raw_score"] = round(float(raw_score), 4)
                meta["bounded_relevance_score"] = bounded_score
                meta["relevance_score"] = bounded_score
                scored.append((raw_score, c.model_copy(update={"location_metadata": meta})))

        if not scored:
            return []

        scored.sort(key=lambda x: x[0], reverse=True)
        sorted_cands = [c for _, c in scored[:fetch_k]]

        reranked = self.reranker.rerank(query, sorted_cands, top_k * 2)

        # Exact deduplication by (entity_id, page_number, content_hash)
        seen_keys: set[tuple[str, Optional[int], str]] = set()
        deduped: list[EvidenceChunk] = []
        for chunk in reranked:
            key = (chunk.entity_id, chunk.page_number, chunk.content_hash)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            deduped.append(chunk)

        # Near-duplicate suppression (Jaccard similarity > 0.85)
        final_chunks: list[EvidenceChunk] = []
        for chunk in deduped:
            words = set(re.findall(r"[a-z0-9]+", chunk.snippet.lower()))
            is_near_dup = False
            for kept in final_chunks:
                kept_words = set(re.findall(r"[a-z0-9]+", kept.snippet.lower()))
                if _jaccard(words, kept_words) > 0.85:
                    is_near_dup = True
                    break
            if not is_near_dup:
                final_chunks.append(chunk)
            if len(final_chunks) >= top_k:
                break

        return final_chunks

    def delete(self, document_id: str, scope: Optional[dict[str, object]] = None) -> int:
        before = len(self._chunks)
        if not scope:
            self._chunks = [chunk for chunk in self._chunks if chunk.entity_id != document_id]
        else:
            self._chunks = [
                chunk for chunk in self._chunks
                if not (chunk.entity_id == document_id and all(chunk.location_metadata.get(k) == v for k, v in scope.items()))
            ]
        return before - len(self._chunks)
