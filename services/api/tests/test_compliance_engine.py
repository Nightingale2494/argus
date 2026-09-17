from datetime import datetime, timezone
import pytest
from app.compliance.engine import ComplianceEngine
from app.schemas.canonical import (
    ComplianceStatus,
    FactRead,
    OperatorEnum,
    RequirementType,
    TenderRequirementRead,
    VerificationResultRead,
    VerificationSource,
    VerificationStatus,
)
from app.services.bid_verification_service import BidVerificationService


def make_requirement(
    operator: OperatorEnum,
    expected_value: any,
    field: str = "financial.average_annual_turnover",
    mandatory: bool = True,
    req_type: RequirementType | None = None,
    meta: dict | None = None,
) -> TenderRequirementRead:
    if req_type is None:
        req_type = RequirementType.TURNOVER if "financial" in field else RequirementType.CUSTOM
    return TenderRequirementRead(
        id="REQ-001",
        tender_id="TENDER-001",
        clause="4.2",
        requirement_type=req_type,
        field=field,
        operator=operator,
        expected_value=expected_value,
        unit="INR" if "financial" in field else None,
        mandatory=mandatory,
        confidence=1.0,
        requires_verification=True,
        is_approved=True,
        metadata_json=meta or ({"currency": "INR"} if "financial" in field else {}),
        created_at=datetime.now(timezone.utc),
    )


def make_fact(value: any, field: str = "financial.average_annual_turnover", fact_id: str = "FACT-001", meta: dict | None = None) -> FactRead:
    metadata = {"currency": "INR"} if "financial" in field else {}
    if meta:
        metadata.update(meta)
    return FactRead(
        id=fact_id,
        document_id="DOC-001",
        bidder_id="BIDDER-001",
        field=field,
        value=value,
        confidence=1.0,
        metadata_json=metadata,
        created_at=datetime.now(timezone.utc),
    )


def make_verification(
    status: VerificationStatus,
    verified_value: any = None,
    field: str = "financial.average_annual_turnover",
    ver_id: str = "VER-001",
    claimed_value: any = None,
) -> VerificationResultRead:
    return VerificationResultRead(
        id=ver_id,
        bidder_id="BIDDER-001",
        field=field,
        claimed_value=claimed_value if claimed_value is not None else (150000000 if "financial" in field else None),
        verified_value=verified_value,
        status=status,
        source=VerificationSource.GST_DEMO_DATA,
        checked_at=datetime.now(timezone.utc),
    )


def test_compliance_gte_pass():
    req = make_requirement(OperatorEnum.GTE, 100000000)
    facts = [make_fact(150000000)]
    eval_res = ComplianceEngine.evaluate(req, facts, [])
    assert eval_res.status == ComplianceStatus.PASS
    assert eval_res.reason_code == "GREATER_THAN_OR_EQUAL"


def test_compliance_gte_fail():
    req = make_requirement(OperatorEnum.GTE, 100000000)
    facts = [make_fact(80000000)]
    eval_res = ComplianceEngine.evaluate(req, facts, [])
    assert eval_res.status == ComplianceStatus.FAIL
    assert eval_res.reason_code == "LESS_THAN"


def test_compliance_missing_facts_mandatory_unknown():
    req = make_requirement(OperatorEnum.GTE, 100000000, mandatory=True)
    eval_res = ComplianceEngine.evaluate(req, [], [])
    assert eval_res.status == ComplianceStatus.UNKNOWN
    assert eval_res.reason_code == "MISSING_EVIDENCE"


def test_compliance_missing_facts_optional_not_applicable():
    req = make_requirement(OperatorEnum.GTE, 100000000, mandatory=False, meta={"optional_missing_policy": "NOT_APPLICABLE"})
    eval_res = ComplianceEngine.evaluate(req, [], [])
    assert eval_res.status == ComplianceStatus.NOT_APPLICABLE
    assert eval_res.reason_code == "NOT_APPLICABLE_OPTIONAL"


def test_compliance_verification_service_error_unknown():
    req = make_requirement(OperatorEnum.GTE, 100000000)
    facts = [make_fact(150000000)]
    ver = [make_verification(VerificationStatus.SERVICE_ERROR)]
    eval_res = ComplianceEngine.evaluate(req, facts, ver)
    assert eval_res.status == ComplianceStatus.UNKNOWN
    assert eval_res.reason_code == "VERIFICATION_UNAVAILABLE"


