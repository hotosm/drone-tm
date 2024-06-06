from pydantic import BaseModel


class User(BaseModel):
    email: str
    is_active: bool = True
    is_superuser: bool = False
    full_name: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
