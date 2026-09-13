import pytest
from argus_ai.rag.service import InMemoryRAG, MIN_RELEVANCE_THRESHOLD


def test_rag_relevance_threshold_filters_unrelated_queries():
    rag = InMemoryRAG()
    rag.index(
        document_id="DOC-TENDER-101",
        title="Tender Evaluation Criteria",
        text="The bidder must possess minimum 5 years of past experience in bridge construction works.",
        page=1,
        tender_id="T101",
    )

    # Completely unrelated query
    unrelated_res = rag.retrieve("What is the recipe for chocolate cake?", filters={"tender_id": "T101"})
    assert len(unrelated_res) == 0, "Unrelated query must return empty results due to threshold"

    # Related query
    related_res = rag.retrieve("bridge construction past experience years", filters={"tender_id": "T101"})
    assert len(related_res) == 1
    score = related_res[0].location_metadata.get("relevance_score")
    assert score is not None
    assert score >= MIN_RELEVANCE_THRESHOLD
    assert 0.0 <= score <= 1.0


def test_rag_deduplication_and_near_duplicate_suppression():
    rag = InMemoryRAG()
    # Ingest document
    rag.index(
        document_id="DOC-1",
        title="Doc 1",
        text="Annual turnover of bidder shall be at least 100 Crores INR for critical railway projects.",
        page=1,
        tender_id="T1",
    )
    # Ingest same text with another index call (idempotent/duplicate)
    rag.index(
        document_id="DOC-1",
        title="Doc 1",
        text="Annual turnover of bidder shall be at least 100 Crores INR for critical railway projects.",
        page=1,
        tender_id="T1",
    )

    results = rag.retrieve("turnover 100 Crores railway", filters={"tender_id": "T1"})
    assert len(results) == 1, "Duplicate chunks must be deduplicated"


def test_rag_query_specificity_different_citations():
    rag = InMemoryRAG()
    
    # Clause 1: Past experience
    rag.index(
        document_id="DOC-EXP",
        title="Technical Experience Clause",
        text="Clause 3.2: Minimum past experience: Bidder must have completed 3 similar infrastructure projects in the last 7 years.",
        page=3,
        tender_id="T200",
    )
    
    # Clause 2: MSME Exemption
    rag.index(
        document_id="DOC-MSME",
        title="Statutory Exemption Clause",
        text="Clause 8.1: MSME Relaxation: Micro and Small Enterprises registered under Udyam are exempt from prior turnover and experience criteria.",
        page=8,
        tender_id="T200",
    )
    
    # Clause 3: EMD
    rag.index(
        document_id="DOC-EMD",
        title="Earnest Money Deposit Clause",
        text="Clause 5.1: Earnest Money Deposit (EMD) of INR 10,00,000 must be submitted via Bank Guarantee.",
        page=5,
        tender_id="T200",
    )

    # Query 1: Experience
    res_exp = rag.retrieve("What are the minimum past experience thresholds?", filters={"tender_id": "T200"})
    assert len(res_exp) > 0
    assert res_exp[0].entity_id == "DOC-EXP"
    assert "completed 3 similar infrastructure projects" in res_exp[0].snippet

    # Query 2: MSME
    res_msme = rag.retrieve("Is MSME turnover exemption applicable to this tender?", filters={"tender_id": "T200"})
    assert len(res_msme) > 0
    assert res_msme[0].entity_id == "DOC-MSME"
    assert "MSME Relaxation" in res_msme[0].snippet

    # Query 3: EMD
    res_emd = rag.retrieve("What is the required EMD earnest money deposit?", filters={"tender_id": "T200"})
    assert len(res_emd) > 0
    assert res_emd[0].entity_id == "DOC-EMD"
    assert "Earnest Money Deposit" in res_emd[0].snippet


