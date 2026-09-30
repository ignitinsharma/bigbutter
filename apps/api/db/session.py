# session: one engine to rule all queries.
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from core.config import settings

# ponytail: Neon needs TLS; keep it out of DATABASE_URL (asyncpg rejects
# query-string ssl params) and pass it here instead.
engine = create_async_engine(settings.database_url.split("?")[0], connect_args={"ssl": True})
Session = async_sessionmaker(engine, expire_on_commit=False)

async def get_session():
    # Yield one DB session per request; FastAPI closes it when the request ends.
    async with Session() as s:
        yield s
