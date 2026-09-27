"""Stripe payments. Card details never reach our server: the app confirms the
PaymentIntent with Stripe, and Stripe's webhook tells us it succeeded."""

from __future__ import annotations

import stripe

from ..config import AppConfig
from ..models import Order


class PaymentsNotConfigured(Exception):
    pass


def create_intent(order: Order, cfg: AppConfig) -> dict:
    if not cfg.stripe_secret_key:
        if cfg.dev_payments:
            return {"client_secret": None, "dev_mode": True, "amount_pence": order.total_pence}
        raise PaymentsNotConfigured("Stripe is not set up")
    if order.stripe_payment_intent_id:
        intent = stripe.PaymentIntent.retrieve(order.stripe_payment_intent_id, api_key=cfg.stripe_secret_key)
    else:
        intent = stripe.PaymentIntent.create(
            amount=order.total_pence,
            currency="gbp",
            automatic_payment_methods={"enabled": True},  # cards, Apple Pay, Google Pay
            metadata={"order_id": str(order.id)},
            api_key=cfg.stripe_secret_key,
            idempotency_key=f"order-{order.id}",
        )
        order.stripe_payment_intent_id = intent.id
    return {"client_secret": intent.client_secret, "dev_mode": False, "amount_pence": order.total_pence}


def parse_webhook(payload: bytes, signature: str, cfg: AppConfig):
    if not cfg.stripe_webhook_secret:
        raise PaymentsNotConfigured("webhook secret missing")
    return stripe.Webhook.construct_event(payload, signature, cfg.stripe_webhook_secret)


def refund(order: Order, cfg: AppConfig) -> str | None:
    """Full refund for a paid order. Returns the Stripe refund id (None in dev mode)."""
    if not order.paid_at or not order.stripe_payment_intent_id or not cfg.stripe_secret_key:
        return None
    r = stripe.Refund.create(
        payment_intent=order.stripe_payment_intent_id,
        api_key=cfg.stripe_secret_key,
        idempotency_key=f"refund-{order.id}",
    )
    return r.id
