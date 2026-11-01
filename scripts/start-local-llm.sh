#!/bin/sh
# GGUF 모델을 llama-server 로 띄웁니다(OpenAI 호환). 설정 화면에서 "llama.cpp (로컬)"을 고르세요.
#   LLM_GGUF=/path/to/model.gguf npm run llm:local
# Ollama 나 LM Studio 를 쓴다면 이 스크립트는 필요 없습니다.
if [ ! -f "$LLM_GGUF" ]; then
  echo "Set LLM_GGUF to a .gguf model file: LLM_GGUF=/path/to/model.gguf npm run llm:local" >&2
  exit 1
fi
exec llama-server -m "$LLM_GGUF" --alias local -c "${LLM_CTX:-16384}" -ngl 99 -fa on -np 1 --jinja \
  --host 127.0.0.1 --port "${LLM_PORT:-8080}"
