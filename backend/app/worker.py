"""Background worker: sends due notifications (status updates, delays, review prompts).

Run next to the API:  python -m app.worker
"""

import logging
import time

from .config import get_config
from .db import get_db
from .services.notify import Sender, send_due

logging.basicConfig(level=logging.INFO)


def main(interval_seconds: float = 5) -> None:
    sender = Sender(get_config())
    while True:
        db = next(get_db())
        try:
            send_due(db, sender)
        except Exception:
            logging.exception("notification run failed")
            db.rollback()
        finally:
            db.close()
        time.sleep(interval_seconds)


if __name__ == "__main__":
    main()