def test_compliance_verification_timeout_unknown():
    req = make_requirement(OperatorEnum.GTE, 100000000)
    facts = [make_fact(150000000)]
    ver = [make_verification(VerificationStatus.TIMEOUT)]
    eval_res = ComplianceEngine.evaluate(req, facts, ver)
    assert eval_res.status == ComplianceStatus.UNKNOWN
    assert eval_res.reason_code == "VERIFICATION_UNAVAILABLE"


def test_compliance_verification_mismatch_review_required():
    req = make_requirement(OperatorEnum.GTE, 100000000)
    facts = [make_fact(150000000)]
    ver = [make_verification(VerificationStatus.MISMATCH, verified_value=80000000)]
    eval_res = ComplianceEngine.evaluate(req, facts, ver)
    assert eval_res.status == ComplianceStatus.REVIEW_REQUIRED
    assert eval_res.reason_code == "VERIFICATION_MISMATCH"


def test_compliance_conflicting_facts_review_required():
    req = make_requirement(OperatorEnum.GTE, 100000000)
    facts = [
        make_fact(150000000, fact_id="FACT-001"),
        make_fact(80000000, fact_id="FACT-002"),
    ]
    eval_res = ComplianceEngine.evaluate(req, facts, [])
    assert eval_res.status == ComplianceStatus.REVIEW_REQUIRED
    assert eval_res.reason_code == "CONFLICTING_FACTS"


def test_compliance_conflicting_verified_values_review_required():
    req = make_requirement(OperatorEnum.GTE, 100000000)
    facts = [make_fact(150000000)]
    ver = [
        make_verification(VerificationStatus.VERIFIED, verified_value=150000000, ver_id="V1"),
        make_verification(VerificationStatus.VERIFIED, verified_value=80000000, ver_id="V2"),
    ]
    eval_res = ComplianceEngine.evaluate(req, facts, ver)
    assert eval_res.status == ComplianceStatus.REVIEW_REQUIRED
    assert eval_res.reason_code == "CONFLICTING_VERIFICATION_RESULTS"


def test_compliance_claim_vs_verification_mismatch():
    req = make_requirement(OperatorEnum.GTE, 100000000)
    facts = [make_fact(150000000)]
    ver = [make_verification(VerificationStatus.VERIFIED, verified_value=120000000)]
    eval_res = ComplianceEngine.evaluate(req, facts, ver)
    assert eval_res.status == ComplianceStatus.REVIEW_REQUIRED
    assert eval_res.reason_code == "CLAIM_VERIFICATION_MISMATCH"


def test_compliance_date_before():
    req = make_requirement(OperatorEnum.DATE_BEFORE, "2025-01-01", field="general.incorporation_date")
    facts = [make_fact("2024-05-15", field="general.incorporation_date")]
    eval_res = ComplianceEngine.evaluate(req, facts, [])
    assert eval_res.status == ComplianceStatus.PASS

    facts_after = [make_fact("2025-06-01", field="general.incorporation_date")]
    eval_res_fail = ComplianceEngine.evaluate(req, facts_after, [])
    assert eval_res_fail.status == ComplianceStatus.FAIL


def test_compliance_exists_operator():
    req = make_requirement(OperatorEnum.EXISTS, True, field="certificates.iso9001", mandatory=True)
    facts = [make_fact(True, field="certificates.iso9001")]
    eval_res = ComplianceEngine.evaluate(req, facts, [])
    assert eval_res.status == ComplianceStatus.PASS
    assert eval_res.reason_code == "EVIDENCE_EXISTS"

    eval_res_missing = ComplianceEngine.evaluate(req, [], [])
    assert eval_res_missing.status == ComplianceStatus.UNKNOWN
    assert eval_res_missing.reason_code == "MISSING_EVIDENCE"


