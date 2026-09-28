from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class AppConfig(BaseSettings):
    """Server configuration from environment variables (see .env.example)."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="PV_", extra="ignore")

    env: str = "dev"
    database_url: str = "postgresql+psycopg://purevegi:purevegi@localhost:5432/purevegi"
    jwt_secret: str = "change-me"
    jwt_minutes: int = 60 * 24 * 7
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:5173"]

    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    # Push notifications to the Pure Vegi app (Expo push service). Optional access token
    # if "enhanced security for push" is switched on in the Expo account.
    expo_access_token: str | None = None
    # SMS for guests without the app (Twilio). All three are needed to send texts.
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None

    # Lets staff mark test orders as paid without Stripe. Never on in production.
    dev_payments: bool = True

    @property
    def is_prod(self) -> bool:
        return self.env == "prod"


@lru_cache
def get_config() -> AppConfig:
    cfg = AppConfig()
    if cfg.is_prod and (cfg.jwt_secret == "change-me" or cfg.dev_payments):
        raise RuntimeError("set PV_JWT_SECRET and PV_DEV_PAYMENTS=false in production")
    return cfg
