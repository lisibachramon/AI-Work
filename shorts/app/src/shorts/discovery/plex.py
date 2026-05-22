"""Plex sampler for B-roll. Picks random 6-10s windows from owned movies/series.

Used strictly as visual filler under commentary voice-over — never the
subject of a short. Per `pipeline/clipper.py`, audio is dropped.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # avoid forcing plexapi at import time
    from plexapi.video import Video


@dataclass(slots=True)
class PlexScene:
    title: str
    file_path: str  # path on the Plex media volume (must be mounted into the container)
    start_seconds: float
    duration_seconds: float


class PlexSampler:
    def __init__(self, base_url: str, token: str, *, library: str = "Filme") -> None:
        self.base_url = base_url
        self.token = token
        self.library = library
        self._server = None

    def _connect(self):  # lazy to keep import-time light
        if self._server is None:
            from plexapi.server import PlexServer

            if not self.base_url or not self.token:
                raise RuntimeError("PLEX_BASE_URL and PLEX_TOKEN are required")
            self._server = PlexServer(self.base_url, self.token)
        return self._server

    def random_scene(self, *, min_duration: float = 6.0, max_duration: float = 10.0) -> PlexScene:
        server = self._connect()
        section = server.library.section(self.library)
        candidates: list[Video] = section.all()
        if not candidates:
            raise RuntimeError(f"Plex library '{self.library}' is empty")
        item = random.choice(candidates)
        media = item.media[0]
        part = media.parts[0]
        total_s = (part.duration or 0) / 1000.0
        duration = random.uniform(min_duration, max_duration)
        # Stay clear of opening/closing credits.
        start = random.uniform(total_s * 0.15, max(total_s * 0.15, total_s * 0.85 - duration))
        return PlexScene(
            title=str(item.title),
            file_path=part.file,
            start_seconds=start,
            duration_seconds=duration,
        )
