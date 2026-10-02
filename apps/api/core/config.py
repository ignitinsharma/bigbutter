# config: all the secrets.
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/bigbutter"
    openai_api_key: str = ""
    wispr_api_key: str = ""
    wispr_ws_url: str = "wss://platform-api.wisprflow.ai/api/v1/dash/ws"
    jwt_secret: str = "change-me"
    embedding_model: str = "text-embedding-3-small"
    extraction_model: str = "gpt-4o-mini"
    summarization_model: str = "gpt-4o-mini"
    transcribe_engine: str = "api"  # or "local" (on-device tiny model, no key)
    embed_engine: str = "api"  # or "local" (on-device MiniLM 384-dim, no key)
    llm_engine: str = "api"  # "api" (OpenAI key) | "local" (Ollama, no key) | "off" (rule fallback)
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "qwen2.5:1.5b"
    search_min_sim: float = 0.30  # cosine floor for the semantic leg
    search_rerank: bool = False
    # S3 voice recordings (core/storage.py). Optional: no bucket/keys → audio isn't kept, voice works as before.
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "ap-south-1"
    s3_bucket: str = ""
    s3_prefix: str = "recordings"
    s3_endpoint_url: str = ""  # blank = AWS; set for R2/MinIO
    audio_max_mb: int = 25
    app_user_email: str = ""
    app_user_password: str = ""

    class Config:
        env_file = ".env"

settings = Settings()
