import io
import os
import re
import difflib
import logging
from typing import List, Dict, Any, Tuple
import pandas as pd

from app.schemas.bulk_import import ImportTargetEntity, ColumnMappingSuggestion, TARGET_SCHEMA_REGISTRY

logger = logging.getLogger("rexera.bulk_import.parser")

UPLOAD_TEMP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "temp_imports")
os.makedirs(UPLOAD_TEMP_DIR, exist_ok=True)


class ImportParserService:
    @staticmethod
    def _normalize_string(text: str) -> str:
        return re.sub(r"[^a-zA-Z0-9]", "", str(text)).lower()

    @classmethod
    def calculate_fuzzy_match(cls, header: str, db_field: str, field_meta: Dict[str, Any]) -> float:
        norm_header = cls._normalize_string(header)
        candidates = [db_field, field_meta.get("label", "")] + field_meta.get("aliases", [])
        
        best_score = 0.0
        for cand in candidates:
            norm_cand = cls._normalize_string(cand)
            if norm_header == norm_cand:
                return 1.0
            
            score = difflib.SequenceMatcher(None, norm_header, norm_cand).ratio()
            if score > best_score:
                best_score = score

        return round(best_score, 2)

    @classmethod
    def auto_map_headers(
        cls,
        file_headers: List[str],
        target_entity: ImportTargetEntity,
        sample_rows: List[Dict[str, Any]]
    ) -> List[ColumnMappingSuggestion]:
        registry = TARGET_SCHEMA_REGISTRY.get(target_entity, {}).get("fields", {})
        suggestions: List[ColumnMappingSuggestion] = []
        used_db_fields = set()

        for header in file_headers:
            best_field = None
            best_score = 0.0
            
            for db_field, meta in registry.items():
                if db_field in used_db_fields:
                    continue
                score = cls.calculate_fuzzy_match(header, db_field, meta)
                if score > best_score:
                    best_score = score
                    best_field = db_field

            suggested_field = best_field if best_score >= 0.65 else None
            if suggested_field:
                used_db_fields.add(suggested_field)

            samples = [str(row.get(header, "")) for row in sample_rows[:3] if row.get(header) is not None]
            is_req = registry.get(suggested_field, {}).get("required", False) if suggested_field else False

            suggestions.append(ColumnMappingSuggestion(
                file_header=header,
                suggested_db_field=suggested_field,
                confidence_score=best_score,
                is_required=is_req,
                sample_values=samples
            ))

        return suggestions

    @classmethod
    def parse_uploaded_file(cls, file_bytes: bytes, filename: str) -> Tuple[List[str], List[Dict[str, Any]], int]:
        ext = filename.split(".")[-1].lower()
        if ext == "csv":
            try:
                df = pd.read_csv(io.BytesIO(file_bytes), dtype=str, keep_default_na=False)
            except Exception:
                df = pd.read_csv(io.BytesIO(file_bytes), encoding="latin1", dtype=str, keep_default_na=False)
        elif ext in ["xlsx", "xls"]:
            df = pd.read_excel(io.BytesIO(file_bytes), dtype=str, keep_default_na=False)
        else:
            raise ValueError("Unsupported file format. Please upload .csv, .xls, or .xlsx.")

        df.columns = [str(c).strip() for c in df.columns]
        total_rows = len(df)
        records = df.to_dict(orient="records")
        headers = list(df.columns)

        return headers, records, total_rows
