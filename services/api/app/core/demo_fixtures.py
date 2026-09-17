"""Canonical Backend Demo Fixture Source for ARGUS.

This file is the SINGLE CANONICAL SOURCE OF TRUTH for the synthetic demo scenario.
No other files (frontend stores, tests, scripts) should duplicate domain values
like thresholds, clauses, bidder profiles, or extracted facts.
"""
from typing import Any

DEMO_FIXTURE_VERSION = "2026.09.15.1"

# ---------------------------------------------------------------------------
# 1. CANONICAL TENDERS
# ---------------------------------------------------------------------------

DEMO_TENDERS: list[dict[str, Any]] = [
    {
        "id": "tender_gem_2026_01",
        "tender_number": "GEM/2026/B/4521089",
        "title": "Supply of IT Infrastructure Equipment — Server Racks, UPS Systems, and Networking Hardware",
        "category": "IT Hardware / Data Centre Infrastructure",
        "authority": "National Informatics Centre (NIC), Ministry of Electronics and Information Technology",
        "budget": 50000000.0,
        "deadline": "2026-10-15T18:00:00Z",
        "status": "COMPLETED",
        "raw_document_uri": "data/demo/pdf/tender/tender_gem_2026_B_4521089.pdf",
        "metadata_json": {
            "seed_source": "SYNTHETIC_DEMO",
            "is_demo": True,
            "fixture_version": DEMO_FIXTURE_VERSION,
            "scenario": "FLAGSHIP_EVALUATION",
            "attached_file": {
                "filename": "highway_surveillance_rfp_2026.pdf",
                "size_bytes": 1245000,
                "content_type": "application/pdf",
                "uploaded_at": "2026-08-01T10:01:00Z",
            },
        },
    },
    {
        "id": "tender_gem_2026_02",
        "tender_number": "GEM/2026/B/4521090",
        "title": "National Digital Identity Verification & Cloud Backup Cluster",
        "category": "IT_INFRASTRUCTURE",
        "authority": "Ministry of Electronics & Information Technology",
        "budget": 120000000.0,
        "deadline": "2026-11-01T17:00:00Z",
        "status": "COMPLETED",
        "raw_document_uri": "data/demo/pdf/tender/meity_cloud_cluster_rfp.pdf",
        "metadata_json": {
            "seed_source": "SYNTHETIC_DEMO",
            "is_demo": True,
            "fixture_version": DEMO_FIXTURE_VERSION,
            "attached_file": {
                "filename": "meity_cloud_cluster_rfp.pdf",
                "size_bytes": 4312,
                "content_type": "application/pdf",
                "uploaded_at": "2026-08-10T11:31:00Z",
            },
        },
    },
    {
        "id": "tender_gem_2026_03",
        "tender_number": "GEM/2026/B/4521091",
        "title": "Smart Solar Grid Micro-Inverter Deployment (Phase IV)",
        "category": "RENEWABLE_ENERGY",
        "authority": "Solar Energy Corporation of India",
        "budget": 85000000.0,
        "deadline": "2026-12-01T12:00:00Z",
        "status": "COMPLETED",
        "raw_document_uri": "data/demo/pdf/tender/seci_solar_grid_rfp.pdf",
        "metadata_json": {
            "seed_source": "SYNTHETIC_DEMO",
            "is_demo": True,
            "fixture_version": DEMO_FIXTURE_VERSION,
            "attached_file": {
                "filename": "seci_solar_grid_rfp.pdf",
                "size_bytes": 3004,
                "content_type": "application/pdf",
                "uploaded_at": "2026-08-20T09:16:00Z",
            },
        },
    },
]


# ---------------------------------------------------------------------------
# 2. CANONICAL REQUIREMENTS (PER TENDER)
# ---------------------------------------------------------------------------