def test_evidence_absence_safety_exists_and_not_exists():
    # 1. EXISTS mandatory + no facts/verifications => UNKNOWN / MISSING_EVIDENCE
    req_exists_mand = make_requirement(OperatorEnum.EXISTS, True, field="cert.iso", mandatory=True)
    res1 = ComplianceEngine.evaluate(req_exists_mand, [], [])
    assert res1.status == ComplianceStatus.UNKNOWN
    assert res1.reason_code == "MISSING_EVIDENCE"

    # 2. EXISTS optional + no evidence => NOT_APPLICABLE / NOT_APPLICABLE_OPTIONAL
    req_exists_opt = make_requirement(OperatorEnum.EXISTS, True, field="cert.iso", mandatory=False, meta={"optional_missing_policy": "NOT_APPLICABLE"})
    res2 = ComplianceEngine.evaluate(req_exists_opt, [], [])
    assert res2.status == ComplianceStatus.NOT_APPLICABLE
    assert res2.reason_code == "NOT_APPLICABLE_OPTIONAL"

    # 3. EXISTS + explicit usable value => PASS / EVIDENCE_EXISTS
    res3 = ComplianceEngine.evaluate(req_exists_mand, [make_fact(True, field="cert.iso")], [])
    assert res3.status == ComplianceStatus.PASS
    assert res3.reason_code == "EVIDENCE_EXISTS"

    # 4. NOT_EXISTS mandatory + no evidence => UNKNOWN / MISSING_EVIDENCE
    req_ne_mand = make_requirement(OperatorEnum.NOT_EXISTS, False, field="debarment.status", mandatory=True)
    res4 = ComplianceEngine.evaluate(req_ne_mand, [], [])
    assert res4.status == ComplianceStatus.UNKNOWN
    assert res4.reason_code == "MISSING_EVIDENCE"

    # 5. NOT_EXISTS optional + no evidence => NOT_APPLICABLE / NOT_APPLICABLE_OPTIONAL
    req_ne_opt = make_requirement(OperatorEnum.NOT_EXISTS, False, field="debarment.status", mandatory=False, meta={"optional_missing_policy": "NOT_APPLICABLE"})
    res5 = ComplianceEngine.evaluate(req_ne_opt, [], [])
    assert res5.status == ComplianceStatus.NOT_APPLICABLE
    assert res5.reason_code == "NOT_APPLICABLE_OPTIONAL"

    # 6. NOT_EXISTS + explicit False => PASS / EVIDENCE_ABSENT
    res6 = ComplianceEngine.evaluate(req_ne_mand, [make_fact(False, field="debarment.status")], [])
    assert res6.status == ComplianceStatus.PASS
    assert res6.reason_code == "EVIDENCE_ABSENT"

    # 7. NOT_EXISTS + explicit True => FAIL / EVIDENCE_PRESENT
    res7 = ComplianceEngine.evaluate(req_ne_mand, [make_fact(True, field="debarment.status")], [])
    assert res7.status == ComplianceStatus.FAIL
    assert res7.reason_code == "EVIDENCE_PRESENT"

    # 8. NOT_EXISTS + verification unavailable => UNKNOWN / VERIFICATION_UNAVAILABLE
    ver_unavail = [make_verification(VerificationStatus.UNAVAILABLE, verified_value=None, field="debarment.status", ver_id="V1")]
    res8 = ComplianceEngine.evaluate(req_ne_mand, [], ver_unavail)
    assert res8.status == ComplianceStatus.UNKNOWN
    assert res8.reason_code == "VERIFICATION_UNAVAILABLE"

    # 9. NOT_EXISTS + malformed/ambiguous value => REVIEW_REQUIRED
    ver_ambig = [make_verification(VerificationStatus.VERIFIED, verified_value={"v1": 1, "v2": 2}, field="debarment.status", ver_id="V2")]
    res9a = ComplianceEngine.evaluate(req_ne_mand, [], ver_ambig)
    assert res9a.status == ComplianceStatus.REVIEW_REQUIRED
    assert res9a.reason_code == "AMBIGUOUS_VERIFIED_VALUE"

    res9b = ComplianceEngine.evaluate(req_ne_mand, [make_fact("arbitrary_string", field="debarment.status")], [])
    assert res9b.status == ComplianceStatus.REVIEW_REQUIRED
    assert res9b.reason_code == "TYPE_CONVERSION_ERROR"


def test_gst_requirement_vendor_name_case_sensitivity():
    # GST requirement with field "vendor.name": "Acme" vs "ACME" -> NOT automatically equal
    req = make_requirement(OperatorEnum.EQ, "ACME", field="vendor.name", req_type=RequirementType.GST)
    facts = [make_fact("Acme", field="vendor.name")]
    res = ComplianceEngine.evaluate(req, facts, [])
    assert res.status == ComplianceStatus.FAIL
    assert res.reason_code == "NOT_EQUAL"


