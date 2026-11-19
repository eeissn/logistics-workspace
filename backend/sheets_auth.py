"""Opt-in OAuth providers; keys and access tokens must remain outside the checkout."""
from pathlib import Path
import threading

SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"


def credential_path(value):
    if not isinstance(value, str) or not value:
        raise ValueError("A credential file path is required")
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError("Credential paths must be absolute")
    path = path.resolve()
    if path.is_relative_to(Path(__file__).resolve().parents[1]):
        raise ValueError("Credentials must be stored outside the checkout")
    return path


def checked_token(token):
    if (not isinstance(token, str) or not 1 <= len(token) <= 16384 or
            not token.isascii() or any(ord(char) <= 32 or ord(char) >= 127 for char in token)):
        raise ValueError("Invalid OAuth access token")
    return token


def token_provider(config):
    modes = [key for key in ("token_file", "service_account_file") if config.get(key)]
    if len(modes) != 1:
        raise ValueError("Configure exactly one Google OAuth credential source")
    mode = modes[0]
    path = credential_path(config[mode])
    if mode == "token_file":
        def read_token():
            with path.open("rb") as stream:
                raw = stream.read(16386)
            return checked_token(raw.decode("ascii").strip())
        return read_token
    try:
        from google.oauth2 import service_account
        from google.auth.transport.requests import Request
    except ImportError:
        raise ValueError("Install backend/requirements-sheets.txt for service account OAuth") from None
    credentials = service_account.Credentials.from_service_account_file(str(path), scopes=[SHEETS_SCOPE])
    lock = threading.Lock()

    def service_token():
        # Reuse a valid short-lived token; serialize refreshes across API workers' threads.
        with lock:
            if not credentials.valid:
                transport = Request()
                def bounded_request(*args, **kwargs):
                    kwargs["timeout"] = 15
                    return transport(*args, **kwargs)
                credentials.refresh(bounded_request)
            return checked_token(credentials.token)
    return service_token