DEMO_REQUIREMENTS: dict[str, list[dict[str, Any]]] = {
    "tender_gem_2026_01": [
        {
            "id": "req_01",
            "clause": "2.1",
            "requirement_type": "GST",
            "field": "tax.gstin",
            "operator": "EXISTS",
            "expected_value": True,
            "unit": None,
            "mandatory": True,
            "confidence": 1.0,
            "requires_verification": True,
            "is_approved": True,
            "source_page": 1,
            "source_text": "The bidder must have a valid GSTIN and must be registered on the GeM portal.",
            "metadata_json": {"seed_source": "SYNTHETIC_DEMO", "fixture_version": DEMO_FIXTURE_VERSION},
        },
        {
            "id": "req_02",
            "clause": "2.2",
            "requirement_type": "UDYAM",
            "field": "registration.udyam",
            "operator": "EXISTS",
            "expected_value": True,
            "unit": None,
            "mandatory": True,
            "confidence": 1.0,
            "requires_verification": True,
            "is_approved": True,
            "source_page": 1,
            "source_text": "MSE bidders shall furnish a valid Udyam Registration Certificate.",
            "metadata_json": {"seed_source": "SYNTHETIC_DEMO", "fixture_version": DEMO_FIXTURE_VERSION},
        },
        {
            "id": "req_03",
            "clause": "2.3",
            "requirement_type": "TURNOVER",
            "field": "financial.average_annual_turnover",
            "operator": "GTE",
            "expected_value": 10000000,  # INR 1,00,00,000 (One Crore)
            "unit": "INR",
            "mandatory": True,
            "confidence": 1.0,
            "requires_verification": True,
            "is_approved": True,
            "source_page": 1,
            "source_text": (
                "Minimum annual turnover shall be INR 1,00,00,000 based on the average of "
                "the last three financial years (FY 2023-24, 2024-25, 2025-26)."
            ),
            "metadata_json": {"seed_source": "SYNTHETIC_DEMO", "currency": "INR", "fixture_version": DEMO_FIXTURE_VERSION},
        },
        {
            "id": "req_04",
            "clause": "2.4",
            "requirement_type": "EXPERIENCE",
            "field": "experience.years",
            "operator": "GTE",
            "expected_value": 3,
            "unit": "years",
            "mandatory": True,
            "confidence": 1.0,
            "requires_verification": False,
            "is_approved": True,
            "source_page": 1,
            "source_text": (
                "The bidder must have a minimum of 3 years of experience in supply and "
                "installation of IT infrastructure equipment to government or PSU organizations."
            ),
            "metadata_json": {"seed_source": "SYNTHETIC_DEMO", "fixture_version": DEMO_FIXTURE_VERSION},
        },
        {
            "id": "req_05",
            "clause": "2.5",
            "requirement_type": "BLACK_LIST",
            "field": "legal.blacklisted",
            "operator": "EQ",
            "expected_value": False,
            "unit": None,
            "mandatory": True,
            "confidence": 1.0,
            "requires_verification": True,
            "is_approved": True,
            "source_page": 1,
            "source_text": (
                "The bidder must not be blacklisted or debarred by any Central/State Government "
                "organization."
            ),
            "metadata_json": {"seed_source": "SYNTHETIC_DEMO", "fixture_version": DEMO_FIXTURE_VERSION},
        },
    ],
    "tender_gem_2026_02": [
        {
            "id": "req_b01",
            "clause": "3.1.2",
            "requirement_type": "GST",
            "field": "tax.gstin",
            "operator": "EXISTS",
            "expected_value": True,
            "unit": None,
            "mandatory": True,
            "confidence": 1.0,
            "requires_verification": True,
            "is_approved": True,
            "source_page": 1,
            "source_text": "Bidder must be registered under GST Act and possess a valid GSTIN.",
            "metadata_json": {"seed_source": "SYNTHETIC_DEMO", "fixture_version": DEMO_FIXTURE_VERSION},
        },
        {
            "id": "req_b02",
            "clause": "3.2.1",
            "requirement_type": "TURNOVER",
            "field": "financial.average_annual_turnover",
            "operator": "GTE",
            "expected_value": 120000000,
            "unit": "INR",
            "mandatory": True,
            "confidence": 1.0,
            "requires_verification": True,
            "is_approved": True,
            "source_page": 1,
            "source_text": "Minimum annual turnover must exceed INR 120,000,000 based on the average of the last three financial years (FY 2023-24, 2024-25, 2025-26).",
            "metadata_json": {"seed_source": "SYNTHETIC_DEMO", "currency": "INR", "fixture_version": DEMO_FIXTURE_VERSION},
        },
    ],
    "tender_gem_2026_03": [
        {
            "id": "req_c01",
            "clause": "2.1(a)",
            "requirement_type": "GST",
            "field": "tax.gstin",
            "operator": "EXISTS",
            "expected_value": True,
            "unit": None,
            "mandatory": True,
            "confidence": 1.0,
            "requires_verification": True,
            "is_approved": True,
            "source_page": 1,
            "source_text": "Valid GSTIN required and bidder must be registered on the GeM portal.",
            "metadata_json": {"seed_source": "SYNTHETIC_DEMO", "fixture_version": DEMO_FIXTURE_VERSION},
        },
        {
            "id": "req_c01_gem",
            "clause": "2.1(b)",
            "requirement_type": "CUSTOM",
            "field": "gem.seller_id",
            "operator": "EXISTS",
            "expected_value": True,
            "unit": None,
            "mandatory": True,
            "confidence": 1.0,
            "requires_verification": True,
            "is_approved": True,
            "source_page": 1,
            "source_text": "Valid GSTIN required and bidder must be registered on the GeM portal.",
            "metadata_json": {"seed_source": "SYNTHETIC_DEMO", "fixture_version": DEMO_FIXTURE_VERSION},
        },
        {
            "id": "req_c02",
            "clause": "2.4",
            "requirement_type": "TURNOVER",
            "field": "financial.average_annual_turnover",
            "operator": "GTE",
            "expected_value": 85000000,
            "unit": "INR",
            "mandatory": True,
            "confidence": 1.0,
            "requires_verification": True,
            "is_approved": True,
            "source_page": 1,
            "source_text": "Annual turnover of INR 85,000,000 or higher based on average of last 3 financial years.",
            "metadata_json": {"seed_source": "SYNTHETIC_DEMO", "currency": "INR", "fixture_version": DEMO_FIXTURE_VERSION},
        },
    ],
}