def test_gst_status_case_insensitivity():
    # gst.status: "active" vs "ACTIVE" -> equal
    req = make_requirement(OperatorEnum.EQ, "ACTIVE", field="gst.status", req_type=RequirementType.GST)
    facts = [make_fact("active", field="gst.status")]
    res = ComplianceEngine.evaluate(req, facts, [])
    assert res.status == ComplianceStatus.PASS
    assert res.reason_code == "EQUAL"


def test_date_eq_valid_equivalent_and_malformed():
    # Valid equivalent representations (date-only) -> PASS
    req_eq = make_requirement(OperatorEnum.EQ, "2026-01-15", field="general.incorporation_date")
    facts_valid = [make_fact("2026-01-15", field="general.incorporation_date")]
    res_valid = ComplianceEngine.evaluate(req_eq, facts_valid, [])
    assert res_valid.status == ComplianceStatus.PASS

    # Malformed observed for EQ -> REVIEW_REQUIRED / MALFORMED_DATE
    facts_malformed = [make_fact("invalid-date", field="general.incorporation_date")]
    res_malformed_eq = ComplianceEngine.evaluate(req_eq, facts_malformed, [])
    assert res_malformed_eq.status == ComplianceStatus.REVIEW_REQUIRED
    assert res_malformed_eq.reason_code == "MALFORMED_DATE"

    # Malformed observed for NE -> REVIEW_REQUIRED / MALFORMED_DATE
    req_ne = make_requirement(OperatorEnum.NE, "2026-01-15", field="general.incorporation_date")
    res_malformed_ne = ComplianceEngine.evaluate(req_ne, facts_malformed, [])
    assert res_malformed_ne.status == ComplianceStatus.REVIEW_REQUIRED
    assert res_malformed_ne.reason_code == "MALFORMED_DATE"


def test_in_and_not_in_field_semantics():
    # IN on status field remains case-insensitive
    req_in_status = make_requirement(OperatorEnum.IN, ["ACTIVE", "SUSPENDED"], field="gst.status", req_type=RequirementType.GST)
    facts_status = [make_fact("active", field="gst.status")]
    res_in_s = ComplianceEngine.evaluate(req_in_status, facts_status, [])
    assert res_in_s.status == ComplianceStatus.PASS

    # IN on generic text field preserves case
    req_in_text = make_requirement(OperatorEnum.IN, ["ACME"], field="vendor.name", req_type=RequirementType.GST)
    facts_text = [make_fact("Acme", field="vendor.name")]
    res_in_t = ComplianceEngine.evaluate(req_in_text, facts_text, [])
    assert res_in_t.status == ComplianceStatus.FAIL

    # NOT_IN on generic text field preserves case
    req_notin_text = make_requirement(OperatorEnum.NOT_IN, ["ACME"], field="vendor.name", req_type=RequirementType.GST)
    res_notin_t = ComplianceEngine.evaluate(req_notin_text, facts_text, [])
    assert res_notin_t.status == ComplianceStatus.PASS


def test_type_aware_eq_and_ne_type_conversion_errors():
    # EQ expected bool + malformed string -> REVIEW_REQUIRED, TYPE_CONVERSION_ERROR
    req_eq_bool = make_requirement(OperatorEnum.EQ, False, field="cert.valid")
    res1 = ComplianceEngine.evaluate(req_eq_bool, [make_fact("maybe", field="cert.valid")], [])
    assert res1.status == ComplianceStatus.REVIEW_REQUIRED
    assert res1.reason_code == "TYPE_CONVERSION_ERROR"

    # NE expected bool + malformed string -> REVIEW_REQUIRED, TYPE_CONVERSION_ERROR
    req_ne_bool = make_requirement(OperatorEnum.NE, False, field="cert.valid")
    res2 = ComplianceEngine.evaluate(req_ne_bool, [make_fact("maybe", field="cert.valid")], [])
    assert res2.status == ComplianceStatus.REVIEW_REQUIRED
    assert res2.reason_code == "TYPE_CONVERSION_ERROR"

    # EQ expected numeric + malformed string -> REVIEW_REQUIRED, MALFORMED_NUMBER / TYPE_CONVERSION_ERROR
    req_eq_num = make_requirement(OperatorEnum.EQ, 100)
    res3 = ComplianceEngine.evaluate(req_eq_num, [make_fact("not-a-number")], [])
    assert res3.status == ComplianceStatus.REVIEW_REQUIRED
    assert res3.reason_code in ("TYPE_CONVERSION_ERROR", "MALFORMED_NUMBER")


