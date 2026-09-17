"""Canonical money and financial amount parser for Argus compliance and risk engines.

Provides exact Decimal arithmetic, safe multi-scale handling (Indian and international),
context-aware unit/currency detection, and robust tolerance to parenthetical notes.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from app.compliance.reason_codes import ReasonCode

UNIT_SCALE_MAP: dict[str, tuple[Decimal, str]] = {
    "crore": (Decimal("10000000"), "Crore"),
    "crores": (Decimal("10000000"), "Crore"),
    "cr": (Decimal("10000000"), "Crore"),
    "cr.": (Decimal("10000000"), "Crore"),
    "lakh": (Decimal("100000"), "Lakh"),
    "lakhs": (Decimal("100000"), "Lakh"),
    "lac": (Decimal("100000"), "Lakh"),
    "lacs": (Decimal("100000"), "Lakh"),
    "l": (Decimal("100000"), "Lakh"),
    "thousand": (Decimal("1000"), "Thousand"),
    "thousands": (Decimal("1000"), "Thousand"),
    "k": (Decimal("1000"), "Thousand"),
    "million": (Decimal("1000000"), "Million"),
    "millions": (Decimal("1000000"), "Million"),
    "mn": (Decimal("1000000"), "Million"),
    "m": (Decimal("1000000"), "Million"),
    "billion": (Decimal("1000000000"), "Billion"),
    "billions": (Decimal("1000000000"), "Billion"),
    "bn": (Decimal("1000000000"), "Billion"),
    "b": (Decimal("1000000000"), "Billion"),
}

MAX_INPUT_STR_LENGTH = 100
MAX_DECIMAL_DIGITS = 38
MAX_DECIMAL_EXPONENT = 30


@dataclass(frozen=True)
class FinancialContext:
    """Typed financial and numeric context for exact, safe comparisons."""

    raw_value: Any
    base_decimal_value: Decimal | None
    currency: str | None
    scale_token: str | None
    scale_multiplier: Decimal
    metric: str | None
    financial_year: str | None
    averaging_period: str | None
    is_base_unit: bool
    is_valid: bool
    error_reason: str | None = None


def validate_comma_formatting(s: str) -> bool:
    """Validates that commas follow standard Western or Indian numeral grouping without corruption."""
    if "," not in s:
        return True
    if ",," in s or s.startswith(",") or s.endswith(","):
        return False
    parts = s.split(".")
    if len(parts) > 2:
        return False
    int_part = parts[0]
    if len(parts) == 2 and "," in parts[1]:
        return False
    western_pattern = r"^\d{1,3}(,\d{3})*$"
    indian_pattern = r"^\d{1,2}(,\d{2})*,\d{3}$"
    return bool(re.match(western_pattern, int_part) or re.match(indian_pattern, int_part))


def _parse_boolean_strict(val: Any) -> bool | None:
    """Strictly parses canonical booleans."""
    if val is None:
        return None
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, Decimal)):
        if val == 1:
            return True
        if val == 0:
            return False
        return None
    if isinstance(val, str):
        s = val.strip().lower()
        if s in ("true", "1", "yes"):
            return True
        if s in ("false", "0", "no"):
            return False
        return None
    return None


def parse_financial_context(
    val: Any, meta: dict[str, Any] | None = None, default_unit: str | None = None
) -> FinancialContext:
    """Parses a typed FinancialContext from a raw value and its metadata.

    Derives scale from explicit representation only. Never blindly applies rule default_unit to inputs.
    Recognizes already-normalized base-unit values and avoids double scaling.
    Safely extracts numeric tokens without failing on trailing context like '(3-year average)'.
    Rejects unrecognized words like 'Member', 'September', etc. as MALFORMED_NUMBER.
    """
    meta = meta or {}
    if val is None:
        return FinancialContext(
            raw_value=val,
            base_decimal_value=None,
            currency=meta.get("currency"),
            scale_token=None,
            scale_multiplier=Decimal("1"),
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=False,
            is_valid=False,
            error_reason=ReasonCode.OBSERVED_VALUE_NULL,
        )

    if isinstance(val, bool):
        return FinancialContext(
            raw_value=val,
            base_decimal_value=None,
            currency=meta.get("currency"),
            scale_token=None,
            scale_multiplier=Decimal("1"),
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=False,
            is_valid=False,
            error_reason=ReasonCode.TYPE_CONVERSION_ERROR,
        )

    val_str = str(val).strip()
    if len(val_str) > MAX_INPUT_STR_LENGTH:
        return FinancialContext(
            raw_value=val,
            base_decimal_value=None,
            currency=meta.get("currency"),
            scale_token=None,
            scale_multiplier=Decimal("1"),
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=False,
            is_valid=False,
            error_reason=ReasonCode.MALFORMED_NUMBER,
        )

    val_lower = val_str.lower()
    if val_lower in ("nan", "inf", "-inf", "+inf", "infinity", "-infinity", "+infinity"):
        return FinancialContext(
            raw_value=val,
            base_decimal_value=None,
            currency=meta.get("currency"),
            scale_token=None,
            scale_multiplier=Decimal("1"),
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=False,
            is_valid=False,
            error_reason=ReasonCode.MALFORMED_NUMBER,
        )

    # 1. Currency resolution
    meta_curr = meta.get("currency")
    input_meta_unit = meta.get("unit") or default_unit
    if not meta_curr and input_meta_unit and isinstance(input_meta_unit, str):
        unit_u = input_meta_unit.upper()
        if "INR" in unit_u or "RS" in unit_u or "₹" in input_meta_unit:
            meta_curr = "INR"
        elif "USD" in unit_u or "$" in input_meta_unit:
            meta_curr = "USD"
        elif "EUR" in unit_u or "€" in input_meta_unit:
            meta_curr = "EUR"
        elif "GBP" in unit_u or "£" in input_meta_unit:
            meta_curr = "GBP"

    text_curr = None
    if "$" in val_str or re.search(r"\b(usd)\b", val_lower):
        text_curr = "USD"
    elif "₹" in val_str or re.search(r"\b(inr|rs\.?|rupees?)\b", val_lower):
        text_curr = "INR"
    elif "€" in val_str or re.search(r"\b(eur|euros?)\b", val_lower):
        text_curr = "EUR"
    elif "£" in val_str or re.search(r"\b(gbp|pounds?)\b", val_lower):
        text_curr = "GBP"

    # Check currency contradiction between metadata and text
    if meta_curr and text_curr and meta_curr.upper() != text_curr.upper():
        return FinancialContext(
            raw_value=val,
            base_decimal_value=None,
            currency=meta_curr,
            scale_token=None,
            scale_multiplier=Decimal("1"),
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=False,
            is_valid=False,
            error_reason=ReasonCode.CURRENCY_MISMATCH,
        )

    resolved_currency = (meta_curr or text_curr or "").upper() or None

    # 2. Base-unit representation check
    is_base_unit = False
    has_explicit_base_flag = False
    for flag_name in ("is_base_unit", "normalized", "is_normalized"):
        if flag_name in meta and meta[flag_name] is not None:
            parsed_flag = _parse_boolean_strict(meta[flag_name])
            if parsed_flag is None:
                return FinancialContext(
                    raw_value=val,
                    base_decimal_value=None,
                    currency=resolved_currency,
                    scale_token=None,
                    scale_multiplier=Decimal("1"),
                    metric=meta.get("metric"),
                    financial_year=meta.get("financial_year") or meta.get("fy"),
                    averaging_period=meta.get("averaging_period") or meta.get("period"),
                    is_base_unit=False,
                    is_valid=False,
                    error_reason=ReasonCode.MALFORMED_NUMBER,
                )
            has_explicit_base_flag = True
            if parsed_flag is True:
                is_base_unit = True

    if not has_explicit_base_flag and meta.get("unit"):
        unit_str_val = str(meta.get("unit")).strip().upper()
        if unit_str_val in ("INR", "USD", "EUR", "GBP", "BASE", "UNITS"):
            is_base_unit = True

    # 3. Scale resolution from metadata
    meta_scale = Decimal("1")
    canonical_meta_unit = None
    if input_meta_unit and isinstance(input_meta_unit, str) and not is_base_unit:
        unit_clean = input_meta_unit.lower().strip()
        for c_token in ("inr", "usd", "eur", "gbp", "₹", "$", "€", "£"):
            unit_clean = unit_clean.replace(c_token, "").strip()
        if unit_clean in UNIT_SCALE_MAP:
            meta_scale, canonical_meta_unit = UNIT_SCALE_MAP[unit_clean]
        elif unit_clean:
            return FinancialContext(
                raw_value=val,
                base_decimal_value=None,
                currency=resolved_currency,
                scale_token=input_meta_unit.strip(),
                scale_multiplier=Decimal("1"),
                metric=meta.get("metric"),
                financial_year=meta.get("financial_year") or meta.get("fy"),
                averaging_period=meta.get("averaging_period") or meta.get("period"),
                is_base_unit=is_base_unit,
                is_valid=False,
                error_reason=ReasonCode.UNIT_MISMATCH,
            )

    # 4. Scale resolution from text
    text_scale = Decimal("1")
    canonical_text_unit = None
    for scale_token, (scale_factor, canon_name) in sorted(UNIT_SCALE_MAP.items(), key=lambda x: -len(x[0])):
        pattern = r"\b" + re.escape(scale_token) + r"\b"
        if re.search(pattern, val_lower):
            text_scale = scale_factor
            canonical_text_unit = canon_name
            break

    # Check scale contradiction between metadata and text
    if (
        canonical_meta_unit
        and canonical_text_unit
        and canonical_meta_unit.lower() != canonical_text_unit.lower()
    ):
        return FinancialContext(
            raw_value=val,
            base_decimal_value=None,
            currency=resolved_currency,
            scale_token=canonical_meta_unit,
            scale_multiplier=Decimal("1"),
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=is_base_unit,
            is_valid=False,
            error_reason=ReasonCode.UNIT_MISMATCH,
        )

    resolved_scale_token = canonical_text_unit or canonical_meta_unit
    if is_base_unit:
        scale_multiplier = Decimal("1")
    else:
        scale_multiplier = text_scale if canonical_text_unit else (meta_scale if canonical_meta_unit else Decimal("1"))

    # 5. Extract numeric candidate without failing on trailing context
    clean_s = val_str

    # A) Remove parenthetical context (e.g. '(3-year average)', '(FY 2023-24)')
    clean_s = re.sub(r"\([^)]*\)", " ", clean_s)

    # B) Remove currency symbols and keywords
    for sym in ("₹", "$", "€", "£"):
        clean_s = clean_s.replace(sym, " ")
    clean_s = re.sub(r"(?i)\b(inr|usd|eur|gbp|rupees?)\b", " ", clean_s)
    clean_s = re.sub(r"(?i)\brs\b\.?", " ", clean_s)

    # C) Remove scale keywords
    clean_s = re.sub(r"(?i)\b(crores?|cr\.?|lakhs?|lacs?|thousand|thousands|k|million|millions|mn|billion|billions|bn)\b", " ", clean_s)
    clean_s = re.sub(r"(?i)\b(m|b)\b", " ", clean_s)

    # D) Remove allowed financial qualifiers
    clean_s = re.sub(r"(?i)\b(per\s+annum|p\.a\.?|pa|annual|annually|average|turnover|fy\s*\d{2,4}(?:-\d{2,4})?)\b", " ", clean_s)

    # E) Reject corrupt multi-dots like 11..6
    if re.search(r"\d+\.\.+|\.\.+\d+", clean_s):
        return FinancialContext(
            raw_value=val,
            base_decimal_value=None,
            currency=resolved_currency,
            scale_token=resolved_scale_token,
            scale_multiplier=scale_multiplier,
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=is_base_unit,
            is_valid=False,
            error_reason=ReasonCode.MALFORMED_NUMBER,
        )

    # F) Reject if any unpermitted letters remain (e.g. 'Member', 'September', 'Mobile')
    leftover_letters = re.sub(r"[\d,._\-\s]", "", clean_s)
    if leftover_letters:
        return FinancialContext(
            raw_value=val,
            base_decimal_value=None,
            currency=resolved_currency,
            scale_token=resolved_scale_token,
            scale_multiplier=scale_multiplier,
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=is_base_unit,
            is_valid=False,
            error_reason=ReasonCode.MALFORMED_NUMBER,
        )

    # Extract numeric token (supporting optional commas and decimal fraction)
    m = re.search(r"([\d,]+(?:\.\d+)?)", clean_s)
    if not m:
        return FinancialContext(
            raw_value=val,
            base_decimal_value=None,
            currency=resolved_currency,
            scale_token=resolved_scale_token,
            scale_multiplier=scale_multiplier,
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=is_base_unit,
            is_valid=False,
            error_reason=ReasonCode.MALFORMED_NUMBER,
        )

    num_cand = m.group(1)
    if not validate_comma_formatting(num_cand):
        return FinancialContext(
            raw_value=val,
            base_decimal_value=None,
            currency=resolved_currency,
            scale_token=resolved_scale_token,
            scale_multiplier=scale_multiplier,
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=is_base_unit,
            is_valid=False,
            error_reason=ReasonCode.MALFORMED_NUMBER,
        )

    num_raw = num_cand.replace(",", "").strip()
    try:
        base_dec = Decimal(num_raw)
        if base_dec.is_nan() or base_dec.is_infinite():
            return FinancialContext(
                raw_value=val,
                base_decimal_value=None,
                currency=resolved_currency,
                scale_token=resolved_scale_token,
                scale_multiplier=scale_multiplier,
                metric=meta.get("metric"),
                financial_year=meta.get("financial_year") or meta.get("fy"),
                averaging_period=meta.get("averaging_period") or meta.get("period"),
                is_base_unit=is_base_unit,
                is_valid=False,
                error_reason=ReasonCode.MALFORMED_NUMBER,
            )
        if abs(base_dec.as_tuple().exponent) > MAX_DECIMAL_EXPONENT or len(base_dec.as_tuple().digits) > MAX_DECIMAL_DIGITS:
            return FinancialContext(
                raw_value=val,
                base_decimal_value=None,
                currency=resolved_currency,
                scale_token=resolved_scale_token,
                scale_multiplier=scale_multiplier,
                metric=meta.get("metric"),
                financial_year=meta.get("financial_year") or meta.get("fy"),
                averaging_period=meta.get("averaging_period") or meta.get("period"),
                is_base_unit=is_base_unit,
                is_valid=False,
                error_reason=ReasonCode.MALFORMED_NUMBER,
            )

        scaled_base_value = base_dec * scale_multiplier
        return FinancialContext(
            raw_value=val,
            base_decimal_value=scaled_base_value,
            currency=resolved_currency,
            scale_token=resolved_scale_token,
            scale_multiplier=scale_multiplier,
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=is_base_unit,
            is_valid=True,
            error_reason=None,
        )
    except (InvalidOperation, ValueError):
        return FinancialContext(
            raw_value=val,
            base_decimal_value=None,
            currency=resolved_currency,
            scale_token=resolved_scale_token,
            scale_multiplier=scale_multiplier,
            metric=meta.get("metric"),
            financial_year=meta.get("financial_year") or meta.get("fy"),
            averaging_period=meta.get("averaging_period") or meta.get("period"),
            is_base_unit=is_base_unit,
            is_valid=False,
            error_reason=ReasonCode.MALFORMED_NUMBER,
        )
