"""Thin OpenAI-compatible client with JSON parsing, retries and a hard spend cap."""
import json
import os
import re
import threading
import time

from openai import APIConnectionError, APIStatusError, OpenAI, RateLimitError

from .config import LLM_API_KEY, LLM_BASE_URL, MODEL

# USD per million tokens (OpenRouter list prices, checked 2026-10-04)
PRICES = {
    "deepseek/deepseek-v4.1-flash": (0.30, 1.20),
    "deepseek/deepseek-v4-flash": (0.03, 0.06),
}

_client = OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY, max_retries=0, timeout=180)
_lock = threading.Lock()
spent = {"usd": 0.0, "in": 0, "out": 0, "calls": 0}
BUDGET_USD = float(os.environ.get("ALIBI_BUDGET_USD", "1.0"))


class BudgetExceeded(RuntimeError):
    pass


def parse_json(text: str):
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fenced:
        text = fenced.group(1)
    start = min([i for i in (text.find("{"), text.find("[")) if i >= 0], default=0)
    return json.loads(text[start:])


def chat_json(system: str, user: str, model: str = MODEL, max_tokens: int = 8000, reasoning: bool = False):
    """One JSON-returning call. Retries transient failures; refuses to run past the budget.

    Reasoning is off by default: on extraction it tripled output tokens for the same claims.
    """
    if spent["usd"] >= BUDGET_USD:
        raise BudgetExceeded(f"spent ${spent['usd']:.3f} of ${BUDGET_USD:.2f}")
    p_in, p_out = PRICES.get(model, (1.0, 4.0))
    for attempt in range(5):
        try:
            r = _client.chat.completions.create(
                model=model, max_tokens=max_tokens, temperature=0,
                response_format={"type": "json_object"},
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                extra_body={"reasoning": {"enabled": reasoning}})
            u = r.usage
            with _lock:
                spent["in"] += u.prompt_tokens
                spent["out"] += u.completion_tokens
                spent["calls"] += 1
                spent["usd"] += (u.prompt_tokens * p_in + u.completion_tokens * p_out) / 1e6
            return parse_json(r.choices[0].message.content or "{}")
        except (RateLimitError, APIConnectionError) as e:
            time.sleep(2 ** attempt * 2)
            err = e
        except APIStatusError as e:
            if e.status_code < 500:
                raise
            time.sleep(2 ** attempt * 2)
            err = e
        except json.JSONDecodeError as e:
            err = e  # malformed JSON: ask again
    raise RuntimeError(f"LLM call failed after retries: {err}")