def test_strict_structured_value_ambiguity():
    req = make_requirement(OperatorEnum.GTE, 100000000)

    ver_ambig = [make_verification(VerificationStatus.VERIFIED, verified_value={"value": 100000000, "verified_value": 90000000})]
    res_ambig = ComplianceEngine.evaluate(req, [make_fact(100000000)], ver_ambig)
    assert res_ambig.status == ComplianceStatus.REVIEW_REQUIRED
    assert res_ambig.reason_code == "AMBIGUOUS_VERIFIED_VALUE"

    ver_safe = [make_verification(VerificationStatus.VERIFIED, verified_value={"verified_value": 150000000, "unit": "INR"})]
    res_safe = ComplianceEngine.evaluate(req, [make_fact(150000000)], ver_safe)
    assert res_safe.status == ComplianceStatus.PASS
    assert res_safe.reason_code == "GREATER_THAN_OR_EQUAL"


def test_count_gte_integer_safety():
    req = make_requirement(OperatorEnum.COUNT_GTE, 3, field="projects")
    res_frac_obs = ComplianceEngine.evaluate(req, [make_fact(2.5, field="projects")], [])
    assert res_frac_obs.status == ComplianceStatus.REVIEW_REQUIRED
    assert res_frac_obs.reason_code == "TYPE_CONVERSION_ERROR"

    res_neg_obs = ComplianceEngine.evaluate(req, [make_fact(-1, field="projects")], [])
    assert res_neg_obs.status == ComplianceStatus.REVIEW_REQUIRED
    assert res_neg_obs.reason_code == "TYPE_CONVERSION_ERROR"

    req_neg_exp = make_requirement(OperatorEnum.COUNT_GTE, -3, field="projects")
    res_neg_exp = ComplianceEngine.evaluate(req_neg_exp, [make_fact(3, field="projects")], [])
    assert res_neg_exp.status == ComplianceStatus.REVIEW_REQUIRED
    assert res_neg_exp.reason_code == "TYPE_CONVERSION_ERROR"

    req_frac_exp = make_requirement(OperatorEnum.COUNT_GTE, 1.7, field="projects")
    res_frac_exp = ComplianceEngine.evaluate(req_frac_exp, [make_fact(3, field="projects")], [])
    assert res_frac_exp.status == ComplianceStatus.REVIEW_REQUIRED
    assert res_frac_exp.reason_code == "TYPE_CONVERSION_ERROR"


def test_actual_bid_verification_service_rollup_precedence():
    class MockEval:
        def __init__(self, status):
            self.status = status

    assert BidVerificationService.compute_overall_status([]) == ComplianceStatus.UNKNOWN

    assert BidVerificationService.compute_overall_status([MockEval(ComplianceStatus.PASS), MockEval(ComplianceStatus.UNKNOWN)]) == ComplianceStatus.UNKNOWN

    assert BidVerificationService.compute_overall_status([
        MockEval(ComplianceStatus.PASS),
        MockEval(ComplianceStatus.UNKNOWN),
        MockEval(ComplianceStatus.REVIEW_REQUIRED)
    ]) == ComplianceStatus.REVIEW_REQUIRED

    assert BidVerificationService.compute_overall_status([
        MockEval(ComplianceStatus.PASS),
        MockEval(ComplianceStatus.UNKNOWN),
        MockEval(ComplianceStatus.REVIEW_REQUIRED),
        MockEval(ComplianceStatus.FAIL)
    ]) == ComplianceStatus.FAIL


def test_numeric_normalization_and_indian_currency():
    req = make_requirement(OperatorEnum.EQ, 100000000)

    facts = [
        make_fact("₹10,00,00,000", fact_id="F1"),
        make_fact("10,00,00,000", fact_id="F2"),
        make_fact(100000000, fact_id="F3"),
    ]
    res = ComplianceEngine.evaluate(req, facts, [])
    assert res.status == ComplianceStatus.PASS
    assert res.reason_code == "EQUAL"


def test_timezone_aware_date_comparison():
    req = make_requirement(OperatorEnum.DATE_BEFORE, "2026-01-15T12:00:00Z", field="general.incorporation_date")
    facts = [make_fact("2026-01-15T16:00:00+05:30", field="general.incorporation_date")]
    res = ComplianceEngine.evaluate(req, facts, [])
    assert res.status == ComplianceStatus.PASS


