"""Print a new key pair for browser notifications, ready to paste into backend/.env:

    python -m app.vapid >> .env
"""

from .services.webpush import new_vapid_keys

if __name__ == "__main__":
    public, private = new_vapid_keys()
    print(f"PV_VAPID_PUBLIC_KEY={public}")
    print(f"PV_VAPID_PRIVATE_KEY={private}")
