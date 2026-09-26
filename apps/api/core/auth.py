import bcrypt
from typing import Optional
from jose import jwt
from core.config import settings

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    return bcrypt.checkpw(pw.encode(), hashed.encode())

def issue_token(user_id: str) -> str:
    return jwt.encode({"sub": user_id}, settings.jwt_secret, algorithm="HS256")

def read_token(token: str) -> Optional[str]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])["sub"]
    except Exception:
        return None
