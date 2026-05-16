# whisper.cpp HTTP server with CUDA support.
# Model is mounted as a volume; the runbook documents the one-shot download.

FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates build-essential cmake curl libssl-dev && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth=1 https://github.com/ggerganov/whisper.cpp.git
WORKDIR /src/whisper.cpp
RUN cmake -B build -DGGML_CUDA=1 -DWHISPER_BUILD_SERVER=ON && \
    cmake --build build -j --target whisper-server

FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl tini && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/whisper.cpp/build/bin/whisper-server /usr/local/bin/whisper-server
ENV WHISPER_MODEL=large-v3
EXPOSE 9000
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "test -f /models/ggml-${WHISPER_MODEL}.bin || (echo 'Whisper model missing: /models/ggml-${WHISPER_MODEL}.bin — see docs/runbook.md' && exit 1); exec whisper-server --host 0.0.0.0 --port 9000 -m /models/ggml-${WHISPER_MODEL}.bin -l auto -t 4"]