def test_unsupported_operator_behavior():
    req = make_requirement(OperatorEnum.EQ, 100)
    req.operator = "INVALID_OPERATOR"
    res = ComplianceEngine.evaluate(req, [make_fact(100)], [])
    assert res.status == ComplianceStatus.UNKNOWN
    assert res.reason_code == "UNSUPPORTED_OPERATOR"


def test_gst_structured_verification_pass():
    req = make_requirement(OperatorEnum.EXISTS, True, field="tax.gstin", mandatory=True)
    fact = make_fact("29ABCDE5678K1Z1", field="tax.gstin", fact_id="FACT-GST-1")
    ver = make_verification(
        VerificationStatus.VERIFIED,
        verified_value={"status": "ACTIVE", "verified_entity": "Surya Tech Energy Solutions Pvt Ltd"},
        field="tax.gstin",
        ver_id="VER-GST-1",
        claimed_value="29ABCDE5678K1Z1",
    )
    res = ComplianceEngine.evaluate(req, [fact], [ver])
    assert res.status == ComplianceStatus.PASS
    assert res.reason_code == "EVIDENCE_EXISTS"
    assert "FACT-GST-1" in res.evidence_ids
    assert "VER-GST-1" in res.evidence_ids
    assert isinstance(res.observed_value, dict)
    assert res.observed_value["claimed"] == "29ABCDE5678K1Z1"


def test_gst_verification_mismatch_review_required():
    req = make_requirement(OperatorEnum.EXISTS, True, field="tax.gstin", mandatory=True)
    fact = make_fact("29ABCDE5678K1Z1", field="tax.gstin", fact_id="FACT-GST-1")
    ver = make_verification(
        VerificationStatus.MISMATCH,
        verified_value={"status": "ACTIVE", "verified_entity": "Different Entity"},
        field="tax.gstin",
        ver_id="VER-GST-1",
        claimed_value="29ABCDE5678K1Z1",
    )
    res = ComplianceEngine.evaluate(req, [fact], [ver])
    assert res.status == ComplianceStatus.REVIEW_REQUIRED
    assert res.reason_code in ("CLAIM_VERIFICATION_MISMATCH", "VERIFICATION_MISMATCH")


def test_gst_verification_unavailable_unknown():
    req = make_requirement(OperatorEnum.EXISTS, True, field="tax.gstin", mandatory=True)
    fact = make_fact("29ABCDE5678K1Z1", field="tax.gstin", fact_id="FACT-GST-1")
    ver = make_verification(
        VerificationStatus.UNAVAILABLE,
        verified_value=None,
        field="tax.gstin",
        ver_id="VER-GST-1",
        claimed_value="29ABCDE5678K1Z1",
    )
    res = ComplianceEngine.evaluate(req, [fact], [ver])
    assert res.status == ComplianceStatus.UNKNOWN
    assert res.reason_code == "VERIFICATION_UNAVAILABLE"


def test_gst_missing_evidence_unknown():
    req = make_requirement(OperatorEnum.EXISTS, True, field="tax.gstin", mandatory=True)
    res = ComplianceEngine.evaluate(req, [], [])
    assert res.status == ComplianceStatus.UNKNOWN
    assert res.reason_code == "MISSING_EVIDENCE"


def test_turnover_with_parenthetical_qualifier_gte_pass():
    req = make_requirement(OperatorEnum.GTE, 85000000, field="financial.average_annual_turnover")
    fact = make_fact("Rs. 11.6 crore (3-year average)", field="financial.average_annual_turnover")
    res = ComplianceEngine.evaluate(req, [fact], [])
    assert res.status == ComplianceStatus.PASS
    assert res.reason_code == "GREATER_THAN_OR_EQUAL"


def test_turnover_crore_comparison_lte_fail():
    req = make_requirement(OperatorEnum.GTE, "₹8.5 crore", field="financial.average_annual_turnover")
    fact = make_fact("₹7 crore", field="financial.average_annual_turnover")
    res = ComplianceEngine.evaluate(req, [fact], [])
    assert res.status == ComplianceStatus.FAIL
    assert res.reason_code == "LESS_THAN"


