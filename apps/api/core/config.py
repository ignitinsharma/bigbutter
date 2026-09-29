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
    app_user_email: str = ""
    app_user_password: str = ""

    class Config:
        env_file = ".env"

settings = Settings()