# ---------------------------------------------------------------------------
# 3. CANONICAL BIDDERS (PER TENDER)
# ---------------------------------------------------------------------------

DEMO_BIDDERS: dict[str, list[dict[str, Any]]] = {
    "tender_gem_2026_01": [
        {
            "id": "bidder_alpha_01",
            "bidder_name": "ALPHA TECHNOLOGIES PRIVATE LIMITED",
            "gstin": "07AABCA1234H1Z9",
            "udyam_number": "UDYAM-DL-07-0012345",
            "pan": "AABCA1234H",
            "cin": "U72200DL2018PTC123456",
            "status": "QUALIFIED",
            "metadata_json": {
                "seed_source": "SYNTHETIC_DEMO",
                "is_demo": True,
                "fixture_version": DEMO_FIXTURE_VERSION,
                "verification_mode": "DEMO",
                "scenario": "FULLY_COMPLIANT",
                "expected_outcome": "PASS",
            },
        },
        {
            "id": "bidder_bharat_03",
            "bidder_name": "BHARAT INFOSYSTEMS LLP",
            "gstin": "29AAFBB5678K1Z3",
            "udyam_number": "UDYAM-KA-29-0045678",
            "pan": "AAFBB5678K",
            "cin": None,
            "status": "PENDING",
            "metadata_json": {
                "seed_source": "SYNTHETIC_DEMO",
                "is_demo": True,
                "fixture_version": DEMO_FIXTURE_VERSION,
                "verification_mode": "DEMO",
                "scenario": "TURNOVER_SHORTFALL_AND_CLAIM_DISCREPANCY",
                "expected_outcome": "REVIEW_REQUIRED",
            },
        },
        {
            "id": "bidder_crest_02",
            "bidder_name": "CREST SOLUTIONS PRIVATE LIMITED",
            "gstin": "27AABCC9876D1Z7",
            "udyam_number": None,
            "pan": "AABCC9876D",
            "cin": None,
            "status": "PENDING",
            "metadata_json": {
                "seed_source": "SYNTHETIC_DEMO",
                "is_demo": True,
                "fixture_version": DEMO_FIXTURE_VERSION,
                "verification_mode": "DEMO",
                "scenario": "DEBARRED_VENDOR_AND_SUSPENDED_GST",
                "expected_outcome": "FAIL",
            },
        },
    ],
    "tender_gem_2026_02": [
        {
            "id": "bidder_gem2_01",
            "bidder_name": "CREST ENTERPRISES",
            "gstin": "33AABCC9999P1Z1",
            "udyam_number": None,
            "pan": "AABCC9999P",
            "cin": None,
            "status": "PENDING",
            "metadata_json": {
                "seed_source": "SYNTHETIC_DEMO",
                "is_demo": True,
                "fixture_version": DEMO_FIXTURE_VERSION,
                "verification_mode": "DEMO",
            },
        }
    ],
    "tender_gem_2026_03": [
        {
            "id": "bidder_gem3_01",
            "bidder_name": "BHARAT TECH SOLUTIONS LLP",
            "gstin": "27AAGCB5678K1Z3",
            "udyam_number": "UDYAM-MH-02-0054321",
            "pan": "AAGCB5678K",
            "cin": None,
            "status": "PENDING",
            "metadata_json": {
                "seed_source": "SYNTHETIC_DEMO",
                "is_demo": True,
                "fixture_version": DEMO_FIXTURE_VERSION,
                "verification_mode": "DEMO",
            },
        }
    ],
}


