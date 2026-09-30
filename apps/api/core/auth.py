# auth: bcrypt goes brrr, JWT does the bouncer duty.
import bcrypt
from typing import Optional
from jose import jwt
from core.config import settings

def hash_password(pw: str) -> str:
    # Hash a plaintext password with bcrypt before storing it.
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_password(pw: str, hashed: str) -> bool:
    # Check a login password against its stored bcrypt hash.
    return bcrypt.checkpw(pw.encode(), hashed.encode())

def issue_token(user_id: str) -> str:
    # Mint the session JWT that identifies this user on every request.
    return jwt.encode({"sub": user_id}, settings.jwt_secret, algorithm="HS256")

def read_token(token: str) -> Optional[str]:
    # Decode the session cookie back to a user id, or None if forged/expired.
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])["sub"]
    except Exception:
        return None
