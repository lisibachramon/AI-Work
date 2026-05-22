"""YouTube Shorts uploader using google-api-python-client.

The Shorts treatment is automatic on YouTube's side: vertical ≤60s with
"#shorts" in the title is classified as a Short. We upload as a normal
video; the platform sorts it.

This uploader supports:
- per-locale channel routing (Settings.channel_for(locale))
- custom thumbnail upload (videos.thumbnails.set)
- a top-level CTA comment after upload (programmatic pinning isn't exposed
  by the Data API — the first creator comment after upload is auto-pinned
  by the Shorts player in many cases, but this is best-effort)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

from shorts.config import Settings

log = logging.getLogger("shorts.upload")

TOKEN_URI = "https://oauth2.googleapis.com/token"
SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.force-ssl",  # needed for comment + thumbnail
]


@dataclass(slots=True)
class UploadRequest:
    file_path: Path
    title: str
    description: str
    tags: list[str]
    category_id: str
    privacy: str  # "private" | "unlisted" | "public"
    thumbnail_path: Path | None = None
    cta_comment: str | None = None


@dataclass(slots=True)
class UploadResult:
    video_id: str
    url: str
    thumbnail_set: bool
    cta_comment_id: str | None


class YouTubeUploader:
    def __init__(self, settings: Settings, *, locale: str = "en-US") -> None:
        client_id, client_secret, refresh_token = settings.channel_for(locale)
        missing = [
            name
            for name, val in (
                ("YT_CLIENT_ID", client_id),
                ("YT_CLIENT_SECRET", client_secret),
                ("YT_REFRESH_TOKEN", refresh_token),
            )
            if not val
        ]
        if missing:
            raise RuntimeError(f"YouTube uploader missing env for locale={locale}: {', '.join(missing)}")
        creds = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri=TOKEN_URI,
            client_id=client_id,
            client_secret=client_secret,
            scopes=SCOPES,
        )
        creds.refresh(Request())
        self.service = build("youtube", "v3", credentials=creds, cache_discovery=False)

    def upload(self, req: UploadRequest) -> UploadResult:
        body = {
            "snippet": {
                "title": req.title,
                "description": req.description,
                "tags": req.tags,
                "categoryId": req.category_id,
            },
            "status": {
                "privacyStatus": req.privacy,
                "selfDeclaredMadeForKids": False,
                "embeddable": True,
            },
        }
        media = MediaFileUpload(
            str(req.file_path), mimetype="video/mp4", chunksize=8 * 1024 * 1024, resumable=True
        )
        request = self.service.videos().insert(part="snippet,status", body=body, media_body=media)
        response = None
        while response is None:
            _status, response = request.next_chunk()
        video_id = response["id"]
        log.info("uploaded video_id=%s privacy=%s", video_id, req.privacy)

        thumb_ok = False
        if req.thumbnail_path and req.thumbnail_path.exists():
            try:
                self.service.thumbnails().set(
                    videoId=video_id, media_body=MediaFileUpload(str(req.thumbnail_path))
                ).execute()
                thumb_ok = True
            except HttpError:
                log.exception("thumbnail upload failed for %s", video_id)

        comment_id: str | None = None
        if req.cta_comment:
            try:
                resp = self.service.commentThreads().insert(
                    part="snippet",
                    body={
                        "snippet": {
                            "videoId": video_id,
                            "topLevelComment": {
                                "snippet": {"textOriginal": req.cta_comment}
                            },
                        }
                    },
                ).execute()
                comment_id = resp.get("id")
            except HttpError:
                # Comments are often disabled on a fresh channel — log and continue.
                log.exception("CTA comment failed for %s", video_id)

        return UploadResult(
            video_id=video_id,
            url=f"https://www.youtube.com/watch?v={video_id}",
            thumbnail_set=thumb_ok,
            cta_comment_id=comment_id,
        )
