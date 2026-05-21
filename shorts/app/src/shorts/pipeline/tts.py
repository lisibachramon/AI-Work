"""Voice-over synthesis via Coqui XTTS-v2 (multilingual, offline).

Model weights are stored under SHORTS_TTS_MODELS_DIR so they're not
re-downloaded on container restart. First run downloads ~2 GB.
"""

from __future__ import annotations

from pathlib import Path

# Map our locales to XTTS language codes.
LOCALE_TO_TTS_LANG = {"de": "de", "en-US": "en", "es": "es", "in": "hi"}


class XTTSVoice:
    """Lazy XTTS wrapper. The TTS package is heavy — import only when called."""

    MODEL_NAME = "tts_models/multilingual/multi-dataset/xtts_v2"

    def __init__(self, models_dir: Path) -> None:
        self.models_dir = models_dir
        self._tts = None

    def _load(self):
        if self._tts is not None:
            return self._tts
        import os

        os.environ.setdefault("COQUI_TOS_AGREED", "1")
        os.environ.setdefault("TTS_HOME", str(self.models_dir))
        from TTS.api import TTS  # type: ignore[import-not-found]

        self._tts = TTS(model_name=self.MODEL_NAME, progress_bar=False)
        return self._tts

    def synthesize(self, *, text: str, locale: str, out_path: Path, speaker_wav: Path | None = None) -> Path:
        lang = LOCALE_TO_TTS_LANG.get(locale, "en")
        tts = self._load()
        out_path.parent.mkdir(parents=True, exist_ok=True)
        kwargs: dict = {"text": text, "language": lang, "file_path": str(out_path)}
        if speaker_wav is not None:
            kwargs["speaker_wav"] = str(speaker_wav)
        else:
            # XTTS ships built-in speakers; "Daisy Studious" is a clean neutral one.
            kwargs["speaker"] = "Daisy Studious"
        tts.tts_to_file(**kwargs)
        return out_path
