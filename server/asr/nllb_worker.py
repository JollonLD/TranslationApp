#!/usr/bin/env python3
"""Local NLLB 600M for any church language pair.

Protocol: one JSON object per stdin line
  {"id":"1","text":"...","source":"pt","target":"fa"}
Reply on stdout:
  {"id":"1","text":"..."}
First line after load: {"ready": true} or {"ready": false, "error": "..."}.

Uses a CTranslate2 model dir when NLLB_CT2_DIR is set and the package imports.
Otherwise Hugging Face transformers (facebook/nllb-200-distilled-600M).
"""
from __future__ import annotations

import json
import os
import sys

LANG = {
    "pt": "por_Latn",
    "en": "eng_Latn",
    "es": "spa_Latn",
    "it": "ita_Latn",
    "fa": "pes_Arab",
    "ur": "urd_Arab",
}

MODEL_ID = os.environ.get("NLLB_MODEL", "facebook/nllb-200-distilled-600M")


def emit(payload: dict) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class Translator:
    def translate(self, text: str, source: str, target: str) -> str:
        raise NotImplementedError


class TransformersTranslator(Translator):
    def __init__(self) -> None:
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

        local = os.path.isdir(MODEL_ID)
        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, local_files_only=local)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID, local_files_only=local)
        self.model.eval()

    def translate(self, text: str, source: str, target: str) -> str:
        self.tokenizer.src_lang = LANG[source]
        encoded = self.tokenizer(text, return_tensors="pt", truncation=True, max_length=512)
        forced = self.tokenizer.convert_tokens_to_ids(LANG[target])
        out = self.model.generate(
            **encoded,
            forced_bos_token_id=forced,
            max_new_tokens=256,
        )
        return self.tokenizer.batch_decode(out, skip_special_tokens=True)[0].strip()


class CTranslate2Translator(Translator):
    def __init__(self, model_dir: str) -> None:
        import ctranslate2
        from transformers import AutoTokenizer

        self.tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
        self.translator = ctranslate2.Translator(model_dir, device="cpu")

    def translate(self, text: str, source: str, target: str) -> str:
        self.tokenizer.src_lang = LANG[source]
        ids = self.tokenizer.encode(text, truncation=True, max_length=512)
        tokens = self.tokenizer.convert_ids_to_tokens(ids)
        tgt = LANG[target]
        result = self.translator.translate_batch(
            [tokens],
            target_prefix=[[tgt]],
            beam_size=2,
        )
        decoded = self.tokenizer.decode(
            self.tokenizer.convert_tokens_to_ids(result[0].hypotheses[0]),
            skip_special_tokens=True,
        )
        return decoded.strip()


def load() -> Translator:
    ct2_dir = os.environ.get("NLLB_CT2_DIR", "").strip()
    if ct2_dir:
        try:
            return CTranslate2Translator(ct2_dir)
        except Exception as exc:
            sys.stderr.write(f"ctranslate2 unavailable ({exc}); using transformers\n")
    return TransformersTranslator()


def main() -> int:
    try:
        engine = load()
    except Exception as exc:
        emit({"ready": False, "error": str(exc)})
        return 1

    emit({"ready": True})
    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
            source = str(job.get("source") or "")
            target = str(job.get("target") or "")
            text = str(job.get("text") or "").strip()
            job_id = job.get("id")
            if source not in LANG or target not in LANG or not text:
                emit({"id": job_id, "text": "", "error": "bad job"})
                continue
            if source == target:
                emit({"id": job_id, "text": text})
                continue
            emit({"id": job_id, "text": engine.translate(text, source, target)})
        except Exception as exc:
            emit({"id": None, "text": "", "error": str(exc)})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
