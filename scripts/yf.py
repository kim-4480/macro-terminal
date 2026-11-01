"""yfinance 브리지: Node 서버가 호출해 JSON을 받는다.

  python yf.py profile SYMBOL
  python yf.py history SYMBOL PERIOD   (PERIOD: 1y, 2y, 5y, 10y, max)
"""
import json
import sys
import warnings

warnings.filterwarnings("ignore")

import yfinance as yf  # noqa: E402

PROFILE_KEYS = [
    "longName", "shortName", "sector", "industry", "country", "currency", "marketCap",
    "trailingPE", "forwardPE", "priceToBook", "dividendYield", "fiftyTwoWeekLow", "fiftyTwoWeekHigh",
    "fullTimeEmployees", "website", "longBusinessSummary", "quoteType", "exchange",
]


def profile(symbol):
    info = yf.Ticker(symbol).info or {}
    return {k: info.get(k) for k in PROFILE_KEYS}


def history(symbol, period):
    interval = "1wk" if period in ("10y", "max") else "1d"
    df = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False)
    points = [[idx.strftime("%Y-%m-%d"), float(row["Close"])] for idx, row in df.iterrows() if row["Close"] == row["Close"]]
    return {"symbol": symbol, "points": points}


def main():
    cmd, symbol = sys.argv[1], sys.argv[2]
    if cmd == "profile":
        out = profile(symbol)
    elif cmd == "history":
        out = history(symbol, sys.argv[3] if len(sys.argv) > 3 else "2y")
    else:
        raise SystemExit(f"unknown command: {cmd}")
    json.dump(out, sys.stdout, ensure_ascii=False, default=str)


if __name__ == "__main__":
    main()