def test_non_exists_operator_on_structured_verified_value_fails_closed():
    req = make_requirement(OperatorEnum.EQ, "Surya Tech", field="company.profile")
    fact = make_fact("Surya Tech", field="company.profile")
    ver = make_verification(
        VerificationStatus.VERIFIED,
        verified_value={"status": "ACTIVE", "verified_entity": "Surya Tech"},
        field="company.profile",
        ver_id="VER-PROF-1",
        claimed_value="Surya Tech",
    )
    res = ComplianceEngine.evaluate(req, [fact], [ver])
    assert res.status == ComplianceStatus.REVIEW_REQUIRED
    assert res.reason_code == "AMBIGUOUS_VERIFIED_VALUE"


def test_gst_pass_does_not_imply_gem_registration_pass():
    req_gst = make_requirement(OperatorEnum.EXISTS, True, field="tax.gstin", mandatory=True)
    req_gem = make_requirement(OperatorEnum.EXISTS, True, field="gem.seller_id", mandatory=True)

    gst_fact = make_fact("29ABCDE5678K1Z1", field="tax.gstin", fact_id="FACT-GST-1")
    gst_ver = make_verification(
        VerificationStatus.VERIFIED,
        verified_value={"status": "ACTIVE", "verified_entity": "Surya Tech"},
        field="tax.gstin",
        ver_id="VER-GST-1",
        claimed_value="29ABCDE5678K1Z1",
    )

    eval_gst = ComplianceEngine.evaluate(req_gst, [gst_fact], [gst_ver])
    eval_gem = ComplianceEngine.evaluate(req_gem, [gst_fact], [gst_ver])

    assert eval_gst.status == ComplianceStatus.PASS
    assert eval_gst.reason_code == "EVIDENCE_EXISTS"

    assert eval_gem.status == ComplianceStatus.UNKNOWN
    assert eval_gem.reason_code == "MISSING_EVIDENCE"
    assert eval_gem.status != ComplianceStatus.PASS


def test_two_requirements_from_same_source_clause_evaluated_independently():
    req_gst = make_requirement(OperatorEnum.EXISTS, True, field="tax.gstin", mandatory=True)
    req_gem = make_requirement(OperatorEnum.EXISTS, True, field="gem.seller_id", mandatory=True)

    # Case A: Bidder only has GST evidence
    gst_fact = make_fact("29ABCDE5678K1Z1", field="tax.gstin")
    gst_ver = make_verification(
        VerificationStatus.VERIFIED,
        verified_value={"status": "ACTIVE"},
        field="tax.gstin",
        claimed_value="29ABCDE5678K1Z1",
    )

    res_gst_a = ComplianceEngine.evaluate(req_gst, [gst_fact], [gst_ver])
    res_gem_a = ComplianceEngine.evaluate(req_gem, [gst_fact], [gst_ver])
    assert res_gst_a.status == ComplianceStatus.PASS
    assert res_gem_a.status == ComplianceStatus.UNKNOWN

    # Case B: Bidder provides both GST and verified GeM seller evidence
    gem_fact = make_fact("GEM-SELLER-998811", field="gem.seller_id")
    gem_ver = make_verification(
        VerificationStatus.VERIFIED,
        verified_value={"status": "ACTIVE"},
        field="gem.seller_id",
        ver_id="VER-GEM-1",
    )
    all_facts = [gst_fact, gem_fact]
    all_ver = [gst_ver, gem_ver]

    res_gst_b = ComplianceEngine.evaluate(req_gst, all_facts, all_ver)
    res_gem_b = ComplianceEngine.evaluate(req_gem, all_facts, all_ver)
    assert res_gst_b.status == ComplianceStatus.PASS
    assert res_gem_b.status == ComplianceStatus.PASS
    assert res_gem_b.reason_code == "EVIDENCE_EXISTS"