# ---------------------------------------------------------------------------
# 4. CANONICAL BIDDER DOCUMENTS & FACTS
# ---------------------------------------------------------------------------

DEMO_DOCUMENTS: dict[str, list[dict[str, Any]]] = {
    "bidder_alpha_01": [
        {
            "id": "doc_alpha_gst",
            "filename": "gst_certificate.pdf",
            "storage_uri": "data/demo/pdf/bidder_alpha/gst_certificate.pdf",
            "sha256": "a1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
            "document_type": "GST_CERT",
            "content_type": "application/pdf",
            "size_bytes": 452100,
            "facts": [
                {
                    "field": "tax.gstin",
                    "value": "07AABCA1234H1Z9",
                    "source_page": 1,
                    "source_text": "GSTIN: 07AABCA1234H1Z9 (Legal Name: ALPHA TECHNOLOGIES PRIVATE LIMITED)",
                    "confidence": 1.0,
                }
            ],
        },
        {
            "id": "doc_alpha_udyam",
            "filename": "udyam_certificate.pdf",
            "storage_uri": "data/demo/pdf/bidder_alpha/udyam_certificate.pdf",
            "sha256": "a2b3c4d5e6f78901234567890abcdef1234567890abcdef1234567890abcdef",
            "document_type": "UDYAM_CERT",
            "content_type": "application/pdf",
            "size_bytes": 312000,
            "facts": [
                {
                    "field": "registration.udyam",
                    "value": "UDYAM-DL-07-0012345",
                    "source_page": 1,
                    "source_text": "Udyam Registration Number: UDYAM-DL-07-0012345 (Micro & Small Enterprise)",
                    "confidence": 1.0,
                }
            ],
        },
        {
            "id": "doc_alpha_turnover",
            "filename": "turnover_certificate.pdf",
            "storage_uri": "data/demo/pdf/bidder_alpha/turnover_certificate.pdf",
            "sha256": "b2c3d4e5f6a178901234567890abcdef1234567890abcdef1234567890abcdef",
            "document_type": "FINANCIAL_STATEMENT",
            "content_type": "application/pdf",
            "size_bytes": 812400,
            "facts": [
                {
                    "field": "financial.average_annual_turnover",
                    "value": 150000000,  # 15 Cr > 1 Cr requirement
                    "source_page": 1,
                    "source_text": "Average annual turnover of the bidder for the preceding three financial years is INR 15,00,00,000.",
                    "confidence": 1.0,
                    "metadata_json": {"currency": "INR", "unit": "INR"},
                }
            ],
        },
        {
            "id": "doc_alpha_experience",
            "filename": "experience_certificate.pdf",
            "storage_uri": "data/demo/pdf/bidder_alpha/experience_certificate.pdf",
            "sha256": "c3d4e5f6a1b278901234567890abcdef1234567890abcdef1234567890abcdef",
            "document_type": "OTHER",
            "content_type": "application/pdf",
            "size_bytes": 524000,
            "facts": [
                {
                    "field": "experience.years",
                    "value": 5,  # 5 yrs > 3 yrs requirement
                    "source_page": 1,
                    "source_text": "Alpha Technologies Private Limited has completed over 5 years of continuous IT infrastructure supply contracts.",
                    "confidence": 1.0,
                },
                {
                    "field": "legal.blacklisted",
                    "value": False,
                    "source_page": 2,
                    "source_text": "The bidder solemnly declares that it is not blacklisted or debarred by any Central or State government authority.",
                    "confidence": 1.0,
                },
            ],
        },
    ],
    "bidder_bharat_03": [
        {
            "id": "doc_bharat_gst",
            "filename": "gst_certificate.pdf",
            "storage_uri": "data/demo/pdf/bidder_bharat/gst_certificate.pdf",
            "sha256": "b1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
            "document_type": "GST_CERT",
            "content_type": "application/pdf",
            "size_bytes": 412000,
            "facts": [
                {
                    "field": "tax.gstin",
                    "value": "29AAFBB5678K1Z3",
                    "source_page": 1,
                    "source_text": "GSTIN: 29AAFBB5678K1Z3 (Legal Name: BHARAT INFOSYSTEMS LLP)",
                    "confidence": 1.0,
                }
            ],
        },
        {
            "id": "doc_bharat_udyam",
            "filename": "udyam_certificate.pdf",
            "storage_uri": "data/demo/pdf/bidder_bharat/udyam_certificate.pdf",
            "sha256": "b2b3c4d5e6f78901234567890abcdef1234567890abcdef1234567890abcdef",
            "document_type": "UDYAM_CERT",
            "content_type": "application/pdf",
            "size_bytes": 320000,
            "facts": [
                {
                    "field": "registration.udyam",
                    "value": "UDYAM-KA-29-0045678",
                    "source_page": 1,
                    "source_text": "Udyam Registration Number: UDYAM-KA-29-0045678",
                    "confidence": 1.0,
                }
            ],
        },
        {
            "id": "doc_bharat_turnover",
            "filename": "turnover_certificate.pdf",
            "storage_uri": "data/demo/pdf/bidder_bharat/turnover_certificate.pdf",
            "sha256": "b3b4c5d6e7f88901234567890abcdef1234567890abcdef1234567890abcdef",
            "document_type": "FINANCIAL_STATEMENT",
            "content_type": "application/pdf",
            "size_bytes": 620000,
            "facts": [
                {
                    "field": "financial.average_annual_turnover",
                    "value": 150000000,
                    "source_page": 1,
                    "source_text": "Self-declared average turnover: INR 15,00,00,000.",
                    "confidence": 0.70,
                    "metadata_json": {"currency": "INR", "unit": "INR"},
                }
            ],
        },
        {
            "id": "doc_bharat_experience",
            "filename": "experience_certificate.pdf",
            "storage_uri": "data/demo/pdf/bidder_bharat/experience_certificate.pdf",
            "sha256": "b4b5c6d7e8f98901234567890abcdef1234567890abcdef1234567890abcdef",
            "document_type": "OTHER",
            "content_type": "application/pdf",
            "size_bytes": 480000,
            "facts": [
                {
                    "field": "experience.years",
                    "value": 3,
                    "source_page": 1,
                    "source_text": "Bharat Infosystems LLP has 3 years of experience in system delivery.",
                    "confidence": 1.0,
                },
                {
                    "field": "legal.blacklisted",
                    "value": False,
                    "source_page": 1,
                    "source_text": "Not debarred.",
                    "confidence": 1.0,
                },
            ],
        },
        {
            "id": "doc_bharat_turnover_declaration",
            "filename": "financial_declaration.pdf",
            "storage_uri": "data/demo/pdf/bidder_bharat/financial_declaration.pdf",
            "sha256": "331cd4d9fb2d67e17db671dae52b78eb8d4676d84577a33eae04b34e59081143",
            "document_type": "FINANCIAL_STATEMENT",
            "content_type": "application/pdf",
            "size_bytes": 2200,
            "facts": [
                {
                    "field": "financial.average_annual_turnover",
                    "value": 150000000,
                    "source_page": 1,
                    "source_text": "Average Annual Turnover: INR 15,00,00,000",
                    "confidence": 0.85,
                    "metadata_json": {"currency": "INR", "unit": "INR"},
                }
            ],
        },
    ],
    "bidder_crest_02": [
        {
            "id": "doc_crest_gst",
            "filename": "gst_certificate.pdf",
            "storage_uri": "data/demo/pdf/bidder_crest/gst_certificate.pdf",
            "sha256": "c1b2c3d4e5f678901234567890abcdef1234567890abcdef1234567890abcdef",
            "document_type": "GST_CERT",
            "content_type": "application/pdf",
            "size_bytes": 390000,
            "facts": [
                {
                    "field": "tax.gstin",
                    "value": "27AABCC9876D1Z7",
                    "source_page": 1,
                    "source_text": "GSTIN: 27AABCC9876D1Z7 (Legal Name: CREST SOLUTIONS PRIVATE LIMITED)",
                    "confidence": 1.0,
                }
            ],
        },
        {
            "id": "doc_crest_turnover",
            "filename": "turnover_certificate.pdf",
            "storage_uri": "data/demo/pdf/bidder_crest/turnover_certificate.pdf",
            "sha256": "c2b3c4d5e6f78901234567890abcdef1234567890abcdef1234567890abcdef",
            "document_type": "FINANCIAL_STATEMENT",
            "content_type": "application/pdf",
            "size_bytes": 710000,
            "facts": [
                {
                    "field": "financial.average_annual_turnover",
                    "value": 120000000,  # 12 Cr > 1 Cr
                    "source_page": 1,
                    "source_text": "Audited average annual turnover: INR 12,00,00,000.",
                    "confidence": 1.0,
                    "metadata_json": {"currency": "INR", "unit": "INR"},
                }
            ],
        },
        {
            "id": "doc_crest_experience",
            "filename": "experience_certificate.pdf",
            "storage_uri": "data/demo/pdf/bidder_crest/experience_certificate.pdf",
            "sha256": "c3b4c5d6e7f88901234567890abcdef1234567890abcdef1234567890abcdef",
            "document_type": "OTHER",
            "content_type": "application/pdf",
            "size_bytes": 510000,
            "facts": [
                {
                    "field": "experience.years",
                    "value": 4,
                    "source_page": 1,
                    "source_text": "Crest Solutions Private Limited holds 4 years of operating track record.",
                    "confidence": 1.0,
                },
            ],
        },
    ],
}