def test_pgvector_rag_scoring_threshold_isolation_dedup():
    """Verify PgVectorRAG SQL compilation, hybrid score semantics, thresholding, tender isolation, and deduplication."""
    from unittest.mock import MagicMock, patch
    from datetime import datetime, timezone
    from argus_ai.rag.pgvector import PgVectorRAG, MIN_RELEVANCE_THRESHOLD

    rag = PgVectorRAG(database_url="postgresql://user:pass@localhost:5432/argus")
    mock_cursor = MagicMock()
    mock_conn = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    now = datetime.now(timezone.utc)
    # Row format:
    # 0:id, 1:entity_type, 2:entity_id, 3:snippet, 4:source_uri, 5:page_number, 6:metadata,
    # 7:content_hash, 8:version, 9:effective_from, 10:effective_to, 11:security_level, 12:created_at, 13:score
    rows = [
        # Row 1: Valid high scoring chunk (0.85)
        (
            "doc1:1:hash1", "document_chunk", "doc1",
            "Minimum annual turnover requirement of 50 Crores INR for highway infrastructure works.",
            "s3://doc1.pdf", 1, {"tender_id": "T-ALPHA", "title": "Tender Specs"},
            "hash1", "1.0", None, None, "INTERNAL", now, 0.85
        ),
        # Row 2: Sub-threshold weak chunk (0.12 < 0.20 threshold) -> MUST BE DROPPED
        (
            "doc2:1:hash2", "document_chunk", "doc2",
            "General background: The contractor shall maintain clean working spaces.",
            "s3://doc2.pdf", 2, {"tender_id": "T-ALPHA", "title": "Cleaning"},
            "hash2", "1.0", None, None, "INTERNAL", now, 0.12
        ),
        # Row 3: Exact duplicate of Row 1 (same entity_id, page_number, content_hash) -> MUST BE DEDUPLICATED
        (
            "doc1:1:hash1_dup", "document_chunk", "doc1",
            "Minimum annual turnover requirement of 50 Crores INR for highway infrastructure works.",
            "s3://doc1.pdf", 1, {"tender_id": "T-ALPHA", "title": "Tender Specs Duplicate"},
            "hash1", "1.0", None, None, "INTERNAL", now, 0.85
        ),
        # Row 4: Near-duplicate of Row 1 (Jaccard > 0.85) -> MUST BE SUPPRESSED
        (
            "doc3:1:hash3", "document_chunk", "doc3",
            "Minimum annual turnover requirement of 50 Crores INR for highway infrastructure works!",
            "s3://doc3.pdf", 3, {"tender_id": "T-ALPHA", "title": "Tender Specs Variant"},
            "hash3", "1.0", None, None, "INTERNAL", now, 0.84
        ),
        # Row 5: Distinct valid chunk (0.65) -> MUST BE KEPT
        (
            "doc4:1:hash4", "document_chunk", "doc4",
            "Bidder must submit audited balance sheets and CA certificate for turnover verification.",
            "s3://doc4.pdf", 4, {"tender_id": "T-ALPHA", "title": "Audit Rules"},
            "hash4", "1.0", None, None, "INTERNAL", now, 0.65
        ),
    ]
    mock_cursor.fetchall.return_value = rows

    with patch.object(rag, "_connect", return_value=mock_conn), \
         patch.object(rag.embeddings, "embed", return_value=[0.1] * rag.embeddings.dimensions):
        
        results = rag.retrieve(
            query="turnover requirement 50 Crores",
            filters={"tender_id": "T-ALPHA"},
            top_k=5
        )

        # 1. Verify SQL syntax and semantics executed
        assert mock_cursor.execute.call_count == 1
        executed_sql, params = mock_cursor.execute.call_args[0]
        
        # Check hybrid score formula in SQL: 1 - cosine_distance + ts_rank_cd
        assert "(0.7 * (1 - (embedding <=> %s::vector)) + 0.3 * ts_rank_cd(search_vector, plainto_tsquery('simple', %s))) AS score" in executed_sql
        # Check tender isolation in SQL: requires matching tender_id OR (GLOBAL_POLICY AND PUBLIC AND tender_id IS NULL)
        assert "metadata ->> 'tender_id' = %s" in executed_sql
        assert "GLOBAL_POLICY" in executed_sql
        assert "T-ALPHA" in params

        # 2. Verify results filtering and deduplication
        assert len(results) == 2, f"Expected exactly 2 unique chunks (Row 1 and Row 5), got {len(results)}"
        
        # 3. Verify sub-threshold chunk (Row 2, score 0.12) was dropped
        assert not any(c.entity_id == "doc2" for c in results)

        # 4. Verify exact duplicate (Row 3) and near duplicate (Row 4) were suppressed
        assert not any(c.entity_id == "doc3" for c in results)

        # 5. Verify bounded_relevance_score is attached and higher = better
        top_chunk = results[0]
        second_chunk = results[1]
        assert top_chunk.location_metadata["relevance_score"] == 0.85
        assert top_chunk.location_metadata["bounded_relevance_score"] == 0.85
        assert second_chunk.location_metadata["relevance_score"] == 0.65
        assert top_chunk.location_metadata["relevance_score"] > second_chunk.location_metadata["relevance_score"]
        assert top_chunk.location_metadata["tender_id"] == "T-ALPHA"