def test_fake_gem_id_without_verification_not_pass():
    # 1. Claim-only fake seller ID without verification -> NOT PASS
    req_gem = make_requirement(OperatorEnum.EXISTS, True, field="gem.seller_id", mandatory=True)
    fake_fact = make_fact("FAKE123", field="gem.seller_id")
    res_claim_only = ComplianceEngine.evaluate(req_gem, [fake_fact], [])
    assert res_claim_only.status != ComplianceStatus.PASS
    assert res_claim_only.status == ComplianceStatus.REVIEW_REQUIRED
    assert res_claim_only.reason_code == "VERIFICATION_UNAVAILABLE"

    # 2. No GeM evidence at all -> NOT PASS (UNKNOWN / MISSING_EVIDENCE)
    res_no_evidence = ComplianceEngine.evaluate(req_gem, [], [])
    assert res_no_evidence.status != ComplianceStatus.PASS
    assert res_no_evidence.status == ComplianceStatus.UNKNOWN
    assert res_no_evidence.reason_code == "MISSING_EVIDENCE"

    # 3. Provider-backed verified GeM evidence -> PASS
    gem_ver = make_verification(
        VerificationStatus.VERIFIED,
        verified_value={"status": "ACTIVE"},
        field="gem.seller_id",
    )
    res_verified = ComplianceEngine.evaluate(req_gem, [fake_fact], [gem_ver])
    assert res_verified.status == ComplianceStatus.PASS
    assert res_verified.reason_code == "EVIDENCE_EXISTS"

    # 4. Trusted documentary registration proof -> PASS
    doc_fact = make_fact("GEM-SELLER-998811", field="gem.seller_id", meta={"document_type": "GEM_CERTIFICATE"})
    res_doc = ComplianceEngine.evaluate(req_gem, [doc_fact], [])
    assert res_doc.status == ComplianceStatus.PASS
    assert res_doc.reason_code == "EVIDENCE_EXISTS"


def test_overall_report_preserves_both_evaluations():
    req_gst = make_requirement(OperatorEnum.EXISTS, True, field="tax.gstin", mandatory=True)
    setattr(req_gst, "clause", "2.1(a)")
    req_gem = make_requirement(OperatorEnum.EXISTS, True, field="gem.seller_id", mandatory=True)
    setattr(req_gem, "clause", "2.1(b)")

    gst_fact = make_fact("29ABCDE5678K1Z1", field="tax.gstin")
    gst_ver = make_verification(
        VerificationStatus.VERIFIED,
        verified_value={"status": "ACTIVE"},
        field="tax.gstin",
        claimed_value="29ABCDE5678K1Z1",
    )

    eval_gst = ComplianceEngine.evaluate(req_gst, [gst_fact], [gst_ver])
    eval_gem = ComplianceEngine.evaluate(req_gem, [gst_fact], [gst_ver])

    evaluations = [eval_gst, eval_gem]
    assert len(evaluations) == 2
    assert evaluations[0].requirement_id == req_gst.id
    assert evaluations[0].status == ComplianceStatus.PASS
    assert evaluations[1].requirement_id == req_gem.id
    assert evaluations[1].status == ComplianceStatus.UNKNOWN


def test_missing_gem_evidence_cannot_silently_become_pass():
    req_gem = make_requirement(OperatorEnum.EXISTS, True, field="gem.seller_id", mandatory=True)
    irrelevant_fact = make_fact("random value", field="custom.irrelevant")

    res = ComplianceEngine.evaluate(req_gem, [irrelevant_fact], [])
    assert res.status == ComplianceStatus.UNKNOWN
    assert res.reason_code == "MISSING_EVIDENCE"
    assert res.status != ComplianceStatus.PASS


def test_existing_gst_and_turnover_fixes_remain_pass():
    # GST
    req_gst = make_requirement(OperatorEnum.EXISTS, True, field="tax.gstin", mandatory=True)
    fact_gst = make_fact("29ABCDE5678K1Z1", field="tax.gstin")
    ver_gst = make_verification(
        VerificationStatus.VERIFIED,
        verified_value={"status": "ACTIVE", "verified_entity": "Surya Tech"},
        field="tax.gstin",
        claimed_value="29ABCDE5678K1Z1",
    )
    res_gst = ComplianceEngine.evaluate(req_gst, [fact_gst], [ver_gst])
    assert res_gst.status == ComplianceStatus.PASS
    assert res_gst.reason_code == "EVIDENCE_EXISTS"

    # Turnover
    req_turnover = make_requirement(OperatorEnum.GTE, 85000000, field="financial.average_annual_turnover")
    fact_turnover_a = make_fact("Rs. 11.6 crore (3-year average)", field="financial.average_annual_turnover")
    fact_turnover_b = make_fact(116000000, field="financial.average_annual_turnover")
    res_turnover = ComplianceEngine.evaluate(req_turnover, [fact_turnover_a, fact_turnover_b], [])
    assert res_turnover.status == ComplianceStatus.PASS
    assert res_turnover.reason_code == "GREATER_THAN_OR_EQUAL"

