# config: all the secrets.
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/bigbutter"
    openai_api_key: str = ""
    wispr_api_key: str = ""
    wispr_ws_url: str = "wss://platform-api.wisprflow.ai/api/v1/dash/ws"
    env: str = "dev"  # "prod" → strong JWT_SECRET required, Secure cookies, no /docs
    jwt_secret: str = "change-me"  # prod refuses to boot with this default (core/auth.py check_secret)
    session_days: int = 30  # login lifetime: JWT exp + cookie max-age
    cors_origins: str = "http://localhost:3000"  # comma-separated web origins allowed to call the API
    embedding_model: str = "text-embedding-3-small"
    extraction_model: str = "gpt-4o-mini"
    summarization_model: str = "gpt-4o-mini"
    transcribe_engine: str = "api"  # or "local" (on-device tiny model, no key)
    embed_engine: str = "api"  # or "local" (on-device MiniLM 384-dim, no key)
    llm_engine: str = "api"  # "api" (OpenAI key) | "local" (Ollama, no key) | "off" (rule fallback)
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "qwen2.5:1.5b"
    search_min_sim: float = 0.30  # cosine floor for the semantic leg
    search_rerank: bool = False  # AI relevance check on borderline hits — turn on with a capable LLM
    search_candidate_sim: float = 0.20  # weak-meaning floor: relevance-check candidates + synonym-only keyword hits
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

def is_prod() -> bool:
    return settings.env.strip().lower() == "prod"
