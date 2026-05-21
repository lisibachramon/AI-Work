"""YouTube Shorts uploader using google-api-python-client.

The Shorts treatment is automatic on YouTube's side: vertical ≤60s with
"#shorts" in the title is classified as a Short. We just upload as a
normal video and let the platform sort it.

The OAuth dance is one-time on a workstation (see docs/runbook.md). The
refresh token is dropped into YT_REFRESH_TOKEN. The container never sees
the browser flow.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

from shorts.config import Settings

TOKEN_URI = "https://oauth2.googleapis.com/token"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


@dataclass(slots=True)
class UploadRequest:
    file_path: Path
    title: str
    description: str
    tags: list[str]
    category_id: str
    privacy: str  # "private" | "unlisted" | "public"


class YouTubeUploader:
    def __init__(self, settings: Settings) -> None:
        missing = [
            name
            for name, val in (
                ("YT_CLIENT_ID", settings.yt_client_id),
                ("YT_CLIENT_SECRET", settings.yt_client_secret),
                ("YT_REFRESH_TOKEN", settings.yt_refresh_token),
            )
            if not val
        ]
        if missing:
            raise RuntimeError(f"YouTube uploader missing env: {', '.join(missing)}")
        creds = Credentials(
            token=None,
            refresh_token=settings.yt_refresh_token,
            token_uri=TOKEN_URI,
            client_id=settings.yt_client_id,
            client_secret=settings.yt_client_secret,
            scopes=SCOPES,
        )
        creds.refresh(Request())
        self.service = build("youtube", "v3", credentials=creds, cache_discovery=False)

    def upload(self, req: UploadRequest) -> str:
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
        return response["id"]