# ---------------------------------------------------------------------------
# 5. CANONICAL RAG EVIDENCE CHUNKS
# ---------------------------------------------------------------------------

DEMO_RAG_CHUNKS: list[dict[str, Any]] = [
    {
        "id": "chunk_gem_turnover_23",
        "tender_id": "tender_gem_2026_01",
        "entity_type": "document_chunk",
        "entity_id": "doc_tender_gem_2026_01",
        "clause": "Clause 2.3",
        "snippet": (
            "Clause 2.3 (Financial Turnover): Minimum annual turnover shall be INR 1,00,00,000 "
            "(One Crore) based on the average of the last three financial years (FY 2023-24, 2024-25, 2025-26), "
            "certified by a Chartered Accountant with valid UDIN."
        ),
        "source_uri": "data/demo/pdf/tender/tender_gem_2026_B_4521089.pdf#page=1",
        "page_number": 1,
        "location_metadata": {"clause": "Clause 2.3", "title": "Tender Document — Financial Eligibility", "synthetic": True, "relevance_score": 0.95},
    },
    {
        "id": "chunk_gem_experience_24",
        "tender_id": "tender_gem_2026_01",
        "entity_type": "document_chunk",
        "entity_id": "doc_tender_gem_2026_01",
        "clause": "Clause 2.4",
        "snippet": (
            "Clause 2.4 (Operating Experience): The bidder must possess a minimum of 3 years of experience in "
            "supply and installation of IT infrastructure equipment to government or PSU organizations with "
            "satisfactory performance certificates."
        ),
        "source_uri": "data/demo/pdf/tender/tender_gem_2026_B_4521089.pdf#page=1",
        "page_number": 1,
        "location_metadata": {"clause": "Clause 2.4", "title": "Tender Document — Technical Experience", "synthetic": True, "relevance_score": 0.95},
    },
    {
        "id": "chunk_gem_msme_exemption",
        "tender_id": "tender_gem_2026_01",
        "entity_type": "document_chunk",
        "entity_id": "doc_policy_msme",
        "clause": "Clause 2.2 / Policy P-153",
        "snippet": (
            "Public Procurement Policy for MSEs Order, 2012: Micro and Small Enterprises (MSEs) registered with "
            "Udyam are exempted from payment of Earnest Money Deposit (EMD). Prior turnover and prior experience "
            "requirements may be relaxed for MSEs subject to meeting quality and technical specifications."
        ),
        "source_uri": "data/demo/pdf/tender/tender_gem_2026_B_4521089.pdf#page=1",
        "page_number": 1,
        "location_metadata": {"clause": "Policy P-153", "title": "MSME Exemption Guidelines", "synthetic": True, "relevance_score": 0.95},
    },
    {
        "id": "chunk_gem_emd_clause",
        "tender_id": "tender_gem_2026_01",
        "entity_type": "document_chunk",
        "entity_id": "doc_tender_gem_2026_01",
        "clause": "Clause 1.8",
        "snippet": (
            "Clause 1.8 (Earnest Money Deposit): Bidders must submit an Earnest Money Deposit (EMD) of "
            "INR 10,00,000 (INR Ten Lakhs) via Bank Guarantee or online payment. MSEs and Startups are exempted "
            "upon submission of valid registration certificates."
        ),
        "source_uri": "data/demo/pdf/tender/tender_gem_2026_B_4521089.pdf#page=1",
        "page_number": 1,
        "location_metadata": {"clause": "Clause 1.8", "title": "EMD Terms", "synthetic": True, "relevance_score": 0.95},
    },
    {
        "id": "chunk_gem_warranty_clause",
        "tender_id": "tender_gem_2026_01",
        "entity_type": "document_chunk",
        "entity_id": "doc_tender_gem_2026_01",
        "clause": "Clause 5.1",
        "snippet": (
            "Clause 5.1 (Warranty & AMC): Comprehensive on-site warranty of 3 years is required from the date of "
            "successful commissioning, covering all supplied server racks, UPS systems, and networking components."
        ),
        "source_uri": "data/demo/pdf/tender/tender_gem_2026_B_4521089.pdf#page=2",
        "page_number": 2,
        "location_metadata": {"clause": "Clause 5.1", "title": "Warranty & Support", "synthetic": True, "relevance_score": 0.95},
    },
    {
        "id": "chunk_gem_jv_clause",
        "tender_id": "tender_gem_2026_01",
        "entity_type": "document_chunk",
        "entity_id": "doc_tender_gem_2026_01",
        "clause": "Clause 3.4",
        "snippet": (
            "Clause 3.4 (Joint Venture / Consortium): Joint ventures and consortiums are not permitted for this "
            "procurement. Only single entities fulfilling all eligibility criteria in their own name may submit bids."
        ),
        "source_uri": "data/demo/pdf/tender/tender_gem_2026_B_4521089.pdf#page=1",
        "page_number": 1,
        "location_metadata": {"clause": "Clause 3.4", "title": "Consortium Policy", "synthetic": True, "relevance_score": 0.95},
    },
]