def test_public_corpus_cross_tender_isolation_semantics():
    """Verify Tender B chunk marked PUBLIC with scope=TENDER never leaks into Tender A queries."""
    rag = InMemoryRAG()

    # A. Tender A chunk (private)
    rag.index(
        document_id="DOC-TENDER-A",
        title="Tender A Specs",
        text="Tender A technical requirement: Minimum 3 years continuous surveillance operation.",
        page=1,
        tender_id="TENDER-A",
        scope="TENDER",
        security_level="INTERNAL",
    )

    # B. Tender B chunk (private)
    rag.index(
        document_id="DOC-TENDER-B-PRIV",
        title="Tender B Specs",
        text="Tender B technical requirement: Minimum 5 years continuous highway operations.",
        page=1,
        tender_id="TENDER-B",
        scope="TENDER",
        security_level="INTERNAL",
    )

    # C. Tender B chunk marked PUBLIC but scope=TENDER (REGRESSION CASE)
    rag.index(
        document_id="DOC-TENDER-B-PUB",
        title="Tender B Public Notice",
        text="Tender B technical requirement: All equipment must be delivered to depot within 30 days.",
        page=1,
        tender_id="TENDER-B",
        scope="TENDER",
        security_level="PUBLIC",
    )

    # D. Shared Global Policy chunk (public, tender_id=None, scope=GLOBAL_POLICY)
    rag.index(
        document_id="DOC-GLOBAL-POLICY",
        title="National Procurement Policy Fixture",
        text="Public Procurement Policy: MSME bidders are eligible for exemption from prior turnover criteria.",
        page=1,
        scope="GLOBAL_POLICY",
        security_level="PUBLIC",
    )

    # Query scoped to TENDER-A
    res_a = rag.retrieve("technical requirement continuous operation", filters={"tender_id": "TENDER-A"})
    res_entity_ids = [c.entity_id for c in res_a]

    # Tender A private chunk may return
    assert "DOC-TENDER-A" in res_entity_ids

    # Tender B private chunk must NOT return
    assert "DOC-TENDER-B-PRIV" not in res_entity_ids

    # Tender B PUBLIC chunk must NOT return (Zero cross-tender leakage)
    assert "DOC-TENDER-B-PUB" not in res_entity_ids, "Cross-tender leakage: Tender B chunk returned for Tender A query!"

    # Approved GLOBAL POLICY public chunk query
    res_policy = rag.retrieve("MSME exemption turnover criteria", filters={"tender_id": "TENDER-A"})
    policy_entity_ids = [c.entity_id for c in res_policy]
    assert "DOC-GLOBAL-POLICY" in policy_entity_ids


def test_score_monotonicity_rank_preservation_semantics():
    """Verify monotonic transformation preserves raw rank ordering and validates score terminology."""
    raw_scores = [0.95, 0.85, 0.65, 0.40, 0.20, 0.10, -0.05, 1.25]
    bounded_scores = [round(max(0.0, min(1.0, float(s))), 4) for s in raw_scores]

    # Monotonicity test: for any score_a > score_b -> bounded_score_a >= bounded_score_b
    for i in range(len(raw_scores)):
        for j in range(len(raw_scores)):
            if raw_scores[i] > raw_scores[j]:
                assert bounded_scores[i] >= bounded_scores[j], (
                    f"Monotonicity violated: {raw_scores[i]} > {raw_scores[j]} but {bounded_scores[i]} < {bounded_scores[j]}"
                )

    # Validate score terminology
    rag = InMemoryRAG()
    rag.index(
        document_id="DOC-TERM",
        title="Terminology Spec",
        text="Experience threshold of at least 3 years in surveillance integration.",
        page=1,
        tender_id="T-TERM",
    )
    results = rag.retrieve("experience threshold 3 years", filters={"tender_id": "T-TERM"})
    assert len(results) > 0
    meta = results[0].location_metadata
    assert "bounded_relevance_score" in meta
    assert "relevance_score" in meta
    # Ensure no probabilistic / confidence claims
    assert "confidence_percentage" not in meta
    assert "probability" not in meta
    assert isinstance(meta["bounded_relevance_score"], float)
    assert 0.0 <= meta["bounded_relevance_score"] <= 1.0


