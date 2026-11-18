"""Minimal client for free public Solana JSON-RPC endpoints (no API key, no credits).

Rotates between endpoints and retries on rate limits / errors.
"""
import json, time, random, threading, urllib.request, urllib.error

ENDPOINTS = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
]
_lock = threading.Lock()
_i = 0


def call(method, params, tries=8):
    global _i
    for n in range(tries):
        with _lock:
            url = ENDPOINTS[_i % len(ENDPOINTS)]
            _i += 1
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        req = urllib.request.Request(url, body, {"content-type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.load(r)
            if "error" in d:
                code = d["error"].get("code")
                if code in (-32005, -32429, 429, -32603, -32004, -32007, -32009):  # rate limit / transient
                    raise RuntimeError(d["error"])
                if code == -32009 or "not available" in str(d["error"]).lower():
                    return None
                raise ValueError(d["error"])
            return d["result"]
        except ValueError:
            raise
        except Exception:
            time.sleep(min(20, 0.7 * 2 ** n) + random.random())
    return None


def signatures(address, limit=1000, before=None, until=None):
    p = {"limit": min(limit, 1000)}
    if before: p["before"] = before
    if until: p["until"] = until
    return call("getSignaturesForAddress", [address, p]) or []


def transaction(sig):
    return call("getTransaction", [sig, {"encoding": "jsonParsed",
                                         "maxSupportedTransactionVersion": 1,
                                         "commitment": "confirmed"}])
