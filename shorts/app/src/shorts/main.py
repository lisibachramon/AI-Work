"""FastAPI entrypoint. Boots the scheduler on startup."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from shorts.jobs.scheduler import build_scheduler
from shorts.web.routes import router

log = logging.getLogger("shorts")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    sched = build_scheduler()
    sched.start()
    log.info("scheduler started with %d jobs", len(sched.get_jobs()))
    try:
        yield
    finally:
        sched.shutdown(wait=False)


app = FastAPI(title="shorts", version="0.1.0", lifespan=lifespan)
app.include_router(router)