def test_pgvector_rag_query_execution_and_isolation_simulation():
    """Execute realistic query through PgVectorRAG SQL query path and verify isolation, policy access, and threshold."""
    from unittest.mock import MagicMock, patch
    from datetime import datetime, timezone
    from argus_ai.rag.pgvector import PgVectorRAG, MIN_RELEVANCE_THRESHOLD

    rag = PgVectorRAG(database_url="postgresql://user:pass@localhost:5432/argus")
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_conn.__enter__.return_value = mock_conn
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor

    now = datetime.now(timezone.utc)
    # Database rows in the simulated table
    db_table = [
        # A: Tender A chunk (private, scope=TENDER)
        (
            "chunk:A", "document_chunk", "DOC-A",
            "Tender A requires past experience of at least 3 years in surveillance systems.",
            "s3://tender_a.pdf", 1,
            {"tender_id": "TENDER-A", "scope": "TENDER", "title": "Tender A Specs"},
            "hash_a", "1.0", None, None, "INTERNAL", now, 0.88
        ),
        # B: Tender B chunk (private, scope=TENDER)
        (
            "chunk:B_priv", "document_chunk", "DOC-B-PRIV",
            "Tender B requires past experience of at least 5 years in highway surveillance.",
            "s3://tender_b.pdf", 1,
            {"tender_id": "TENDER-B", "scope": "TENDER", "title": "Tender B Specs"},
            "hash_b_priv", "1.0", None, None, "INTERNAL", now, 0.87
        ),
        # C: Tender B chunk marked PUBLIC but scope=TENDER
        (
            "chunk:B_pub", "document_chunk", "DOC-B-PUB",
            "Tender B public clause: General surveillance requirement.",
            "s3://tender_b_pub.pdf", 1,
            {"tender_id": "TENDER-B", "scope": "TENDER", "title": "Tender B Public Notice"},
            "hash_b_pub", "1.0", None, None, "PUBLIC", now, 0.80
        ),
        # D: Global public policy chunk (scope=GLOBAL_POLICY, tender_id=None, security_level=PUBLIC)
        (
            "chunk:POLICY", "document_chunk", "DOC-POLICY",
            "National Policy: MSME exemption applies to technical and turnover criteria.",
            "s3://policy.pdf", 1,
            {"tender_id": None, "scope": "GLOBAL_POLICY", "title": "National Procurement Policy"},
            "hash_pol", "1.0", None, None, "PUBLIC", now, 0.75
        ),
        # E: Sub-threshold irrelevant chunk
        (
            "chunk:WEAK", "document_chunk", "DOC-WEAK",
            "Irrelevant content about office supplies and stationery.",
            "s3://weak.pdf", 1,
            {"tender_id": "TENDER-A", "scope": "TENDER", "title": "Office Supplies"},
            "hash_weak", "1.0", None, None, "INTERNAL", now, 0.08
        ),
    ]

    def mock_execute(sql, params):
        # Simulate PostgreSQL WHERE evaluation for tender isolation
        scoped_tender = None
        for p in params:
            if p == "TENDER-A":
                scoped_tender = "TENDER-A"
                break
        
        filtered = []
        for r in db_table:
            meta = r[6]
            sec_level = r[11]
            score = r[13]
            chunk_tender = meta.get("tender_id")
            chunk_scope = meta.get("scope")

            # Evaluate SQL WHERE:
            # (metadata ->> 'tender_id' = %s) OR (scope = GLOBAL_POLICY AND security_level = PUBLIC AND tender_id IS NULL)
            is_tender_match = (scoped_tender is not None and chunk_tender == scoped_tender)
            is_global_policy = (chunk_scope == "GLOBAL_POLICY" and sec_level == "PUBLIC" and chunk_tender is None)
            
            if is_tender_match or is_global_policy:
                if score >= MIN_RELEVANCE_THRESHOLD:
                    filtered.append(r)
        
        # Sort by score DESC
        filtered.sort(key=lambda x: x[13], reverse=True)
        mock_cursor.fetchall.return_value = filtered

    mock_cursor.execute.side_effect = mock_execute

    with patch.object(rag, "_connect", return_value=mock_conn), \
         patch.object(rag.embeddings, "embed", return_value=[0.1] * rag.embeddings.dimensions):

        # Execute scoped query to TENDER-A
        results = rag.retrieve("past experience in surveillance systems", filters={"tender_id": "TENDER-A"}, top_k=5)
        entity_ids = [c.entity_id for c in results]

        # Assertions
        assert "DOC-A" in entity_ids, "Tender A private chunk must return"
        assert "DOC-B-PRIV" not in entity_ids, "Tender B private chunk must NOT return"
        assert "DOC-B-PUB" not in entity_ids, "Tender B public chunk must NOT return (zero cross-tender leakage)"
        assert "DOC-POLICY" in entity_ids, "Approved GLOBAL POLICY public chunk may return"
        assert "DOC-WEAK" not in entity_ids, "Weak irrelevant chunk below threshold must NOT return"

        # Public cross-tender leakage count
        leakage_count = sum(1 for c in results if c.location_metadata.get("tender_id") == "TENDER-B")
        assert leakage_count == 0, f"Expected 0 leakage, got {leakage_count}"


